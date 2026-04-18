import type { AudienceSize } from "@/generated/prisma";

// ADR-008: four audience bands used to look up the appropriate
// `PlatformBenchmark` row. The thresholds below are the LOWER boundary
// of each band (inclusive). An account with exactly 1000 followers is
// MICRO, not NANO — so the boundary test matters.

export const AUDIENCE_SIZE_BOUNDARIES = {
  NANO: 0,
  MICRO: 1_000,
  MID: 10_000,
  MACRO: 100_000,
} as const;

/**
 * Bucket a follower count into an `AudienceSize` enum value.
 *
 * Boundaries (inclusive lower bound):
 *   NANO  : < 1 000
 *   MICRO : 1 000 – 9 999
 *   MID   : 10 000 – 99 999
 *   MACRO : ≥ 100 000
 *
 * `null` / `undefined` / negative → `NANO` (treat unknown as smallest
 * so we don't accidentally over-claim benchmarks for new accounts).
 */
export function getAudienceSize(followersCount: number | null | undefined): AudienceSize {
  if (followersCount == null || followersCount < AUDIENCE_SIZE_BOUNDARIES.MICRO) return "NANO";
  if (followersCount < AUDIENCE_SIZE_BOUNDARIES.MID) return "MICRO";
  if (followersCount < AUDIENCE_SIZE_BOUNDARIES.MACRO) return "MID";
  return "MACRO";
}
