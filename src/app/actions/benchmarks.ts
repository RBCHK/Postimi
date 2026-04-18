"use server";

import { prisma } from "@/lib/prisma";
import { requireAdmin } from "@/lib/auth";
import type { Platform, AudienceSize, PlatformBenchmark } from "@/generated/prisma";

// ADR-008: PlatformBenchmark is a **global** table (no userId). We use
// it in the Strategist user message so the agent has a concrete frame
// of reference (e.g. "your 1.2% engagement rate is AVG for a NANO X
// account") without us hardcoding it in the system prompt.
//
// Public readers: anyone authenticated (they're looking up benchmarks
// for their own dashboard, no privacy concern).
// Writers: admin-only. We never expose write endpoints to end users.

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

/**
 * Public read — returns all benchmarks for a (platform, audienceSize)
 * pair. Used by Strategist to build the user message.
 */
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

/**
 * Internal variant for cron paths — skips auth. Same semantics.
 */
export async function getBenchmarksInternal(
  platform: Platform,
  audienceSize: AudienceSize
): Promise<BenchmarkRow[]> {
  const rows = await prisma.platformBenchmark.findMany({
    where: { platform, audienceSize },
    orderBy: { metric: "asc" },
  });
  return rows.map(mapRow);
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

/**
 * Admin-only. Upsert by (platform, audienceSize, metric) — the
 * `@@unique` constraint on the model enforces one row per combo.
 */
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

  return mapRow(row);
}

/**
 * Admin-only. Remove a benchmark row.
 */
export async function deleteBenchmark(id: string): Promise<void> {
  await requireAdmin();
  await prisma.platformBenchmark.delete({ where: { id } });
}
