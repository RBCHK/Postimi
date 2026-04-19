"use server";

import { requireUserId } from "@/lib/auth";
import {
  saveFollowersSnapshot as _saveFollowersSnapshot,
  getFollowersHistory as _getFollowersHistory,
  getLatestFollowersSnapshot as _getLatestFollowersSnapshot,
} from "@/lib/server/followers";
import type { FollowersSnapshotItem } from "@/lib/types";

export async function saveFollowersSnapshot(data: {
  followersCount: number;
  followingCount: number;
}): Promise<FollowersSnapshotItem> {
  const userId = await requireUserId();
  return _saveFollowersSnapshot(userId, data);
}

export async function getFollowersHistory(days: number = 30): Promise<FollowersSnapshotItem[]> {
  const userId = await requireUserId();
  return _getFollowersHistory(userId, days);
}

export async function getLatestFollowersSnapshot(): Promise<FollowersSnapshotItem | null> {
  const userId = await requireUserId();
  return _getLatestFollowersSnapshot(userId);
}
