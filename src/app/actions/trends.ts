"use server";

import { requireUserId } from "@/lib/auth";
import {
  saveTrendSnapshots as _saveTrendSnapshots,
  getLatestTrends as _getLatestTrends,
  cleanupOldTrends as _cleanupOldTrends,
} from "@/lib/server/trends";
import type { TrendItem } from "@/lib/types";

export async function saveTrendSnapshots(
  date: Date,
  trends: (TrendItem & { trendingSince?: string })[],
  fetchHour?: number
): Promise<number> {
  const userId = await requireUserId();
  return _saveTrendSnapshots(userId, date, trends, fetchHour);
}

export async function getLatestTrends(): Promise<TrendItem[]> {
  const userId = await requireUserId();
  return _getLatestTrends(userId);
}

export async function cleanupOldTrends(keepDays: number = 10): Promise<number> {
  const userId = await requireUserId();
  return _cleanupOldTrends(userId, keepDays);
}
