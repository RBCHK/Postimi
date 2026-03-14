import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { fetchCurrentUser, fetchUserTweetsPaginated } from "@/lib/x-api";
import { revalidatePath } from "next/cache";
import type { XPostType as PrismaXPostType } from "@/generated/prisma";

export const maxDuration = 60;

function detectPostType(text: string): PrismaXPostType {
  return text.startsWith("@") ? "REPLY" : "POST";
}

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
  const { id: userId, username } = await fetchCurrentUser();

  // Fetch since the most recent post in DB
  const latest = await prisma.xPost.findFirst({
    orderBy: { date: "desc" },
    select: { postId: true },
  });

  const tweets = await fetchUserTweetsPaginated(userId, username, {
    sinceId: latest?.postId,
  });

  let imported = 0;
  let updated = 0;

  for (const tweet of tweets) {
    const existing = await prisma.xPost.findUnique({
      where: { postId: tweet.postId },
      select: { createdAt: true },
    });

    await prisma.xPost.upsert({
      where: { postId: tweet.postId },
      create: {
        postId: tweet.postId,
        date: tweet.createdAt,
        text: tweet.text,
        postLink: tweet.postLink,
        postType: detectPostType(tweet.text),
        impressions: tweet.impressions,
        likes: tweet.likes,
        engagements: tweet.engagements,
        bookmarks: tweet.bookmarks,
        shares: tweet.shares,
        newFollowers: 0,
        replies: tweet.replies,
        reposts: tweet.reposts,
        profileVisits: 0,
        detailExpands: 0,
        urlClicks: tweet.urlClicks,
      },
      update: {
        impressions: tweet.impressions,
        likes: tweet.likes,
        engagements: tweet.engagements,
        bookmarks: tweet.bookmarks,
        shares: tweet.shares,
        replies: tweet.replies,
        reposts: tweet.reposts,
        urlClicks: tweet.urlClicks,
      },
    });

    if (existing) updated++;
    else imported++;
  }

  revalidatePath("/analytics");

  return NextResponse.json({
    ok: true,
    imported,
    updated,
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
