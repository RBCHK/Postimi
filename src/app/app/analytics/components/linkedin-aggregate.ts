import type { LinkedInXlsxImportResult } from "@/app/actions/linkedin-xlsx-types";

// Aggregated view across multiple xlsx uploads. LinkedIn produces two
// separate exports (Content + Audience), and merging client-side keeps the
// server action simple — max-metric reconciliation already handles per-post
// overlap.
export interface LinkedInAggregatedResult {
  filesProcessed: number;
  filesFailed: string[];
  postsImported: number;
  postsUpdated: number;
  dailyStatsUpserted: number;
  followerSnapshotsUpserted: number;
  latestTotalFollowers: number;
  earliestWindowStart: string | null;
  latestWindowEnd: string | null;
}

export const EMPTY_LI_RESULT: LinkedInAggregatedResult = {
  filesProcessed: 0,
  filesFailed: [],
  postsImported: 0,
  postsUpdated: 0,
  dailyStatsUpserted: 0,
  followerSnapshotsUpserted: 0,
  latestTotalFollowers: 0,
  earliestWindowStart: null,
  latestWindowEnd: null,
};

export function mergeLinkedInResult(
  prev: LinkedInAggregatedResult,
  next: LinkedInXlsxImportResult
): LinkedInAggregatedResult {
  const earliest =
    prev.earliestWindowStart === null || next.windowStart < prev.earliestWindowStart
      ? next.windowStart
      : prev.earliestWindowStart;
  const latest =
    prev.latestWindowEnd === null || next.windowEnd > prev.latestWindowEnd
      ? next.windowEnd
      : prev.latestWindowEnd;
  return {
    filesProcessed: prev.filesProcessed + 1,
    filesFailed: prev.filesFailed,
    postsImported: prev.postsImported + next.postsImported,
    postsUpdated: prev.postsUpdated + next.postsUpdated,
    dailyStatsUpserted: prev.dailyStatsUpserted + next.dailyStatsUpserted,
    followerSnapshotsUpserted: prev.followerSnapshotsUpserted + next.followerSnapshotsUpserted,
    // LinkedIn exports the cumulative "total followers on export date" once
    // per file; take the max across uploads (order-independent).
    latestTotalFollowers: Math.max(prev.latestTotalFollowers, next.totalFollowers),
    earliestWindowStart: earliest,
    latestWindowEnd: latest,
  };
}
