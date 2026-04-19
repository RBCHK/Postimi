import { prisma } from "@/lib/prisma";
import type { TrendItem } from "@/lib/types";

export async function saveTrendSnapshots(
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

export async function getLatestTrends(userId: string): Promise<TrendItem[]> {
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

export async function cleanupOldTrends(userId: string, keepDays: number = 10): Promise<number> {
  const cutoff = new Date();
  cutoff.setUTCHours(0, 0, 0, 0);
  cutoff.setUTCDate(cutoff.getUTCDate() - keepDays);

  const result = await prisma.trendSnapshot.deleteMany({
    where: { userId, date: { lt: cutoff } },
  });
  return result.count;
}
