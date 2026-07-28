/**
 * Small hardened wrapper around `fetch`.
 *
 * Every upstream call in Move goes through here so that timeout, retry, and
 * error-shape behaviour is uniform. This matters more than usual for this
 * project: the whole premise is that the app stays useful on a slow or flaky
 * mobile connection, which means a hung socket must become a fast, typed
 * failure that the recommendation layer can fall back from.
 */

export class UpstreamError extends Error {
  constructor(
    readonly source: string,
    message: string,
    readonly status?: number,
  ) {
    super(`[${source}] ${message}`);
    this.name = 'UpstreamError';
  }
}

export interface FetchJsonOptions {
  /** Label used in error messages and logs, e.g. "mapbox". */
  source: string;
  timeoutMs: number;
  /** Number of extra attempts after the first one. Default 1. */
  retries?: number;
  init?: RequestInit;
}

const RETRYABLE_STATUS = new Set([408, 425, 429, 500, 502, 503, 504]);

export async function fetchJson<T>(
  url: string,
  { source, timeoutMs, retries = 1, init }: FetchJsonOptions,
): Promise<T> {
  let lastError: Error = new UpstreamError(source, 'request never ran');

  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...init,
        signal: AbortSignal.timeout(timeoutMs),
      });

      if (!response.ok) {
        const body = await response.text().catch(() => '');
        const error = new UpstreamError(
          source,
          `HTTP ${response.status} ${truncate(body)}`,
          response.status,
        );
        // A 4xx that is not rate limiting will fail again identically, so we
        // surface it immediately rather than burning the retry budget.
        if (!RETRYABLE_STATUS.has(response.status)) throw error;
        lastError = error;
      } else {
        return (await response.json()) as T;
      }
    } catch (error) {
      if (error instanceof UpstreamError && error.status && !RETRYABLE_STATUS.has(error.status)) {
        throw error;
      }
      lastError =
        error instanceof Error
          ? new UpstreamError(source, describe(error))
          : new UpstreamError(source, 'unknown failure');
    }

    if (attempt < retries) {
      await sleep(250 * (attempt + 1));
    }
  }

  throw lastError;
}

function describe(error: Error): string {
  if (error.name === 'TimeoutError' || error.name === 'AbortError') {
    return 'request timed out';
  }
  return error.message;
}

function truncate(text: string, max = 200): string {
  const clean = text.replace(/\s+/g, ' ').trim();
  return clean.length > max ? `${clean.slice(0, max)}...` : clean;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
