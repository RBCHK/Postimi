"use server";

import { requireUserId } from "@/lib/auth";
import {
  suggestNicheForUser,
  NotEnoughPostsError,
  type NicheSuggestResult,
} from "@/lib/server/niche-suggest";
import { QuotaExceededError, RateLimitExceededError } from "@/lib/errors";

export type SuggestNicheResponse =
  | { ok: true; result: NicheSuggestResult }
  | { ok: false; error: string; reason: "not_enough_posts" | "quota" | "rate_limit" | "other" };

export async function suggestNiche(): Promise<SuggestNicheResponse> {
  const userId = await requireUserId();
  try {
    const result = await suggestNicheForUser(userId);
    return { ok: true, result };
  } catch (err) {
    if (err instanceof NotEnoughPostsError) {
      return { ok: false, reason: "not_enough_posts", error: err.message };
    }
    if (err instanceof QuotaExceededError) {
      return {
        ok: false,
        reason: "quota",
        error: "Monthly AI quota exceeded. Try again next billing cycle.",
      };
    }
    if (err instanceof RateLimitExceededError) {
      return {
        ok: false,
        reason: "rate_limit",
        error: "Too many AI requests in the last minute. Try again shortly.",
      };
    }
    return {
      ok: false,
      reason: "other",
      error: err instanceof Error ? err.message : "Failed to suggest a niche.",
    };
  }
}
