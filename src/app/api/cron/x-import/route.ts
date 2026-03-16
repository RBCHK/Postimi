import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchCurrentUser, fetchUserTweetsPaginated } from "@/lib/x-api";
import { revalidatePath } from "next/cache";
import type { XPostType as PrismaXPostType } from "@/generated/prisma";

export const maxDuration = 60;

const REFRESH_DAYS = 7;

function detectPostType(text: string): PrismaXPostType {
  return text.startsWith("@") ? "REPLY" : "POST";
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    req.cookies.get("auth")?.value !== "1"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const mode = req.nextUrl.searchParams.get("mode"); // "refresh" or default (new posts)

  try {
    const { id: userId, username } = await fetchCurrentUser();

    let tweets;
    if (mode === "refresh") {
      // Refresh mode: re-fetch metrics for posts from the last REFRESH_DAYS days
      const startTime = new Date();
      startTime.setUTCDate(startTime.getUTCDate() - REFRESH_DAYS);
      tweets = await fetchUserTweetsPaginated(userId, username, {
        startTime: startTime.toISOString(),
      });
    } else {
      // Default mode: fetch only new posts since the most recent in DB
      const latest = await prisma.xPost.findFirst({
        orderBy: { date: "desc" },
        select: { postId: true },
      });
      tweets = await fetchUserTweetsPaginated(userId, username, {
        sinceId: latest?.postId,
      });
    }

    let imported = 0;
    let updated = 0;
    let snapshots = 0;

    const snapshotDate = new Date();
    snapshotDate.setUTCHours(0, 0, 0, 0);

    for (const tweet of tweets) {
      const existing = await prisma.xPost.findUnique({
        where: { postId: tweet.postId },
        select: { createdAt: true },
      });

      // API-owned metrics (never touches newFollowers, detailExpands)
      const apiMetrics = {
        impressions: tweet.impressions,
        likes: tweet.likes,
        engagements: tweet.engagements,
        bookmarks: tweet.bookmarks,
        replies: tweet.replies,
        reposts: tweet.reposts,
        quoteCount: tweet.quoteCount,
        urlClicks: tweet.urlClicks,
      };

      // Only update profileVisits if API actually provided it
      const updateData: Record<string, unknown> = {
        ...apiMetrics,
        dataSource: "API",
      };
      if (tweet.profileVisits !== undefined) {
        updateData.profileVisits = tweet.profileVisits;
      }

      await prisma.xPost.upsert({
        where: { postId: tweet.postId },
        create: {
          postId: tweet.postId,
          date: tweet.createdAt,
          text: tweet.text,
          postLink: tweet.postLink,
          postType: detectPostType(tweet.text),
          ...apiMetrics,
          profileVisits: tweet.profileVisits ?? 0,
          dataSource: "API",
        },
        update: updateData,
      });

      if (existing) updated++;
      else imported++;

      // Save engagement snapshot for velocity tracking (posts < REFRESH_DAYS old)
      const postAgeDays = (Date.now() - tweet.createdAt.getTime()) / (1000 * 60 * 60 * 24);
      if (postAgeDays < REFRESH_DAYS) {
        const snapshotMetrics = {
          ...apiMetrics,
          profileVisits: tweet.profileVisits ?? 0,
        };

        await prisma.postEngagementSnapshot.upsert({
          where: {
            postId_snapshotDate: {
              postId: tweet.postId,
              snapshotDate: snapshotDate,
            },
          },
          create: {
            postId: tweet.postId,
            snapshotDate: snapshotDate,
            ...snapshotMetrics,
          },
          update: snapshotMetrics,
        });
        snapshots++;
      }
    }

    revalidatePath("/analytics");

    return NextResponse.json({
      ok: true,
      mode: mode ?? "default",
      imported,
      updated,
      snapshots,
      total: tweets.length,
    });
  } catch (err) {
    console.error("[x-import]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
