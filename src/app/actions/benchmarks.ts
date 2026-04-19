"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId, requireAdmin } from "@/lib/auth";
import type { Platform, AudienceSize } from "@/generated/prisma";
import {
  getBenchmarks as _getBenchmarks,
  mapBenchmarkRow,
  type BenchmarkRow,
  type BenchmarkThresholds,
} from "@/lib/server/benchmarks";

// PlatformBenchmark is global (no userId). We still gate the public
// read on auth so the endpoint isn't reachable anonymously — anyone
// authenticated can read; writers are admin-only.

export type { BenchmarkRow, BenchmarkThresholds };

export async function getBenchmarks(
  platform: Platform,
  audienceSize: AudienceSize
): Promise<BenchmarkRow[]> {
  await requireUserId();
  return _getBenchmarks(platform, audienceSize);
}

// ─── Admin-only writes ───────────────────────────────────

export interface UpsertBenchmarkInput {
  platform: Platform;
  audienceSize: AudienceSize;
  metric: string;
  strongThreshold: number;
  avgThreshold: number;
  weakThreshold: number;
  source: string;
  sourceUrl: string;
}

export async function upsertBenchmark(input: UpsertBenchmarkInput): Promise<BenchmarkRow> {
  await requireAdmin();

  if (input.strongThreshold < input.avgThreshold || input.avgThreshold < input.weakThreshold) {
    throw new Error("Threshold ordering invalid: expected strong >= avg >= weak");
  }

  const row = await prisma.platformBenchmark.upsert({
    where: {
      platform_audienceSize_metric: {
        platform: input.platform,
        audienceSize: input.audienceSize,
        metric: input.metric,
      },
    },
    create: input,
    update: {
      strongThreshold: input.strongThreshold,
      avgThreshold: input.avgThreshold,
      weakThreshold: input.weakThreshold,
      source: input.source,
      sourceUrl: input.sourceUrl,
    },
  });

  return mapBenchmarkRow(row);
}

export async function deleteBenchmark(id: string): Promise<void> {
  await requireAdmin();
  await prisma.platformBenchmark.delete({ where: { id } });
}
