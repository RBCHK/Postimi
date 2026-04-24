/**
 * Outer retry + classification helper for OAuth token refresh.
 *
 * Why this exists: `fetchWithRetry` already rides through transient 5xx /
 * 429 / network errors at the HTTP layer, but the *refresh endpoint itself*
 * occasionally surfaces errors that a second call can succeed against:
 * brief provider flaps, temporary 503s the per-request budget can't
 * absorb, stray network failures between the two peers. A single exchange
 * attempt is still too few when the cost of failure is deleting the user's
 * refresh token and forcing reconnection.
 *
 * The call-sites (`x-token`, `linkedin-token`, `threads-token`) all share
 * the same shape:
 *   1. Attempt `exchangeRefreshToken(...)`.
 *   2. On success → update DB row.
 *   3. On failure → decide whether to delete the token or retry.
 *
 * This module centralises steps (1) and (3). It runs up to 3 attempts with
 * exponential backoff + jitter (~2s, ~8s) between them. On terminal
 * failure it classifies the error: an explicit OAuth `invalid_grant` / 400
 * means the refresh token is dead and we must delete it; anything else
 * (500/502/503/504/429/network) is transient — we return `null` without
 * deleting so the next caller can retry fresh.
 *
 * The per-provider call-sites carry the message format
 * `X token refresh failed ${status}: ${body}` (and equivalents). We parse
 * `status` and `body` from that message string for classification — it's
 * the minimum-change contract that keeps the existing error shape intact.
 */

import * as Sentry from "@sentry/nextjs";

/**
 * Retry schedule between attempts. First entry is the wait before attempt
 * 2, second is the wait before attempt 3, etc. Total attempts = waits.length + 1.
 *
 * Rationale for {2000, 8000}: X / LinkedIn / Threads rate-limit responses
 * typically resolve inside 5–15s. A 2s first retry catches the common
 * transient blip without hammering a genuinely unhealthy endpoint; the
 * 8s second retry covers a brief provider outage. Maximum total delay
 * (2 + 2 × jitter-top + 8 + 8 × jitter-top) ≈ 11s keeps us well under
 * the Vercel 60s function wall.
 */
const RETRY_WAITS_MS: ReadonlyArray<{ base: number; jitter: number }> = [
  { base: 2000, jitter: 500 },
  { base: 8000, jitter: 2000 },
];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function waitMs(idx: number): number {
  const cfg = RETRY_WAITS_MS[idx];
  if (!cfg) return 0;
  // Additive jitter in [0, cfg.jitter). Non-negative so cadence never
  // collapses to zero; jitter size scales with base so burst-retrying
  // callers fan out proportionally.
  return cfg.base + Math.floor(Math.random() * cfg.jitter);
}

/**
 * Structural signal that the refresh token itself is dead. Only errors
 * classified as `invalidGrant: true` trigger the token-row delete; every
 * other terminal failure returns null and leaves the row intact so the
 * next caller can retry.
 */
export interface RefreshErrorClassification {
  invalidGrant: boolean;
  status: number | null;
  body: string | null;
}

/**
 * Parse the thrown error message emitted by `exchangeRefreshToken`. The
 * call-sites stringify as `X token refresh failed ${status}: ${body}`
 * (and equivalents for LinkedIn / Threads). We capture status + body via
 * regex — best-effort, lowercase-compare the body against known OAuth
 * error codes. Unknown shapes default to `invalidGrant: false` so a
 * parse miss errs on the safe side (retry, don't delete).
 */
export function classifyRefreshError(err: unknown): RefreshErrorClassification {
  if (!(err instanceof Error)) {
    return { invalidGrant: false, status: null, body: null };
  }
  const m = err.message.match(/failed\s+(\d{3})\s*:\s*([\s\S]*)$/i);
  if (!m) {
    return { invalidGrant: false, status: null, body: null };
  }
  const status = Number(m[1]);
  const body = m[2] ?? "";

  // `invalid_grant` is the RFC 6749 code for "refresh token is no longer
  // valid". All three providers emit it as JSON `{"error":"invalid_grant"}`
  // with HTTP 400 (LinkedIn sometimes uses 401 with the same payload).
  // Match on the body even without strict JSON parse so that malformed
  // but human-readable bodies still classify correctly. Only status 400
  // / 401 count — an HTTP 500 body that happens to contain the literal
  // "invalid_grant" (e.g. a dump of logs) must not trigger a delete.
  const statusEligible = status === 400 || status === 401;
  const invalidGrant = statusEligible && /invalid[_ ]?grant/i.test(body);

  return { invalidGrant, status, body };
}

/**
 * Runs `exchange` up to `RETRY_WAITS_MS.length + 1` attempts with
 * exponential backoff + jitter between them. On any thrown error we
 * decide whether to retry based on `classifyRefreshError`:
 *   - `invalid_grant` → break immediately (delete path takes over).
 *   - anything else → wait and retry until attempts exhausted.
 *
 * Returns the first successful result, OR throws the last error. The
 * caller is responsible for turning the thrown error into the correct
 * DB action via `classifyRefreshError`.
 */
export async function runTokenRefreshWithRetry<T>(exchange: () => Promise<T>): Promise<T> {
  let lastErr: unknown = null;
  const totalAttempts = RETRY_WAITS_MS.length + 1;
  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await exchange();
    } catch (err) {
      lastErr = err;
      const cls = classifyRefreshError(err);
      // `invalid_grant` is terminal — no amount of retrying will fix a
      // revoked refresh token. Bail immediately so the caller can delete.
      if (cls.invalidGrant) break;
      if (attempt === totalAttempts) break;
      await sleep(waitMs(attempt - 1));
    }
  }
  throw lastErr;
}

/**
 * Report a non-`invalid_grant` terminal refresh failure. The token row is
 * intentionally NOT deleted — a future caller will retry fresh. Returns
 * null so call-sites stay uniform with the delete path.
 */
export function reportTransientRefreshFailure(
  err: unknown,
  platform: "x" | "linkedin" | "threads",
  userId: string,
  classification: RefreshErrorClassification
): null {
  Sentry.captureException(err, {
    tags: {
      area: `${platform}-token-refresh-retry`,
      userId,
      status: classification.status === null ? "unknown" : String(classification.status),
    },
    extra: {
      body: classification.body?.slice(0, 2000) ?? null,
      reason: "non-invalid_grant terminal failure; token preserved for retry",
    },
  });
  return null;
}
