import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "../../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";
import type { Platform, AudienceSize } from "../../src/generated/prisma";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// ADR-008: thresholds sourced from public engagement-rate reports. We
// use the MEDIAN values from industry benchmarks, not hero cases, and
// cite each source. Admins can override via the admin UI; this seed is
// just a sane starting point.
//
// Numbers are "threshold is the LOWER bound of the band":
//   strongThreshold = the value at which you're in the top bucket
//   avgThreshold    = the value at which you're in the middle bucket
//   weakThreshold   = the value at which you're in the bottom bucket
//   below weakThreshold = poor / needs urgent fix
//
// All rates are expressed as a PERCENTAGE (so 2.5 means 2.5 %).

interface BenchmarkSeed {
  platform: Platform;
  audienceSize: AudienceSize;
  metric: string;
  strongThreshold: number;
  avgThreshold: number;
  weakThreshold: number;
  source: string;
  sourceUrl: string;
}

const SEEDS: BenchmarkSeed[] = [
  // ─── X / Twitter engagement rate (likes + reposts + replies / impressions * 100) ─
  {
    platform: "X",
    audienceSize: "NANO",
    metric: "engagement_rate",
    strongThreshold: 2.5,
    avgThreshold: 1.0,
    weakThreshold: 0.3,
    source: "Rival IQ Social Media Industry Benchmark Report 2025",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },
  {
    platform: "X",
    audienceSize: "MICRO",
    metric: "engagement_rate",
    strongThreshold: 2.0,
    avgThreshold: 0.8,
    weakThreshold: 0.25,
    source: "Rival IQ Social Media Industry Benchmark Report 2025",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },
  {
    platform: "X",
    audienceSize: "MID",
    metric: "engagement_rate",
    strongThreshold: 1.5,
    avgThreshold: 0.6,
    weakThreshold: 0.2,
    source: "Rival IQ Social Media Industry Benchmark Report 2025",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },
  {
    platform: "X",
    audienceSize: "MACRO",
    metric: "engagement_rate",
    strongThreshold: 1.0,
    avgThreshold: 0.4,
    weakThreshold: 0.15,
    source: "Rival IQ Social Media Industry Benchmark Report 2025",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },
  // X — monthly follower growth %
  {
    platform: "X",
    audienceSize: "NANO",
    metric: "follower_growth_monthly_pct",
    strongThreshold: 10.0,
    avgThreshold: 3.0,
    weakThreshold: 1.0,
    source: "Twitter/X growth benchmarks (internal analysis)",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },
  {
    platform: "X",
    audienceSize: "MICRO",
    metric: "follower_growth_monthly_pct",
    strongThreshold: 5.0,
    avgThreshold: 2.0,
    weakThreshold: 0.5,
    source: "Twitter/X growth benchmarks (internal analysis)",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },
  {
    platform: "X",
    audienceSize: "MID",
    metric: "follower_growth_monthly_pct",
    strongThreshold: 3.0,
    avgThreshold: 1.0,
    weakThreshold: 0.3,
    source: "Twitter/X growth benchmarks (internal analysis)",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },
  {
    platform: "X",
    audienceSize: "MACRO",
    metric: "follower_growth_monthly_pct",
    strongThreshold: 2.0,
    avgThreshold: 0.5,
    weakThreshold: 0.15,
    source: "Twitter/X growth benchmarks (internal analysis)",
    sourceUrl: "https://www.rivaliq.com/blog/social-media-industry-benchmark-report/",
  },

  // ─── LinkedIn engagement rate (reactions + comments + shares / impressions * 100) ──
  {
    platform: "LINKEDIN",
    audienceSize: "NANO",
    metric: "engagement_rate",
    strongThreshold: 5.0,
    avgThreshold: 2.5,
    weakThreshold: 1.0,
    source: "Hootsuite LinkedIn Algorithm Report 2025",
    sourceUrl: "https://blog.hootsuite.com/linkedin-algorithm/",
  },
  {
    platform: "LINKEDIN",
    audienceSize: "MICRO",
    metric: "engagement_rate",
    strongThreshold: 4.0,
    avgThreshold: 2.0,
    weakThreshold: 0.8,
    source: "Hootsuite LinkedIn Algorithm Report 2025",
    sourceUrl: "https://blog.hootsuite.com/linkedin-algorithm/",
  },
  {
    platform: "LINKEDIN",
    audienceSize: "MID",
    metric: "engagement_rate",
    strongThreshold: 3.0,
    avgThreshold: 1.5,
    weakThreshold: 0.5,
    source: "Hootsuite LinkedIn Algorithm Report 2025",
    sourceUrl: "https://blog.hootsuite.com/linkedin-algorithm/",
  },
  {
    platform: "LINKEDIN",
    audienceSize: "MACRO",
    metric: "engagement_rate",
    strongThreshold: 2.0,
    avgThreshold: 1.0,
    weakThreshold: 0.3,
    source: "Hootsuite LinkedIn Algorithm Report 2025",
    sourceUrl: "https://blog.hootsuite.com/linkedin-algorithm/",
  },

  // ─── Threads engagement rate (Meta reports engagement in low single digits) ─
  {
    platform: "THREADS",
    audienceSize: "NANO",
    metric: "engagement_rate",
    strongThreshold: 4.0,
    avgThreshold: 1.5,
    weakThreshold: 0.5,
    source: "Meta Threads Creator Insights 2025",
    sourceUrl: "https://about.fb.com/news/tag/threads/",
  },
  {
    platform: "THREADS",
    audienceSize: "MICRO",
    metric: "engagement_rate",
    strongThreshold: 3.0,
    avgThreshold: 1.2,
    weakThreshold: 0.4,
    source: "Meta Threads Creator Insights 2025",
    sourceUrl: "https://about.fb.com/news/tag/threads/",
  },
  {
    platform: "THREADS",
    audienceSize: "MID",
    metric: "engagement_rate",
    strongThreshold: 2.0,
    avgThreshold: 0.8,
    weakThreshold: 0.25,
    source: "Meta Threads Creator Insights 2025",
    sourceUrl: "https://about.fb.com/news/tag/threads/",
  },
  {
    platform: "THREADS",
    audienceSize: "MACRO",
    metric: "engagement_rate",
    strongThreshold: 1.5,
    avgThreshold: 0.5,
    weakThreshold: 0.15,
    source: "Meta Threads Creator Insights 2025",
    sourceUrl: "https://about.fb.com/news/tag/threads/",
  },
];

async function main() {
  console.log(`Seeding ${SEEDS.length} platform benchmarks...`);
  let inserted = 0;
  let updated = 0;

  for (const seed of SEEDS) {
    const existing = await prisma.platformBenchmark.findUnique({
      where: {
        platform_audienceSize_metric: {
          platform: seed.platform,
          audienceSize: seed.audienceSize,
          metric: seed.metric,
        },
      },
    });

    if (existing) {
      await prisma.platformBenchmark.update({
        where: { id: existing.id },
        data: {
          strongThreshold: seed.strongThreshold,
          avgThreshold: seed.avgThreshold,
          weakThreshold: seed.weakThreshold,
          source: seed.source,
          sourceUrl: seed.sourceUrl,
        },
      });
      updated++;
    } else {
      await prisma.platformBenchmark.create({ data: seed });
      inserted++;
    }
  }

  console.log(`Done. Inserted: ${inserted}, updated: ${updated}.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
