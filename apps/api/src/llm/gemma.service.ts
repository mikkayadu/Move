import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { UpstreamError } from '../common/http.util';
import { buildUserPrompt, SYSTEM_PROMPT } from './prompt';

const API_ROOT = 'https://generativelanguage.googleapis.com/v1beta';

interface GenerateContentResponse {
  candidates?: Array<{
    content?: { parts?: Array<{ text?: string }> };
    finishReason?: string;
  }>;
  promptFeedback?: { blockReason?: string };
  error?: { message?: string };
}

/**
 * Optional request features that not every Gemma serving configuration
 * accepts. We start optimistic and permanently downgrade on the first 400, so
 * a serving-side difference costs one wasted call at startup instead of
 * breaking the demo.
 */
interface Capabilities {
  systemInstruction: boolean;
  thinkingConfig: boolean;
}

@Injectable()
export class GemmaService {
  private readonly logger = new Logger(GemmaService.name);
  private capabilities: Capabilities = { systemInstruction: true, thinkingConfig: true };

  constructor(private readonly config: ConfigService) {}

  get model(): string {
    return this.config.get<string>('gemmaModel') ?? 'gemma-4-e4b-it';
  }

  get configured(): boolean {
    return Boolean(this.config.get<string>('googleAiApiKey'));
  }

  /** Lists the models this API key can actually reach. Used by `npm run models`. */
  async listModels(): Promise<string[]> {
    const response = await this.call<{ models?: Array<{ name: string }> }>(
      `${API_ROOT}/models`,
      undefined,
    );
    return (response.models ?? []).map((entry) => entry.name.replace(/^models\//, ''));
  }

  /**
   * Single-shot generation. Returns the raw model text; parsing and validation
   * belong to the recommendation layer, which owns the domain contract.
   */
  async generate(payload: unknown, extraInstruction?: string): Promise<string> {
    if (!this.configured) {
      throw new ServiceUnavailableException(
        'GOOGLE_AI_API_KEY is not configured. Add it to your .env file.',
      );
    }

    const userText = extraInstruction
      ? `${buildUserPrompt(payload)}\n\n${extraInstruction}`
      : buildUserPrompt(payload);

    const response = await this.callWithDowngrade(userText);

    if (response.promptFeedback?.blockReason) {
      throw new UpstreamError('gemma', `blocked: ${response.promptFeedback.blockReason}`);
    }

    const text = (response.candidates?.[0]?.content?.parts ?? [])
      .map((part) => part.text ?? '')
      .join('')
      .trim();

    if (!text) {
      const reason = response.candidates?.[0]?.finishReason ?? 'no candidates';
      throw new UpstreamError('gemma', `empty response (${reason})`);
    }

    return text;
  }

  /**
   * Retries once with the specific feature the model complained about turned
   * off.
   *
   * These two capabilities are downgraded independently, which matters more
   * than it looks: the served Gemma 4 variants accept `systemInstruction` but
   * reject `thinkingConfig`. Dropping both together would push us onto the
   * folded-prompt path, where thinking tokens eat the output budget and the
   * answer gets truncated mid-string. Turning off only the rejected field
   * keeps the system contract intact.
   */
  private async callWithDowngrade(userText: string): Promise<GenerateContentResponse> {
    const send = (): Promise<GenerateContentResponse> =>
      this.call<GenerateContentResponse>(
        `${API_ROOT}/models/${this.model}:generateContent`,
        this.buildBody(userText),
      );

    try {
      return await send();
    } catch (error) {
      if (!(error instanceof UpstreamError) || error.status !== 400) throw error;

      const downgraded = this.downgradeFor(error.message);
      if (!downgraded) throw error;

      this.logger.warn(
        `${this.model} rejected ${downgraded}; retrying without it. ` +
          'This is expected on some Gemma deployments.',
      );
      return send();
    }
  }

  /**
   * Reads the API's complaint and disables only that feature. Falls back to
   * dropping thinking control first, since that is the field most commonly
   * unsupported and the least costly to lose.
   */
  private downgradeFor(message: string): string | null {
    const complaint = message.toLowerCase();

    if (this.capabilities.thinkingConfig && complaint.includes('thinking')) {
      this.capabilities = { ...this.capabilities, thinkingConfig: false };
      return 'thinkingConfig';
    }

    if (this.capabilities.systemInstruction && complaint.includes('system')) {
      this.capabilities = { ...this.capabilities, systemInstruction: false };
      return 'systemInstruction';
    }

    if (this.capabilities.thinkingConfig) {
      this.capabilities = { ...this.capabilities, thinkingConfig: false };
      return 'thinkingConfig';
    }

    if (this.capabilities.systemInstruction) {
      this.capabilities = { ...this.capabilities, systemInstruction: false };
      return 'systemInstruction';
    }

    return null;
  }

  private buildBody(userText: string): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2,
      topP: 0.9,
      // Thinking tokens are charged against this budget, and the served Gemma 4
      // variants think for 600-800 tokens before answering even on a small
      // briefing. At 800 the answer was being truncated mid-string; this leaves
      // room for the reasoning plus the ~200 token result.
      maxOutputTokens: 2500,
    };

    // Move wants a fast, decisive answer, not visible exploration, so thinking
    // is disabled where the deployment supports the switch.
    if (this.capabilities.thinkingConfig) {
      generationConfig.thinkingConfig = { thinkingBudget: 0 };
    }

    const body: Record<string, unknown> = {
      contents: [{ role: 'user', parts: [{ text: userText }] }],
      generationConfig,
    };

    if (this.capabilities.systemInstruction) {
      body.systemInstruction = { parts: [{ text: SYSTEM_PROMPT }] };
    } else {
      // Fall back to folding the contract into the user turn.
      body.contents = [
        { role: 'user', parts: [{ text: `${SYSTEM_PROMPT}\n\n---\n\n${userText}` }] },
      ];
    }

    return body;
  }

  private async call<T>(url: string, body: Record<string, unknown> | undefined): Promise<T> {
    const apiKey = this.config.get<string>('googleAiApiKey') ?? '';
    const timeoutMs = this.config.get<number>('llmTimeoutMs') ?? 20000;

    const response = await fetch(url, {
      method: body ? 'POST' : 'GET',
      // The key travels in a header rather than the query string so it never
      // lands in an access log or an error message.
      headers: {
        'x-goog-api-key': apiKey,
        ...(body ? { 'content-type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: AbortSignal.timeout(timeoutMs),
    }).catch((error: Error) => {
      throw new UpstreamError(
        'gemma',
        error.name === 'TimeoutError' ? 'request timed out' : error.message,
      );
    });

    const text = await response.text();

    if (!response.ok) {
      let detail = text.slice(0, 300);
      try {
        detail = (JSON.parse(text) as GenerateContentResponse).error?.message ?? detail;
      } catch {
        // Non-JSON error body; the raw slice is the best we have.
      }
      throw new UpstreamError('gemma', `HTTP ${response.status}: ${detail}`, response.status);
    }

    return JSON.parse(text) as T;
  }
}
