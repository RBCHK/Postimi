import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { isAdminClerkId } from "@/lib/auth";

// Phase 1b row-count parity check: compare the legacy X-specific tables
// against the platform-agnostic `Social*` tables (dual-write targets).
//
// This endpoint is a throwaway — delete in the same PR that drops the
// legacy tables (`XPost`, `DailyAccountStats`, `FollowersSnapshot`).
//
// Returns 403 for non-admins; 401 for unauthenticated. JSON response only
// (not a redirect, since this is an API route).
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401 });
  }
  if (!isAdminClerkId(clerkId)) {
    return NextResponse.json({ error: "forbidden" }, { status: 403 });
  }

  const users = await prisma.user.findMany({
    select: { id: true, email: true },
    orderBy: { createdAt: "asc" },
  });

  const perUser = await Promise.all(
    users.map(async (u) => {
      const [legacyPosts, socialPosts, legacyDaily, socialDaily, legacyFollowers, socialFollowers] =
        await Promise.all([
          prisma.xPost.count({ where: { userId: u.id } }),
          prisma.socialPost.count({ where: { userId: u.id, platform: "X" } }),
          prisma.dailyAccountStats.count({ where: { userId: u.id } }),
          prisma.socialDailyStats.count({ where: { userId: u.id, platform: "X" } }),
          prisma.followersSnapshot.count({ where: { userId: u.id } }),
          prisma.socialFollowersSnapshot.count({ where: { userId: u.id, platform: "X" } }),
        ]);

      const posts = {
        legacy: legacyPosts,
        social: socialPosts,
        aligned: legacyPosts === socialPosts,
      };
      const daily = {
        legacy: legacyDaily,
        social: socialDaily,
        aligned: legacyDaily === socialDaily,
      };
      const followers = {
        legacy: legacyFollowers,
        social: socialFollowers,
        aligned: legacyFollowers === socialFollowers,
      };
      return {
        userId: u.id,
        email: u.email,
        posts,
        daily,
        followers,
        fullyAligned: posts.aligned && daily.aligned && followers.aligned,
      };
    })
  );

  const misaligned = perUser.filter((r) => !r.fullyAligned);
  return NextResponse.json({
    totalUsers: perUser.length,
    allAligned: misaligned.length === 0,
    misalignedUsers: misaligned.map((r) => r.userId),
    users: perUser,
    checkedAt: new Date().toISOString(),
  });
}
