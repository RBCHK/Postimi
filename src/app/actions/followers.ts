"use server";

import { prisma } from "@/lib/prisma";
import type { FollowersSnapshotItem } from "@/lib/types";

/** Save a daily followers snapshot, computing delta from previous day */
export async function saveFollowersSnapshot(data: {
  followersCount: number;
  followingCount: number;
}): Promise<FollowersSnapshotItem> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Get previous snapshot to compute deltas
  const prev = await prisma.followersSnapshot.findFirst({
    where: { date: { lt: today } },
    orderBy: { date: "desc" },
  });

  const deltaFollowers = prev ? data.followersCount - prev.followersCount : 0;
  const deltaFollowing = prev ? data.followingCount - prev.followingCount : 0;

  const row = await prisma.followersSnapshot.upsert({
    where: { date: today },
    create: {
      date: today,
      followersCount: data.followersCount,
      followingCount: data.followingCount,
      deltaFollowers,
      deltaFollowing,
    },
    update: {
      followersCount: data.followersCount,
      followingCount: data.followingCount,
      deltaFollowers,
      deltaFollowing,
    },
  });

  return {
    id: row.id,
    date: row.date,
    followersCount: row.followersCount,
    followingCount: row.followingCount,
    deltaFollowers: row.deltaFollowers,
    deltaFollowing: row.deltaFollowing,
  };
}

/** Get followers history for the last N days */
export async function getFollowersHistory(days: number = 30): Promise<FollowersSnapshotItem[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days);

  const rows = await prisma.followersSnapshot.findMany({
    where: { date: { gte: since } },
    orderBy: { date: "asc" },
  });

  return rows.map((r) => ({
    id: r.id,
    date: r.date,
    followersCount: r.followersCount,
    followingCount: r.followingCount,
    deltaFollowers: r.deltaFollowers,
    deltaFollowing: r.deltaFollowing,
  }));
}

/** Get the most recent followers snapshot */
export async function getLatestFollowersSnapshot(): Promise<FollowersSnapshotItem | null> {
  const row = await prisma.followersSnapshot.findFirst({
    orderBy: { date: "desc" },
  });
  if (!row) return null;

  return {
    id: row.id,
    date: row.date,
    followersCount: row.followersCount,
    followingCount: row.followingCount,
    deltaFollowers: row.deltaFollowers,
    deltaFollowing: row.deltaFollowing,
  };
}
