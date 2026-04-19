import { describe, it, expect } from "vitest";
import {
  EMPTY_LI_RESULT,
  mergeLinkedInResult,
  type LinkedInAggregatedResult,
} from "../linkedin-aggregate";
import type { LinkedInXlsxImportResult } from "@/app/actions/linkedin-xlsx-types";

const EMPTY: LinkedInAggregatedResult = EMPTY_LI_RESULT;

function makeResult(overrides: Partial<LinkedInXlsxImportResult> = {}): LinkedInXlsxImportResult {
  return {
    postsImported: 0,
    postsUpdated: 0,
    dailyStatsUpserted: 0,
    followerSnapshotsUpserted: 0,
    windowStart: "2026-01-01T00:00:00.000Z",
    windowEnd: "2026-01-07T00:00:00.000Z",
    totalFollowers: 0,
    ...overrides,
  };
}

describe("mergeLinkedInResult", () => {
  it("folds a single file into an empty aggregate", () => {
    const merged = mergeLinkedInResult(
      EMPTY,
      makeResult({
        postsImported: 5,
        postsUpdated: 2,
        dailyStatsUpserted: 7,
        followerSnapshotsUpserted: 7,
        totalFollowers: 1200,
      })
    );
    expect(merged.filesProcessed).toBe(1);
    expect(merged.filesFailed).toEqual([]);
    expect(merged.postsImported).toBe(5);
    expect(merged.postsUpdated).toBe(2);
    expect(merged.dailyStatsUpserted).toBe(7);
    expect(merged.followerSnapshotsUpserted).toBe(7);
    expect(merged.latestTotalFollowers).toBe(1200);
    expect(merged.earliestWindowStart).toBe("2026-01-01T00:00:00.000Z");
    expect(merged.latestWindowEnd).toBe("2026-01-07T00:00:00.000Z");
  });

  it("sums counters across two files", () => {
    let agg = mergeLinkedInResult(EMPTY, makeResult({ postsImported: 3, dailyStatsUpserted: 7 }));
    agg = mergeLinkedInResult(agg, makeResult({ postsImported: 4, dailyStatsUpserted: 7 }));
    expect(agg.filesProcessed).toBe(2);
    expect(agg.postsImported).toBe(7);
    expect(agg.dailyStatsUpserted).toBe(14);
  });

  it("widens the window when files cover different ranges", () => {
    let agg = mergeLinkedInResult(
      EMPTY,
      makeResult({
        windowStart: "2026-02-01T00:00:00.000Z",
        windowEnd: "2026-02-07T00:00:00.000Z",
      })
    );
    agg = mergeLinkedInResult(
      agg,
      makeResult({
        windowStart: "2026-01-01T00:00:00.000Z",
        windowEnd: "2026-01-31T00:00:00.000Z",
      })
    );
    expect(agg.earliestWindowStart).toBe("2026-01-01T00:00:00.000Z");
    expect(agg.latestWindowEnd).toBe("2026-02-07T00:00:00.000Z");
  });

  it("keeps the larger follower count when two exports disagree", () => {
    // LinkedIn exports a single snapshot per file; when merging, prefer the
    // larger number (typically from the more recent export).
    let agg = mergeLinkedInResult(EMPTY, makeResult({ totalFollowers: 500 }));
    agg = mergeLinkedInResult(agg, makeResult({ totalFollowers: 1200 }));
    expect(agg.latestTotalFollowers).toBe(1200);

    // Order-independent — an older snapshot merged after doesn't overwrite.
    let agg2 = mergeLinkedInResult(EMPTY, makeResult({ totalFollowers: 1200 }));
    agg2 = mergeLinkedInResult(agg2, makeResult({ totalFollowers: 500 }));
    expect(agg2.latestTotalFollowers).toBe(1200);
  });

  it("preserves filesFailed across successful merges", () => {
    const withFailure: LinkedInAggregatedResult = {
      ...EMPTY,
      filesFailed: ["broken.xlsx"],
    };
    const merged = mergeLinkedInResult(withFailure, makeResult({ postsImported: 1 }));
    expect(merged.filesFailed).toEqual(["broken.xlsx"]);
    expect(merged.filesProcessed).toBe(1);
    expect(merged.postsImported).toBe(1);
  });
});
