import { NextRequest, NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { fetchUserData } from "@/lib/x-api";
import { saveFollowersSnapshotInternal } from "@/app/actions/followers";

export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const users = await prisma.user.findMany({ select: { id: true } });
    const results: {
      userId: string;
      followers?: number;
      deltaFollowers?: number;
      error?: string;
    }[] = [];

    for (const user of users) {
      try {
        const userData = await fetchUserData();
        const snapshot = await saveFollowersSnapshotInternal(user.id, {
          followersCount: userData.followersCount,
          followingCount: userData.followingCount,
        });

        results.push({
          userId: user.id,
          followers: snapshot.followersCount,
          deltaFollowers: snapshot.deltaFollowers,
        });
      } catch (err) {
        Sentry.captureException(err);
        console.error(`[followers-snapshot] user=${user.id}`, err);
        results.push({
          userId: user.id,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    return NextResponse.json({ ok: true, results });
  } catch (err) {
    Sentry.captureException(err);
    console.error("[followers-snapshot]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
