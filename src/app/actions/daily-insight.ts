"use server";

import { requireUserId } from "@/lib/auth";
import type { DailyInsightItem, DailyInsightContext } from "@/lib/types";
import {
  saveDailyInsight as _saveDailyInsight,
  getLatestDailyInsight as _getLatestDailyInsight,
  getTodayInsight as _getTodayInsight,
} from "@/lib/server/daily-insight";

export async function saveDailyInsight(data: {
  date: Date;
  insights: string[];
  context: DailyInsightContext;
}): Promise<DailyInsightItem> {
  const userId = await requireUserId();
  return _saveDailyInsight(userId, data);
}

export async function getLatestDailyInsight(): Promise<DailyInsightItem | null> {
  const userId = await requireUserId();
  return _getLatestDailyInsight(userId);
}

export async function getTodayInsight(): Promise<DailyInsightItem | null> {
  const userId = await requireUserId();
  return _getTodayInsight(userId);
}
