import "dotenv/config";
import { config } from "dotenv";
config({ path: ".env.local", override: true });

import { PrismaClient } from "../../src/generated/prisma";
import { PrismaPg } from "@prisma/adapter-pg";

// Phase 1b gate: verify the dual-write established in Phase 1a produced
// identical data in the new SocialPost/SocialDailyStats/SocialFollowersSnapshot
// tables vs the legacy XPost/DailyAccountStats/FollowersSnapshot tables.
//
// Only cuts over when every delta is 0. Emits a non-zero exit code on
// mismatch so CI (or a follow-up cron) can gate the DROP migration on it.

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set");

const adapter = new PrismaPg({ connectionString });
const prisma = new PrismaClient({ adapter });

type Mismatch = { kind: string; detail: string };

const POST_METRIC_FIELDS = [
  "impressions",
  "likes",
  "engagements",
  "bookmarks",
  "replies",
  "reposts",
  "quoteCount",
  "urlClicks",
  "profileVisits",
  "newFollowers",
  "detailExpands",
] as const;

const DAILY_METRIC_FIELDS = [
  "impressions",
  "likes",
  "engagements",
  "bookmarks",
  "shares",
  "newFollows",
  "unfollows",
  "replies",
  "reposts",
  "profileVisits",
  "createPost",
  "videoViews",
  "mediaViews",
] as const;

async function checkPostCounts(mismatches: Mismatch[]) {
  const [xCount, socialCount] = await Promise.all([
    prisma.xPost.count(),
    prisma.socialPost.count({ where: { platform: "X" } }),
  ]);
  console.log(`  XPost                    ${xCount}`);
  console.log(`  SocialPost (platform=X)  ${socialCount}`);
  if (xCount !== socialCount) {
    mismatches.push({
      kind: "posts:count",
      detail: `XPost=${xCount} SocialPost(X)=${socialCount} delta=${socialCount - xCount}`,
    });
  }
  return { xCount, socialCount };
}

async function checkDailyCounts(mismatches: Mismatch[]) {
  const [xCount, socialCount] = await Promise.all([
    prisma.dailyAccountStats.count(),
    prisma.socialDailyStats.count({ where: { platform: "X" } }),
  ]);
  console.log(`  DailyAccountStats               ${xCount}`);
  console.log(`  SocialDailyStats (platform=X)   ${socialCount}`);
  if (xCount !== socialCount) {
    mismatches.push({
      kind: "daily:count",
      detail: `DailyAccountStats=${xCount} SocialDailyStats(X)=${socialCount} delta=${socialCount - xCount}`,
    });
  }
}

async function checkFollowersCounts(mismatches: Mismatch[]) {
  const [xCount, socialCount] = await Promise.all([
    prisma.followersSnapshot.count(),
    prisma.socialFollowersSnapshot.count({ where: { platform: "X" } }),
  ]);
  console.log(`  FollowersSnapshot                ${xCount}`);
  console.log(`  SocialFollowersSnapshot (X)      ${socialCount}`);
  if (xCount !== socialCount) {
    mismatches.push({
      kind: "followers:count",
      detail: `FollowersSnapshot=${xCount} SocialFollowersSnapshot(X)=${socialCount} delta=${socialCount - xCount}`,
    });
  }
}

async function checkPostSample(sampleSize: number, mismatches: Mismatch[]) {
  // Pull a random sample of XPost rows and verify the mirrored SocialPost
  // (platform=X, externalPostId=postId) row matches field-by-field.
  const sample = await prisma.$queryRawUnsafe<
    Array<{ id: string; userId: string; postId: string }>
  >(`SELECT id, "userId", "postId" FROM "XPost" ORDER BY random() LIMIT ${sampleSize}`);

  let checked = 0;
  for (const row of sample) {
    const [x, s] = await Promise.all([
      prisma.xPost.findUnique({ where: { id: row.id } }),
      prisma.socialPost.findUnique({
        where: {
          userId_platform_externalPostId: {
            userId: row.userId,
            platform: "X",
            externalPostId: row.postId,
          },
        },
      }),
    ]);

    if (!x) continue; // deleted between count and sample — skip
    if (!s) {
      mismatches.push({
        kind: "posts:missing",
        detail: `userId=${row.userId} postId=${row.postId} has XPost but no SocialPost mirror`,
      });
      continue;
    }

    checked++;

    // Text + timestamps
    if (x.text !== s.text) {
      mismatches.push({
        kind: "posts:text",
        detail: `userId=${row.userId} postId=${row.postId} — text differs`,
      });
    }
    if (x.date.getTime() !== s.postedAt.getTime()) {
      mismatches.push({
        kind: "posts:date",
        detail: `userId=${row.userId} postId=${row.postId} — XPost.date=${x.date.toISOString()} SocialPost.postedAt=${s.postedAt.toISOString()}`,
      });
    }
    if ((x.postLink ?? null) !== (s.postUrl ?? null)) {
      mismatches.push({
        kind: "posts:url",
        detail: `userId=${row.userId} postId=${row.postId} — XPost.postLink=${x.postLink} SocialPost.postUrl=${s.postUrl}`,
      });
    }
    if (x.postType !== s.postType) {
      mismatches.push({
        kind: "posts:type",
        detail: `userId=${row.userId} postId=${row.postId} — XPost.postType=${x.postType} SocialPost.postType=${s.postType}`,
      });
    }
    if (x.dataSource !== s.dataSource) {
      mismatches.push({
        kind: "posts:dataSource",
        detail: `userId=${row.userId} postId=${row.postId} — XPost.dataSource=${x.dataSource} SocialPost.dataSource=${s.dataSource}`,
      });
    }

    // Metrics
    for (const field of POST_METRIC_FIELDS) {
      const xv = (x as Record<string, unknown>)[field] as number;
      const sv = (s as Record<string, unknown>)[field] as number;
      if (xv !== sv) {
        mismatches.push({
          kind: `posts:metric:${field}`,
          detail: `userId=${row.userId} postId=${row.postId} — XPost.${field}=${xv} SocialPost.${field}=${sv}`,
        });
      }
    }
  }
  console.log(`  Sampled ${checked}/${sample.length} posts field-by-field`);
}

async function checkDailySample(sampleSize: number, mismatches: Mismatch[]) {
  const sample = await prisma.$queryRawUnsafe<Array<{ id: string; userId: string; date: Date }>>(
    `SELECT id, "userId", "date" FROM "DailyAccountStats" ORDER BY random() LIMIT ${sampleSize}`
  );

  let checked = 0;
  for (const row of sample) {
    const [d, s] = await Promise.all([
      prisma.dailyAccountStats.findUnique({ where: { id: row.id } }),
      prisma.socialDailyStats.findUnique({
        where: {
          userId_platform_date: {
            userId: row.userId,
            platform: "X",
            date: row.date,
          },
        },
      }),
    ]);

    if (!d) continue;
    if (!s) {
      mismatches.push({
        kind: "daily:missing",
        detail: `userId=${row.userId} date=${row.date.toISOString()} has DailyAccountStats but no SocialDailyStats mirror`,
      });
      continue;
    }

    checked++;

    for (const field of DAILY_METRIC_FIELDS) {
      const dv = (d as Record<string, unknown>)[field] as number;
      const sv = (s as Record<string, unknown>)[field] as number;
      if (dv !== sv) {
        mismatches.push({
          kind: `daily:metric:${field}`,
          detail: `userId=${row.userId} date=${row.date.toISOString()} — DailyAccountStats.${field}=${dv} SocialDailyStats.${field}=${sv}`,
        });
      }
    }
  }
  console.log(`  Sampled ${checked}/${sample.length} daily stats field-by-field`);
}

async function checkFollowersSample(sampleSize: number, mismatches: Mismatch[]) {
  const sample = await prisma.$queryRawUnsafe<Array<{ id: string; userId: string; date: Date }>>(
    `SELECT id, "userId", "date" FROM "FollowersSnapshot" ORDER BY random() LIMIT ${sampleSize}`
  );

  let checked = 0;
  for (const row of sample) {
    const [f, s] = await Promise.all([
      prisma.followersSnapshot.findUnique({ where: { id: row.id } }),
      prisma.socialFollowersSnapshot.findUnique({
        where: {
          userId_platform_date: {
            userId: row.userId,
            platform: "X",
            date: row.date,
          },
        },
      }),
    ]);

    if (!f) continue;
    if (!s) {
      mismatches.push({
        kind: "followers:missing",
        detail: `userId=${row.userId} date=${row.date.toISOString()} has FollowersSnapshot but no SocialFollowersSnapshot mirror`,
      });
      continue;
    }

    checked++;

    if (f.followersCount !== s.followersCount) {
      mismatches.push({
        kind: "followers:followersCount",
        detail: `userId=${row.userId} date=${row.date.toISOString()} — ${f.followersCount} vs ${s.followersCount}`,
      });
    }
    if (f.followingCount !== (s.followingCount ?? 0)) {
      mismatches.push({
        kind: "followers:followingCount",
        detail: `userId=${row.userId} date=${row.date.toISOString()} — ${f.followingCount} vs ${s.followingCount}`,
      });
    }
    if (f.deltaFollowers !== s.deltaFollowers) {
      mismatches.push({
        kind: "followers:deltaFollowers",
        detail: `userId=${row.userId} date=${row.date.toISOString()} — ${f.deltaFollowers} vs ${s.deltaFollowers}`,
      });
    }
    if (f.deltaFollowing !== s.deltaFollowing) {
      mismatches.push({
        kind: "followers:deltaFollowing",
        detail: `userId=${row.userId} date=${row.date.toISOString()} — ${f.deltaFollowing} vs ${s.deltaFollowing}`,
      });
    }
  }
  console.log(`  Sampled ${checked}/${sample.length} follower snapshots field-by-field`);
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

async function main() {
  const sampleArg = process.argv.find((a) => a.startsWith("--sample="));
  const sampleSize = sampleArg ? Math.max(1, parseInt(sampleArg.split("=")[1], 10)) : 50;

  console.log(`Phase 1b parity check against ${redactDbUrl(connectionString!)}`);
  console.log(`Sample size per table: ${sampleSize}\n`);

  const mismatches: Mismatch[] = [];

  console.log("Row counts:");
  console.log("  Posts");
  await checkPostCounts(mismatches);
  console.log("  Daily account stats");
  await checkDailyCounts(mismatches);
  console.log("  Followers snapshots");
  await checkFollowersCounts(mismatches);

  console.log("\nRandom sample field-by-field:");
  await checkPostSample(sampleSize, mismatches);
  await checkDailySample(sampleSize, mismatches);
  await checkFollowersSample(sampleSize, mismatches);

  if (mismatches.length === 0) {
    console.log("\n✓ Parity OK. Safe to cut over XPost → SocialPost.");
    return;
  }

  console.log(`\n✗ ${mismatches.length} mismatch(es):`);
  const byKind = new Map<string, number>();
  for (const m of mismatches) {
    byKind.set(m.kind, (byKind.get(m.kind) ?? 0) + 1);
  }
  console.log("\nBy kind:");
  for (const [kind, count] of [...byKind.entries()].sort()) {
    console.log(`  ${kind}: ${count}`);
  }
  console.log("\nFirst 20:");
  for (const m of mismatches.slice(0, 20)) {
    console.log(`  [${m.kind}] ${m.detail}`);
  }
  process.exitCode = 1;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
