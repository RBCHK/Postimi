import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { AiUsageStatus } from "@/generated/prisma";
import { isAdminClerkId } from "@/lib/auth";
import { requireActiveSubscription } from "@/lib/subscription";
import { calculateCost } from "@/lib/ai-cost";
import { PLANS } from "@/lib/plans";
import { QuotaExceededError, RateLimitExceededError } from "@/lib/errors";

/**
 * Postgres serialization failure (SQLSTATE 40001). Raised when two
 * Serializable transactions conflict — safe to retry with backoff.
 * Prisma surfaces it as code "P2034".
 */
function isSerializationFailure(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const e = err as { code?: string; meta?: { code?: string } };
  return e.code === "P2034" || e.meta?.code === "40001";
}

async function withSerializationRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (!isSerializationFailure(err) || attempt === maxAttempts) throw err;
      lastErr = err;
      // Exponential backoff with jitter: 20-40ms, 40-80ms
      const base = 20 * 2 ** (attempt - 1);
      await new Promise((r) => setTimeout(r, base + Math.random() * base));
    }
  }
  throw lastErr;
}

/**
 * Per-operation worst-case cost estimate. Used for RESERVED records.
 * Real cost is written back in onFinish via completeReservation.
 */
export const OPERATION_ESTIMATES: Record<string, { model: string; estimatedCostUsd: number }> = {
  chat: { model: "claude-sonnet-4-6", estimatedCostUsd: 0.15 },
  strategist: { model: "claude-sonnet-4-6", estimatedCostUsd: 0.5 },
  researcher: { model: "claude-sonnet-4-6", estimatedCostUsd: 0.5 },
  daily_insight: { model: "claude-haiku-4-5-20251001", estimatedCostUsd: 0.05 },
  generate_post: { model: "claude-sonnet-4-6", estimatedCostUsd: 0.1 },
};

/**
 * Atomic rolling 1-minute rate limit on the User row. Exported so
 * non-AI auth-gated endpoints (e.g. fetchTweetFullTextAction, which
 * burns a user's X API quota per call) can share the same counter
 * — no separate infra, and an attacker can't bypass the AI cap by
 * spraying another action.
 */
export async function checkRateLimit(userId: string): Promise<void> {
  const now = new Date();
  const windowMs = 60 * 1000;

  await withSerializationRetry(() =>
    prisma.$transaction(async (tx) => {
      const user = await tx.user.findUnique({
        where: { id: userId },
        select: { rateLimitWindowStart: true, rateLimitRequestCount: true },
      });
      if (!user) throw new Error("User not found");

      const windowExpired =
        !user.rateLimitWindowStart ||
        now.getTime() - user.rateLimitWindowStart.getTime() > windowMs;

      if (windowExpired) {
        await tx.user.update({
          where: { id: userId },
          data: { rateLimitWindowStart: now, rateLimitRequestCount: 1 },
        });
        return;
      }

      if (user.rateLimitRequestCount >= PLANS.pro.rateLimitRequestsPerMinute) {
        throw new RateLimitExceededError(PLANS.pro.rateLimitRequestsPerMinute);
      }

      await tx.user.update({
        where: { id: userId },
        data: { rateLimitRequestCount: { increment: 1 } },
      });
    })
  );
}

/**
 * Reserves budget BEFORE an AI request. Atomic check+insert in a Serializable
 * transaction closes the race condition for parallel requests.
 *
 * Caller MUST eventually call one of:
 *   - completeReservation({ reservationId, ... }) on successful finish
 *   - abortReservation(reservationId) on stream abort (tokens may have been billed)
 *   - failReservation(reservationId) if request never reached Anthropic
 *
 * Otherwise the reservation stays RESERVED and blocks quota until cleanup cron
 * sweeps it (10-min threshold).
 */
export async function reserveQuota(params: {
  userId: string;
  operation: string;
}): Promise<{ reservationId: string; model: string }> {
  const estimate = OPERATION_ESTIMATES[params.operation];
  if (!estimate) throw new Error(`Unknown operation: ${params.operation}`);

  const user = await prisma.user.findUnique({
    where: { id: params.userId },
    select: { clerkId: true, monthlyAiQuotaUsd: true },
  });
  if (!user) throw new Error("User not found");

  const isAdmin = isAdminClerkId(user.clerkId);

  if (!isAdmin) {
    await checkRateLimit(params.userId);
    const subscription = await requireActiveSubscription(params.userId);

    const quota = user.monthlyAiQuotaUsd
      ? Number(user.monthlyAiQuotaUsd)
      : PLANS.pro.monthlyAiQuotaUsd;

    const reservation = await withSerializationRetry(() =>
      prisma.$transaction(
        async (tx) => {
          const agg = await tx.aiUsage.aggregate({
            where: {
              userId: params.userId,
              createdAt: { gte: subscription.currentPeriodStart },
              status: {
                in: [AiUsageStatus.RESERVED, AiUsageStatus.COMPLETED, AiUsageStatus.ABORTED],
              },
            },
            _sum: { costUsd: true },
          });
          const spent = Number(agg._sum.costUsd ?? 0);
          if (spent + estimate.estimatedCostUsd > quota) {
            throw new QuotaExceededError(spent, quota);
          }
          return tx.aiUsage.create({
            data: {
              userId: params.userId,
              operation: params.operation,
              model: estimate.model,
              costUsd: estimate.estimatedCostUsd,
              status: AiUsageStatus.RESERVED,
            },
            select: { id: true },
          });
        },
        { isolationLevel: "Serializable" }
      )
    );
    return { reservationId: reservation.id, model: estimate.model };
  }

  // Admin: reservation without quota/rate-limit check (still tracked in dashboard)
  const reservation = await prisma.aiUsage.create({
    data: {
      userId: params.userId,
      operation: params.operation,
      model: estimate.model,
      costUsd: 0,
      status: AiUsageStatus.RESERVED,
    },
    select: { id: true },
  });
  return { reservationId: reservation.id, model: estimate.model };
}

/**
 * Closes a reservation with real token usage from onFinish.
 * Failure here = billing hole → Sentry alert (not silent).
 */
export async function completeReservation(params: {
  reservationId: string;
  model: string;
  tokensIn: number;
  tokensOut: number;
}): Promise<void> {
  const costUsd = calculateCost(params.model, params.tokensIn, params.tokensOut);
  try {
    await prisma.aiUsage.update({
      where: { id: params.reservationId },
      data: {
        model: params.model,
        tokensIn: params.tokensIn,
        tokensOut: params.tokensOut,
        costUsd,
        status: AiUsageStatus.COMPLETED,
      },
    });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { area: "ai-quota", reservationId: params.reservationId },
    });
    console.error("[completeReservation] CRITICAL: failed to record usage", err);
  }
}

/**
 * Marks a reservation as ABORTED (stream cut off). Stays in quota — safer over-count,
 * since Anthropic may have billed partial tokens.
 */
export async function abortReservation(reservationId: string): Promise<void> {
  try {
    await prisma.aiUsage.update({
      where: { id: reservationId },
      data: { status: AiUsageStatus.ABORTED },
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "ai-quota", reservationId } });
  }
}

/**
 * Marks a reservation as FAILED (request never reached Anthropic).
 * Excluded from quota — user isn't charged for something that didn't happen.
 */
/**
 * Sweeps RESERVED rows older than 10 min → ABORTED. Safe to call from any cron.
 * Returns number of rows swept.
 */
export async function sweepStaleReservations(): Promise<number> {
  const staleThreshold = new Date(Date.now() - 10 * 60 * 1000);
  const result = await prisma.aiUsage.updateMany({
    where: { status: AiUsageStatus.RESERVED, createdAt: { lt: staleThreshold } },
    data: { status: AiUsageStatus.ABORTED },
  });
  if (result.count > 0) {
    Sentry.captureMessage(
      `[sweepStaleReservations] swept ${result.count} stale reservations`,
      "warning"
    );
  }
  return result.count;
}

export async function failReservation(reservationId: string): Promise<void> {
  try {
    await prisma.aiUsage.update({
      where: { id: reservationId },
      data: { status: AiUsageStatus.FAILED },
    });
  } catch (err) {
    Sentry.captureException(err, { tags: { area: "ai-quota", reservationId } });
  }
}
