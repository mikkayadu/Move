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

  private async callWithDowngrade(userText: string): Promise<GenerateContentResponse> {
    try {
      return await this.call<GenerateContentResponse>(
        `${API_ROOT}/models/${this.model}:generateContent`,
        this.buildBody(userText),
      );
    } catch (error) {
      const isBadRequest = error instanceof UpstreamError && error.status === 400;
      const canDowngrade = this.capabilities.systemInstruction || this.capabilities.thinkingConfig;

      if (!isBadRequest || !canDowngrade) throw error;

      this.logger.warn(
        `${this.model} rejected an optional request field; retrying without ` +
          'systemInstruction and thinkingConfig. This is expected on some Gemma deployments.',
      );
      this.capabilities = { systemInstruction: false, thinkingConfig: false };

      return this.call<GenerateContentResponse>(
        `${API_ROOT}/models/${this.model}:generateContent`,
        this.buildBody(userText),
      );
    }
  }

  private buildBody(userText: string): Record<string, unknown> {
    const generationConfig: Record<string, unknown> = {
      temperature: 0.2,
      topP: 0.9,
      maxOutputTokens: 800,
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
