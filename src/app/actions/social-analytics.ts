"use server";

import { requireUserId } from "@/lib/auth";
import type { Platform } from "@/lib/types";
import {
  getSocialAnalyticsDateRange as _getSocialAnalyticsDateRange,
  getSocialAnalyticsSummary as _getSocialAnalyticsSummary,
  type SocialAnalyticsSummary,
} from "@/lib/server/social-analytics";

export type { SocialAnalyticsSummary };

export async function getSocialAnalyticsDateRange(
  platform: Platform
): Promise<{ from: Date; to: Date } | null> {
  const userId = await requireUserId();
  return _getSocialAnalyticsDateRange(userId, platform);
}

export async function getSocialAnalyticsSummary(
  platform: Platform,
  from: Date,
  to: Date
): Promise<SocialAnalyticsSummary> {
  const userId = await requireUserId();
  return _getSocialAnalyticsSummary(userId, platform, from, to);
}
