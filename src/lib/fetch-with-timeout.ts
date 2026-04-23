/**
 * Shared fetch wrapper that enforces a request timeout.
 *
 * Node's built-in `fetch` has no default timeout — a slow/hung upstream
 * blocks the caller indefinitely. On Vercel that manifests as an opaque
 * function timeout at `maxDuration`; in long-running crons a single hung
 * request blocks the whole batch.
 *
 * Usage: drop-in replacement for `fetch` on calls to external services
 * (X, LinkedIn, Threads, Tavily, Twitter oEmbed, OAuth providers, media
 * downloads). Defaults to 30s — callers can override via `timeoutMs`.
 * Composes with a caller-supplied `AbortSignal` via `AbortSignal.any` so
 * cancellation and timeout work together.
 *
 * Intentionally does NOT add retry logic — retries are platform-specific
 * (see `x-api.ts` 429 handling, `threads-api.ts` retry delays) and
 * already implemented where needed.
 */

const DEFAULT_TIMEOUT_MS = 30_000;

export async function fetchWithTimeout(
  input: RequestInfo | URL,
  init: RequestInit & { timeoutMs?: number } = {}
): Promise<Response> {
  const { timeoutMs = DEFAULT_TIMEOUT_MS, signal: callerSignal, ...rest } = init;
  const timeoutSignal = AbortSignal.timeout(timeoutMs);
  const signal = callerSignal ? AbortSignal.any([callerSignal, timeoutSignal]) : timeoutSignal;
  return fetch(input, { ...rest, signal });
}
