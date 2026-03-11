"use server";

import { prisma } from "@/lib/prisma";
import type { DailyInsightItem, DailyInsightContext } from "@/lib/types";

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
    insights: row.insights as unknown as string[],
    context: row.context as unknown as DailyInsightContext,
    createdAt: row.createdAt,
  };
}

export async function saveDailyInsight(data: {
  date: Date;
  insights: string[];
  context: DailyInsightContext;
}): Promise<DailyInsightItem> {
  const dayStart = toUtcMidnight(data.date);

  const row = await prisma.dailyInsight.upsert({
    where: { date: dayStart },
    create: {
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

export async function getLatestDailyInsight(): Promise<DailyInsightItem | null> {
  const row = await prisma.dailyInsight.findFirst({
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return toItem(row);
}

export async function getTodayInsight(): Promise<DailyInsightItem | null> {
  const today = toUtcMidnight(new Date());
  const row = await prisma.dailyInsight.findUnique({
    where: { date: today },
  });
  if (!row) return null;
  return toItem(row);
}
