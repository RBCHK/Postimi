import { prisma } from "@/lib/prisma";
import type { DailyInsightContext, DailyInsightItem, DailyInsightPayload } from "@/lib/types";

function toUtcMidnight(d: Date): Date {
  return new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
}

function toItem(row: {
  id: string;
  date: Date;
  insights: unknown;
  context: unknown;
  createdAt: Date;
}): DailyInsightItem {
  return {
    id: row.id,
    date: row.date,
    // The DB stores `insights` as JSON. Pre-2026-04 rows are `string[]`,
    // post-refactor rows are the new `DailyInsightCards` object. The
    // reader (InsightFeed) discriminates via Array.isArray, so we just
    // forward the parsed JSON unchanged.
    insights: row.insights as unknown as DailyInsightPayload,
    context: row.context as unknown as DailyInsightContext,
    createdAt: row.createdAt,
  };
}

export async function saveDailyInsight(
  userId: string,
  data: {
    date: Date;
    insights: DailyInsightPayload;
    context: DailyInsightContext;
  }
): Promise<DailyInsightItem> {
  const dayStart = toUtcMidnight(data.date);

  const row = await prisma.dailyInsight.upsert({
    where: { userId_date: { userId, date: dayStart } },
    create: {
      userId,
      date: dayStart,
      insights: data.insights as unknown as object,
      context: data.context as unknown as object,
    },
    update: {
      insights: data.insights as unknown as object,
      context: data.context as unknown as object,
    },
  });

  return toItem(row);
}

export async function getLatestDailyInsight(userId: string): Promise<DailyInsightItem | null> {
  const row = await prisma.dailyInsight.findFirst({
    where: { userId },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return toItem(row);
}

export async function getTodayInsight(userId: string): Promise<DailyInsightItem | null> {
  const today = toUtcMidnight(new Date());
  const row = await prisma.dailyInsight.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (!row) return null;
  return toItem(row);
}
