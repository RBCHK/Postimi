import { prisma } from "@/lib/prisma";
import type { Platform, AudienceSize, PlatformBenchmark } from "@/generated/prisma";

// ADR-008: PlatformBenchmark is a **global** table (no userId). Strategist
// uses it in the user message so the agent has a concrete frame of
// reference (e.g. "your 1.2% engagement rate is AVG for a NANO X
// account"). Writers are admin-only (see src/app/actions/benchmarks.ts).

export interface BenchmarkThresholds {
  strong: number;
  avg: number;
  weak: number;
}

export interface BenchmarkRow {
  platform: Platform;
  audienceSize: AudienceSize;
  metric: string;
  thresholds: BenchmarkThresholds;
  source: string;
  sourceUrl: string;
}

function mapRow(row: PlatformBenchmark): BenchmarkRow {
  return {
    platform: row.platform,
    audienceSize: row.audienceSize,
    metric: row.metric,
    thresholds: {
      strong: row.strongThreshold,
      avg: row.avgThreshold,
      weak: row.weakThreshold,
    },
    source: row.source,
    sourceUrl: row.sourceUrl,
  };
}

export async function getBenchmarks(
  platform: Platform,
  audienceSize: AudienceSize
): Promise<BenchmarkRow[]> {
  const rows = await prisma.platformBenchmark.findMany({
    where: { platform, audienceSize },
    orderBy: { metric: "asc" },
  });
  return rows.map(mapRow);
}

export { mapRow as mapBenchmarkRow };
