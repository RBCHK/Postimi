/**
 * Per-(user, platform) mutex around OAuth token refresh. Without it, two
 * cron iterations (or cron + a UI action) that hit the same user in
 * parallel can both observe an expired token, both call
 * `exchangeRefreshToken`, and both try to save divergent access-tokens.
 * Last writer wins → the other side is left holding a dead token and
 * the user is silently disconnected from X / LinkedIn / Threads.
 *
 * Implementation: Postgres transaction-scoped advisory locks via
 * `pg_try_advisory_xact_lock(key1, key2)`. The lock is released
 * automatically when the enclosing transaction commits or rolls back,
 * so there is no manual release path to get wrong. We use two int4
 * keys (not a single int8) so that the platform component is a stable
 * small integer and the user component is a 32-bit hash of the userId
 * string — enough entropy to make cross-user collisions negligible.
 *
 * On lock-acquisition failure we wait briefly (50ms) and retry a few
 * times. If still not acquired after 5 tries we assume the lock holder
 * just committed — the caller is expected to re-read the token row and
 * use it if it's now fresh. If it's still expired, we throw; an
 * extremely stuck lock is a Sentry-worthy pathology.
 */
import * as Sentry from "@sentry/nextjs";
import { createHash } from "node:crypto";
import { prisma } from "@/lib/prisma";

const PLATFORM_KEY: Record<"x" | "linkedin" | "threads", number> = {
  x: 1,
  linkedin: 2,
  threads: 3,
};

const MAX_ACQUISITION_ATTEMPTS = 5;
const WAIT_BETWEEN_ATTEMPTS_MS = 50;

/**
 * Hash a userId string into a stable signed int32 suitable for
 * `pg_try_advisory_xact_lock(int, int)`. We take the first 4 bytes of
 * SHA-256 so two processes on two machines always compute the same key
 * for the same userId — crucial for cross-instance mutual exclusion.
 */
function userIdToInt32(userId: string): number {
  const hash = createHash("sha256").update(userId).digest();
  // Read as signed int32: Postgres `pg_try_advisory_xact_lock(int, int)`
  // accepts signed 32-bit integers.
  return hash.readInt32BE(0);
}

/**
 * Serializes token refresh per (user, platform). Executes `fn` inside a
 * Prisma transaction while holding a Postgres transaction-scoped
 * advisory lock. If another request is already refreshing the same
 * token, callers are expected to re-read the token from DB after `fn`
 * returns — typically the lock holder has already stored a fresh token
 * and `fn` itself is a no-op.
 *
 * Note: the lock guarantees `fn` runs in a critical section; it does
 * NOT guarantee you should actually run a refresh. Re-check expiry
 * inside `fn` — the previous holder may have just done the work.
 */
export async function withTokenRefreshLock<T>(
  userId: string,
  platform: "x" | "linkedin" | "threads",
  fn: () => Promise<T>
): Promise<T> {
  const key1 = PLATFORM_KEY[platform];
  const key2 = userIdToInt32(userId);

  let lastError: unknown = null;
  for (let attempt = 1; attempt <= MAX_ACQUISITION_ATTEMPTS; attempt++) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const rows = await tx.$queryRaw<
          { acquired: boolean }[]
        >`SELECT pg_try_advisory_xact_lock(${key1}::int, ${key2}::int) AS acquired`;
        const acquired = rows[0]?.acquired === true;
        if (!acquired) {
          // Signal the outer loop to back off and retry.
          throw new LockNotAcquiredError();
        }
        return fn();
      });
      return result;
    } catch (err) {
      if (err instanceof LockNotAcquiredError) {
        lastError = err;
        if (attempt < MAX_ACQUISITION_ATTEMPTS) {
          await new Promise((r) => setTimeout(r, WAIT_BETWEEN_ATTEMPTS_MS));
          continue;
        }
        break;
      }
      throw err;
    }
  }

  // Pathological case: lock stuck for > 5 * 50ms = 250ms. Worth a
  // Sentry ping; someone is probably holding a long DB transaction
  // upstream of a refresh.
  Sentry.captureMessage("token-refresh-lock: failed to acquire advisory lock", {
    level: "error",
    tags: { area: "token-refresh-lock", platform, userId },
    extra: { attempts: MAX_ACQUISITION_ATTEMPTS },
  });
  throw new Error(
    `withTokenRefreshLock: failed to acquire ${platform} lock for user ${userId} after ${MAX_ACQUISITION_ATTEMPTS} attempts (last: ${String(lastError)})`
  );
}

class LockNotAcquiredError extends Error {
  constructor() {
    super("advisory lock not acquired");
    this.name = "LockNotAcquiredError";
  }
}
