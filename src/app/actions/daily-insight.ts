"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
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
  const userId = await requireUserId();
  return _saveDailyInsight(userId, data);
}

export async function saveDailyInsightInternal(
  userId: string,
  data: {
    date: Date;
    insights: string[];
    context: DailyInsightContext;
  }
): Promise<DailyInsightItem> {
  return _saveDailyInsight(userId, data);
}

async function _saveDailyInsight(
  userId: string,
  data: {
    date: Date;
    insights: string[];
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

export async function getLatestDailyInsight(): Promise<DailyInsightItem | null> {
  const userId = await requireUserId();
  const row = await prisma.dailyInsight.findFirst({
    where: { userId },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return toItem(row);
}

export async function getTodayInsight(): Promise<DailyInsightItem | null> {
  const userId = await requireUserId();
  const today = toUtcMidnight(new Date());
  const row = await prisma.dailyInsight.findUnique({
    where: { userId_date: { userId, date: today } },
  });
  if (!row) return null;
  return toItem(row);
}
