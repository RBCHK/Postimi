/**
 * `Promise.race`-based timeout wrapper for third-party SDK calls that
 * don't accept an `AbortSignal` (notably `@tavily/core`, whose Node
 * client wraps `fetch` internally with no timeout knob exposed).
 *
 * Use sparingly — anything built on `fetch` should prefer
 * `fetchWithTimeout` / `fetchWithRetry` so we can actually cancel the
 * underlying request. `withTimeout` abandons the pending promise; the
 * HTTP call keeps running in the background, just its result is
 * discarded. That's the right trade for a cron tool-call where we'd
 * rather degrade gracefully than block a whole user queue on a hung
 * peer.
 *
 * On timeout, rejects with a `TimeoutError` whose `name` is
 * `"TimeoutError"` so callers can distinguish it from genuine
 * upstream errors (which may warrant different handling — e.g. a
 * plain API 500 is worth surfacing; a Tavily hang is not).
 */

export class TimeoutError extends Error {
  constructor(
    message: string,
    public readonly timeoutMs: number
  ) {
    super(message);
    this.name = "TimeoutError";
  }
}

export async function withTimeout<T>(
  promise: Promise<T>,
  timeoutMs: number,
  label = "operation"
): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      reject(new TimeoutError(`${label} timed out after ${timeoutMs}ms`, timeoutMs));
    }, timeoutMs);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}
