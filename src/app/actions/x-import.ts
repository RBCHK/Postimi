"use server";

import { revalidatePath } from "next/cache";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { fetchUserTweets, XApiNoTokenError } from "@/lib/x-api";
import { getXApiTokenForUserInternal } from "@/app/actions/x-token";
import type { XPostType as PrismaXPostType } from "@/generated/prisma";

function detectPostType(text: string): PrismaXPostType {
  return text.startsWith("@") ? "REPLY" : "POST";
}

export async function importFromXApi(
  maxResults: number = 100
): Promise<{ imported: number; updated: number; total: number }> {
  const userId = await requireUserId();
  const credentials = await getXApiTokenForUserInternal(userId);
  if (!credentials) {
    throw new XApiNoTokenError(userId);
  }

  // Get the most recent post ID from DB to avoid re-fetching existing tweets
  const latest = await prisma.xPost.findFirst({
    where: { userId },
    orderBy: { date: "desc" },
    select: { postId: true },
  });

  const tweets = await fetchUserTweets(credentials, maxResults, latest?.postId);

  let imported = 0;
  let updated = 0;

  for (const tweet of tweets) {
    const existing = await prisma.xPost.findUnique({
      where: { userId_postId: { userId, postId: tweet.postId } },
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

    const updateData: Record<string, unknown> = {
      ...apiMetrics,
      dataSource: "API",
    };
    if (tweet.profileVisits !== undefined) {
      updateData.profileVisits = tweet.profileVisits;
    }

    await prisma.xPost.upsert({
      where: { userId_postId: { userId, postId: tweet.postId } },
      create: {
        userId,
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

    if (existing) {
      updated++;
    } else {
      imported++;
    }
  }

  revalidatePath("/analytics");

  return { imported, updated, total: tweets.length };
}
