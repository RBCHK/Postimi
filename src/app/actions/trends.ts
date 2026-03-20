"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type { TrendItem } from "@/lib/types";

/** Save a batch of trend snapshots for a given date and fetch hour */
export async function saveTrendSnapshots(
  date: Date,
  trends: (TrendItem & { trendingSince?: string })[],
  fetchHour?: number
): Promise<number> {
  const userId = await requireUserId();
  return _saveTrendSnapshots(userId, date, trends, fetchHour);
}

/** Internal variant for cron routes (no auth check) */
export async function saveTrendSnapshotsInternal(
  userId: string,
  date: Date,
  trends: (TrendItem & { trendingSince?: string })[],
  fetchHour?: number
): Promise<number> {
  return _saveTrendSnapshots(userId, date, trends, fetchHour);
}

async function _saveTrendSnapshots(
  userId: string,
  date: Date,
  trends: (TrendItem & { trendingSince?: string })[],
  fetchHour?: number
): Promise<number> {
  const day = new Date(date);
  const hour = fetchHour ?? day.getUTCHours();
  day.setUTCHours(0, 0, 0, 0);

  const data = trends.map((t) => ({
    userId,
    date: day,
    fetchHour: hour,
    trendName: t.trendName,
    postCount: t.postCount,
    category: t.category ?? null,
    trendingSince: t.trendingSince ? new Date(t.trendingSince) : null,
  }));

  const result = await prisma.trendSnapshot.createMany({ data });
  return result.count;
}

/** Get trends from the most recent fetch for the current user */
export async function getLatestTrends(): Promise<TrendItem[]> {
  const userId = await requireUserId();
  return _getLatestTrends(userId);
}

/** Internal variant for cron routes (no auth check) */
export async function getLatestTrendsInternal(userId: string): Promise<TrendItem[]> {
  return _getLatestTrends(userId);
}

async function _getLatestTrends(userId: string): Promise<TrendItem[]> {
  // Find the most recent snapshot for this user by date DESC, then fetchHour DESC
  const latest = await prisma.trendSnapshot.findFirst({
    where: { userId },
    orderBy: [{ date: "desc" }, { fetchHour: "desc" }],
    select: { date: true, fetchHour: true },
  });
  if (!latest) return [];

  const rows = await prisma.trendSnapshot.findMany({
    where: { userId, date: latest.date, fetchHour: latest.fetchHour },
    orderBy: { postCount: "desc" },
  });

  return rows.map((r) => ({
    trendName: r.trendName,
    postCount: r.postCount,
    category: r.category ?? undefined,
  }));
}

/** Delete trend snapshots older than keepDays (default 10) for the current user */
export async function cleanupOldTrends(keepDays: number = 10): Promise<number> {
  const userId = await requireUserId();
  return _cleanupOldTrends(userId, keepDays);
}

/** Internal variant for cron routes (no auth check) */
export async function cleanupOldTrendsInternal(
  userId: string,
  keepDays: number = 10
): Promise<number> {
  return _cleanupOldTrends(userId, keepDays);
}

async function _cleanupOldTrends(userId: string, keepDays: number): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);

  const result = await prisma.trendSnapshot.deleteMany({
    where: { userId, date: { lt: cutoff } },
  });
  return result.count;
}
