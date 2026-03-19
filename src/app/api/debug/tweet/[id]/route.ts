import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { fetchTweetMetrics } from "@/lib/x-api";
import { getXApiTokenForUserInternal } from "@/app/actions/x-token";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const userId = await requireUserId();
  const { id: tweetId } = await params;

  try {
    const credentials = await getXApiTokenForUserInternal(userId);
    if (!credentials) {
      return NextResponse.json({ error: "No X account connected" }, { status: 400 });
    }

    const [apiRaw, dbRecord, snapshots] = await Promise.all([
      fetchTweetMetrics(credentials, tweetId),
      prisma.xPost.findFirst({ where: { userId, postId: tweetId } }),
      prisma.postEngagementSnapshot.findMany({
        where: { userId, postId: tweetId },
        orderBy: { snapshotDate: "desc" },
      }),
    ]);

    if (!apiRaw) {
      return NextResponse.json({ error: "Tweet not found via X API" }, { status: 404 });
    }

    const pub = apiRaw.public_metrics;
    const priv = apiRaw.non_public_metrics;

    const apiMapped = {
      postId: apiRaw.id,
      createdAt: apiRaw.created_at,
      impressions: priv?.impression_count ?? pub.impression_count ?? 0,
      likes: pub.like_count,
      engagements: priv?.engagements ?? 0,
      bookmarks: pub.bookmark_count,
      replies: pub.reply_count,
      reposts: pub.retweet_count,
      quoteCount: pub.quote_count ?? 0,
      urlClicks: priv?.url_clicks ?? 0,
      profileVisits: apiRaw.organic_metrics?.user_profile_clicks ?? 0,
    };

    const diff = dbRecord
      ? {
          impressions: apiMapped.impressions - dbRecord.impressions,
          likes: apiMapped.likes - dbRecord.likes,
          engagements: apiMapped.engagements - dbRecord.engagements,
          bookmarks: apiMapped.bookmarks - dbRecord.bookmarks,
          replies: apiMapped.replies - dbRecord.replies,
          reposts: apiMapped.reposts - dbRecord.reposts,
          quoteCount: apiMapped.quoteCount - dbRecord.quoteCount,
          urlClicks: apiMapped.urlClicks - dbRecord.urlClicks,
          profileVisits: apiMapped.profileVisits - dbRecord.profileVisits,
          dataSource: dbRecord.dataSource,
        }
      : null;

    return NextResponse.json({
      api: {
        raw: apiRaw,
        mapped: apiMapped,
      },
      db: dbRecord,
      diff,
      snapshots,
    });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
