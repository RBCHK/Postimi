/**
 * Thrown when a user attempts an AI operation without an active subscription.
 * Caught by server actions/API routes to return structured { ok: false, error: "subscription_required" }.
 */
export class SubscriptionRequiredError extends Error {
  constructor() {
    super("Active subscription required");
    this.name = "SubscriptionRequiredError";
  }
}

/**
 * Thrown when a user's AI usage exceeds their monthly quota.
 * Caught by server actions/API routes to return structured { ok: false, error: "quota_exceeded" }.
 */
export class QuotaExceededError extends Error {
  constructor(
    public readonly usedUsd: number,
    public readonly limitUsd: number
  ) {
    super(`AI quota exceeded: $${usedUsd.toFixed(2)} / $${limitUsd.toFixed(2)}`);
    this.name = "QuotaExceededError";
  }
}

/**
 * Thrown when a user exceeds the per-minute request rate limit.
 */
export class RateLimitExceededError extends Error {
  constructor(public readonly limitPerMinute: number) {
    super(`Rate limit exceeded: ${limitPerMinute} requests per minute`);
    this.name = "RateLimitExceededError";
  }
}
