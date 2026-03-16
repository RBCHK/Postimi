import { NextRequest, NextResponse } from "next/server";
import { fetchUserData } from "@/lib/x-api";
import { saveFollowersSnapshot } from "@/app/actions/followers";

export const maxDuration = 10;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    req.cookies.get("auth")?.value !== "1"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const userData = await fetchUserData();
    const snapshot = await saveFollowersSnapshot({
      followersCount: userData.followersCount,
      followingCount: userData.followingCount,
    });

    return NextResponse.json({
      ok: true,
      followers: snapshot.followersCount,
      deltaFollowers: snapshot.deltaFollowers,
    });
  } catch (err) {
    console.error("[followers-snapshot]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
