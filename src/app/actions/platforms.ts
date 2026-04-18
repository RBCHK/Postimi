"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { PLATFORMS, type Platform } from "@/lib/types";

// ADR-008 Phase 4: which platforms does the user have signal for?
//
// "Connected" is a stronger word than "has token" for LinkedIn, because
// the LinkedIn token only grants publishing — analytics come from CSV
// upload. So a user with zero LinkedIn tokens but LinkedIn CSV imports
// should still see a LinkedIn tab. Threads and X are "connected" iff
// a token exists (they both use API-based ingestion).
//
// X is special: the legacy XPost table still exists in Phase 1a. A
// user who imported X data pre-Phase-1a and has no token should still
// see the X tab. We check either token OR presence of data.

export interface ConnectedPlatforms {
  platforms: Platform[];
  primary: Platform | null;
}

async function _getConnectedPlatforms(userId: string): Promise<ConnectedPlatforms> {
  const [xToken, threadsToken, xPostCount, socialPostCounts] = await Promise.all([
    prisma.xApiToken.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.threadsApiToken.findUnique({ where: { userId }, select: { userId: true } }),
    prisma.xPost.count({ where: { userId } }),
    prisma.socialPost.groupBy({
      by: ["platform"],
      where: { userId },
      _count: { platform: true },
    }),
  ]);

  const socialByPlatform = new Map<Platform, number>(
    socialPostCounts.map((r) => [r.platform as Platform, r._count.platform])
  );

  const connected = new Set<Platform>();
  if (xToken || xPostCount > 0 || (socialByPlatform.get("X") ?? 0) > 0) {
    connected.add("X");
  }
  if ((socialByPlatform.get("LINKEDIN") ?? 0) > 0) {
    connected.add("LINKEDIN");
  }
  if (threadsToken || (socialByPlatform.get("THREADS") ?? 0) > 0) {
    connected.add("THREADS");
  }

  const platforms = PLATFORMS.filter((p) => connected.has(p));

  // Primary tab = the platform with the most recent activity, falling
  // back to X for a brand-new user (so the empty state is familiar).
  let primary: Platform | null = platforms[0] ?? null;
  if (platforms.length > 1) {
    const latestByPlatform = await prisma.socialPost.groupBy({
      by: ["platform"],
      where: { userId, platform: { in: platforms } },
      _max: { postedAt: true },
    });
    const sorted = [...latestByPlatform].sort((a, b) => {
      const ta = a._max.postedAt?.getTime() ?? 0;
      const tb = b._max.postedAt?.getTime() ?? 0;
      return tb - ta;
    });
    if (sorted[0]?._max.postedAt) {
      primary = sorted[0].platform as Platform;
    }
  }

  return { platforms, primary };
}

export async function getConnectedPlatforms(): Promise<ConnectedPlatforms> {
  const userId = await requireUserId();
  return _getConnectedPlatforms(userId);
}

export async function getConnectedPlatformsInternal(userId: string): Promise<ConnectedPlatforms> {
  return _getConnectedPlatforms(userId);
}
