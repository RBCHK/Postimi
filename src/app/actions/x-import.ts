"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { fetchUserTweets, XApiNoTokenError } from "@/lib/x-api";
import { getXApiTokenForUser } from "@/lib/server/x-token";

// Phase 1b: this manual "Import from X" button now writes to SocialPost
// with `platform: "X"`. The cron version in src/app/api/cron/x-import
// shares the same upsert shape.

function detectPostType(text: string): "POST" | "REPLY" {
  return text.startsWith("@") ? "REPLY" : "POST";
}

export async function importFromXApi(
  maxResults: number = 100
): Promise<{ imported: number; updated: number; total: number }> {
  const userId = await requireUserId();
  const credentials = await getXApiTokenForUser(userId);
  if (!credentials) {
    throw new XApiNoTokenError(userId);
  }

  // Get the most recent post to avoid re-fetching existing tweets
  const latest = await prisma.socialPost.findFirst({
    where: { userId, platform: "X" },
    orderBy: { postedAt: "desc" },
    select: { externalPostId: true },
  });

  const tweets = await fetchUserTweets(credentials, maxResults, latest?.externalPostId);

  let imported = 0;
  let updated = 0;

  for (const tweet of tweets) {
    const existing = await prisma.socialPost.findUnique({
      where: {
        userId_platform_externalPostId: {
          userId,
          platform: "X",
          externalPostId: tweet.postId,
        },
      },
      select: { createdAt: true },
    });

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

    const postType = detectPostType(tweet.text);

    const updateData: Record<string, unknown> = {
      ...apiMetrics,
      dataSource: "API",
    };
    if (tweet.profileVisits !== undefined) {
      updateData.profileVisits = tweet.profileVisits;
    }

    await prisma.socialPost.upsert({
      where: {
        userId_platform_externalPostId: {
          userId,
          platform: "X",
          externalPostId: tweet.postId,
        },
      },
      create: {
        userId,
        platform: "X",
        externalPostId: tweet.postId,
        postedAt: tweet.createdAt,
        text: tweet.text,
        postUrl: tweet.postLink,
        postType,
        platformMetadata: { platform: "X", postType },
        ...apiMetrics,
        profileVisits: tweet.profileVisits ?? 0,
        dataSource: "API",
      },
      update: updateData,
    });

    if (existing) {
      updated++;
    } else {
      imported++;
    }
  }

  revalidatePath("/analytics");

  return { imported, updated, total: tweets.length };
}
