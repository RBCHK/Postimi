import { NextRequest, NextResponse } from "next/server";
import { fetchPersonalizedTrends } from "@/lib/x-api";
import { saveTrendSnapshots, cleanupOldTrends } from "@/app/actions/trends";

const TREND_RETENTION_DAYS = 10;

export const maxDuration = 30;

export async function GET(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (
    authHeader !== `Bearer ${process.env.CRON_SECRET}` &&
    req.cookies.get("auth")?.value !== "1"
  ) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const trends = await fetchPersonalizedTrends();

    let saved = 0;
    if (trends.length > 0) {
      const now = new Date();
      saved = await saveTrendSnapshots(now, trends, now.getUTCHours());
    }

    const deleted = await cleanupOldTrends(TREND_RETENTION_DAYS);

    return NextResponse.json({
      ok: true,
      trendsFound: trends.length,
      saved,
      cleanedUp: deleted,
    });
  } catch (err) {
    console.error("[trend-snapshot]", err);
    return NextResponse.json(
      { ok: false, error: err instanceof Error ? err.message : String(err) },
      { status: 500 }
    );
  }
}
