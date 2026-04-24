/**
 * `fetch` wrapper that layers retry + exponential backoff on top of
 * `fetchWithTimeout`. External APIs (X, LinkedIn, Threads) throw transient
 * 5xx, 429, and network errors under normal operation — a single failure
 * should not kill a cron iteration for a user.
 *
 * Retries on: network errors (`TypeError`), HTTP 408, 429, 500, 502, 503,
 * 504. Does NOT retry on: any other 4xx (including 401 — token refresh
 * is a separate flow), or an `AbortError` triggered by the *caller's*
 * signal (we honour caller intent to cancel).
 *
 * Each attempt gets its own timeout (via `fetchWithTimeout`) — a single
 * hung request does not eat the whole retry budget.
 *
 * `Retry-After` on 429 is honoured when present, capped at 60s so a
 * misbehaving upstream can't stall a cron for minutes.
 *
 * On terminal failure throws `RetryableApiError` carrying the last
 * status + body so callers can classify (e.g. report to Sentry with a
 * context tag).
 */

import * as Sentry from "@sentry/nextjs";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const DEFAULT_MAX_ATTEMPTS = 3;
const BASE_DELAY_MS = 500;
const BACKOFF_FACTOR = 2;
const JITTER_FRACTION = 0.25;
const RETRY_AFTER_CAP_MS = 60_000;

const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

export class RetryableApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly body: string,
    public readonly attempts: number
  ) {
    super(message);
    this.name = "RetryableApiError";
  }
}

export interface FetchWithRetryInit extends RequestInit {
  timeoutMs?: number;
  maxAttempts?: number;
  /** Free-form Sentry tag used when we give up after max attempts. */
  retryContext?: string;
}

function computeBackoffMs(attempt: number): number {
  // attempt is 1-indexed: 1 = first retry, 2 = second retry, ...
  const base = BASE_DELAY_MS * Math.pow(BACKOFF_FACTOR, attempt - 1);
  const jitter = base * JITTER_FRACTION * (Math.random() * 2 - 1);
  return Math.max(0, Math.floor(base + jitter));
}

function parseRetryAfter(header: string | null): number | null {
  if (!header) return null;
  const seconds = Number(header);
  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.min(seconds * 1000, RETRY_AFTER_CAP_MS);
  }
  // HTTP-date form: "Wed, 21 Oct 2026 07:28:00 GMT"
  const parsed = Date.parse(header);
  if (!Number.isNaN(parsed)) {
    const delta = parsed - Date.now();
    if (delta <= 0) return 0;
    return Math.min(delta, RETRY_AFTER_CAP_MS);
  }
  return null;
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new DOMException("Aborted", "AbortError"));
      return;
    }
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      reject(signal?.reason ?? new DOMException("Aborted", "AbortError"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/**
 * A fetch error is "retryable" (transient/network) when:
 *   - it's a `TypeError` from fetch (DNS failure, ECONNRESET, TLS, ...)
 *   - it's an `AbortError`/`TimeoutError` NOT triggered by the caller
 *     (i.e. our per-attempt timeout fired, but the caller hasn't
 *     cancelled — otherwise we must respect the cancellation).
 */
function isRetryableNetworkError(err: unknown, callerSignal: AbortSignal | undefined): boolean {
  if (callerSignal?.aborted) return false;
  if (!(err instanceof Error)) return false;
  if (err.name === "AbortError" || err.name === "TimeoutError") return true;
  // Native `fetch` throws `TypeError` for network-layer failures.
  if (err.name === "TypeError") return true;
  return false;
}

export async function fetchWithRetry(
  input: RequestInfo | URL,
  init: FetchWithRetryInit = {}
): Promise<Response> {
  const {
    timeoutMs,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    retryContext,
    signal: rawCallerSignal,
    ...rest
  } = init;
  // Normalise `null` (valid for RequestInit.signal) to `undefined` so
  // helpers below can use strict `AbortSignal | undefined`.
  const callerSignal: AbortSignal | undefined = rawCallerSignal ?? undefined;

  let lastStatus = 0;
  let lastBody = "";
  let lastError: unknown = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    if (callerSignal?.aborted) {
      throw callerSignal.reason ?? new DOMException("Aborted", "AbortError");
    }

    let res: Response | null = null;
    try {
      res = await fetchWithTimeout(input, {
        ...rest,
        timeoutMs,
        signal: callerSignal,
      });
    } catch (err) {
      lastError = err;
      // Caller intent: don't retry on caller-driven cancellation.
      if (callerSignal?.aborted) throw err;
      if (!isRetryableNetworkError(err, callerSignal)) throw err;
      if (attempt === maxAttempts) break;
      await sleep(computeBackoffMs(attempt), callerSignal);
      continue;
    }

    if (res.ok) return res;
    if (!RETRYABLE_STATUSES.has(res.status)) return res;

    lastStatus = res.status;
    lastError = null;

    // Honour Retry-After on 429 (and 503 sometimes carries it too).
    // Compute BEFORE consuming the body so we can still read headers.
    const retryAfterMs = parseRetryAfter(res.headers?.get?.("Retry-After") ?? null);

    // Drain the body into `lastBody` so we don't leak the response and
    // so the terminal error has something informative to carry. A
    // retryable response is by definition one we're about to discard,
    // so we can safely consume its body (no need to clone).
    try {
      lastBody = await res.text();
    } catch {
      lastBody = "";
    }

    if (attempt === maxAttempts) break;

    const backoffMs = computeBackoffMs(attempt);
    const waitMs =
      retryAfterMs !== null
        ? Math.min(Math.max(retryAfterMs, backoffMs), RETRY_AFTER_CAP_MS)
        : backoffMs;

    await sleep(waitMs, callerSignal);
  }

  const message =
    lastStatus > 0
      ? `fetchWithRetry: gave up after ${maxAttempts} attempts (last status ${lastStatus})`
      : `fetchWithRetry: gave up after ${maxAttempts} attempts (network error)`;
  const err = new RetryableApiError(message, lastStatus, lastBody, maxAttempts);
  // Emit to Sentry with a context tag so ops can triage by API.
  Sentry.captureException(lastError ?? err, {
    tags: {
      area: "fetch-with-retry",
      context: retryContext ?? "unknown",
      lastStatus: String(lastStatus || "network"),
    },
    extra: { lastBody: lastBody.slice(0, 2000), attempts: maxAttempts },
  });
  throw err;
}
