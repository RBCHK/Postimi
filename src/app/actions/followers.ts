"use server";

import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type { FollowersSnapshotItem } from "@/lib/types";

function mapRow(row: {
  id: string;
  date: Date;
  followersCount: number;
  followingCount: number;
  deltaFollowers: number;
  deltaFollowing: number;
}): FollowersSnapshotItem {
  return {
    id: row.id,
    date: row.date,
    followersCount: row.followersCount,
    followingCount: row.followingCount,
    deltaFollowers: row.deltaFollowers,
    deltaFollowing: row.deltaFollowing,
  };
}

/** Save a daily followers snapshot, computing delta from previous day */
export async function saveFollowersSnapshot(data: {
  followersCount: number;
  followingCount: number;
}): Promise<FollowersSnapshotItem> {
  const userId = await requireUserId();
  return _saveFollowersSnapshot(userId, data);
}

export async function saveFollowersSnapshotInternal(
  userId: string,
  data: {
    followersCount: number;
    followingCount: number;
  }
): Promise<FollowersSnapshotItem> {
  return _saveFollowersSnapshot(userId, data);
}

async function _saveFollowersSnapshot(
  userId: string,
  data: {
    followersCount: number;
    followingCount: number;
  }
): Promise<FollowersSnapshotItem> {
  const today = new Date();
  today.setUTCHours(0, 0, 0, 0);

  // Get previous snapshot to compute deltas
  const prev = await prisma.followersSnapshot.findFirst({
    where: { userId, date: { lt: today } },
    orderBy: { date: "desc" },
  });

  const deltaFollowers = prev ? data.followersCount - prev.followersCount : 0;
  const deltaFollowing = prev ? data.followingCount - prev.followingCount : 0;

  const row = await prisma.followersSnapshot.upsert({
    where: { userId_date: { userId, date: today } },
    create: {
      userId,
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

  // ADR-008 Phase 1a: dual-write to SocialFollowersSnapshot with platform="X".
  // This file is called from the followers-snapshot cron (X-only today).
  // Wrapped so a SocialFollowersSnapshot failure never affects the legacy
  // write. Phase 1b removes the legacy branch.
  try {
    await prisma.socialFollowersSnapshot.upsert({
      where: {
        userId_platform_date: { userId, platform: "X", date: today },
      },
      create: {
        userId,
        platform: "X",
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
  } catch (err) {
    Sentry.captureException(err, {
      tags: { phase: "1a-dual-write", model: "SocialFollowersSnapshot", platform: "X" },
      extra: { userId, date: today.toISOString() },
    });
  }

  return mapRow(row);
}

/** Get followers history for the last N days */
export async function getFollowersHistory(days: number = 30): Promise<FollowersSnapshotItem[]> {
  const userId = await requireUserId();
  return _getFollowersHistory(userId, days);
}

export async function getFollowersHistoryInternal(
  userId: string,
  days: number = 30
): Promise<FollowersSnapshotItem[]> {
  return _getFollowersHistory(userId, days);
}

async function _getFollowersHistory(
  userId: string,
  days: number
): Promise<FollowersSnapshotItem[]> {
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);
  since.setUTCDate(since.getUTCDate() - days);

  const rows = await prisma.followersSnapshot.findMany({
    where: { userId, date: { gte: since } },
    orderBy: { date: "asc" },
  });

  return rows.map(mapRow);
}

/** Get the most recent followers snapshot */
export async function getLatestFollowersSnapshot(): Promise<FollowersSnapshotItem | null> {
  const userId = await requireUserId();
  return _getLatestFollowersSnapshot(userId);
}

export async function getLatestFollowersSnapshotInternal(
  userId: string
): Promise<FollowersSnapshotItem | null> {
  return _getLatestFollowersSnapshot(userId);
}

async function _getLatestFollowersSnapshot(userId: string): Promise<FollowersSnapshotItem | null> {
  const row = await prisma.followersSnapshot.findFirst({
    where: { userId },
    orderBy: { date: "desc" },
  });
  if (!row) return null;
  return mapRow(row);
}
