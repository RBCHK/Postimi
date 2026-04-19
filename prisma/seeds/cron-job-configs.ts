import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "../../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

// CronJobConfig rows enable the admin UI to list + toggle + trigger each
// cron. `withCronLogging` treats a missing row as enabled, so seeding is
// purely for visibility in the admin panel — not correctness. Without
// this seed, a newly-deployed cron runs on schedule but is invisible in
// /app/admin (no toggle, no "Run now" button).
//
// Schedules here must mirror vercel.json verbatim. When you add a cron to
// vercel.json, add a row here too.

interface CronConfigSeed {
  jobName: string;
  description: string;
  schedule: string;
}

const SEEDS: CronConfigSeed[] = [
  {
    jobName: "followers-snapshot",
    description: "Daily follower count snapshot across connected platforms.",
    schedule: "0 6 * * *",
  },
  {
    jobName: "trend-snapshot",
    description: "X trend + personalised-for-you snapshot, 4× daily.",
    schedule: "0 8,12,20 * * *; 15 16 * * *",
  },
  {
    jobName: "daily-insight",
    description: "AI-generated daily insight email digest.",
    schedule: "30 16 * * *",
  },
  {
    jobName: "x-import",
    description: "X post + metrics import. Weekly full + daily refresh.",
    schedule: "0 4 * * 1; 0 12 * * * (refresh)",
  },
  {
    jobName: "social-import",
    description:
      "Multi-platform post + metrics import (currently Threads; LinkedIn via CSV). Weekly full + daily refresh.",
    schedule: "15 4 * * 1; 15 12 * * *",
  },
  {
    jobName: "researcher",
    description: "Weekly research agent run for connected users.",
    schedule: "30 4 * * 1",
  },
  {
    jobName: "strategist",
    description: "Weekly multi-platform strategist analysis.",
    schedule: "0 14 * * 1",
  },
];

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const prefix = dryRun ? "[dry-run] " : "";
  console.log(
    `${prefix}Seeding ${SEEDS.length} cron-job configs against ${redactDbUrl(connectionString!)}...`
  );

  let toInsert = 0;
  let toUpdate = 0;

  for (const seed of SEEDS) {
    const existing = await prisma.cronJobConfig.findUnique({
      where: { jobName: seed.jobName },
    });
    if (existing) toUpdate++;
    else toInsert++;

    if (dryRun) continue;

    // Preserve `enabled` on update — admins may have turned a job off in
    // prod, we don't want to re-enable it on every seed run.
    await prisma.cronJobConfig.upsert({
      where: { jobName: seed.jobName },
      update: {
        description: seed.description,
        schedule: seed.schedule,
      },
      create: {
        jobName: seed.jobName,
        description: seed.description,
        schedule: seed.schedule,
        enabled: true,
      },
    });
  }

  const total = await prisma.cronJobConfig.count();
  if (dryRun) {
    console.log(
      `[dry-run] Would insert ${toInsert}, would update ${toUpdate}. Current row count: ${total}. No writes performed.`
    );
  } else {
    console.log(
      `Done. Inserted ${toInsert}, updated ${toUpdate}. CronJobConfig now has ${total} rows.`
    );
  }
}

function redactDbUrl(url: string): string {
  try {
    const u = new URL(url);
    if (u.password) u.password = "***";
    return `${u.protocol}//${u.username ? u.username + "@" : ""}${u.host}${u.pathname}`;
  } catch {
    return "<db>";
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
