/**
 * Real-prisma integration tests for src/lib/server/posts.ts.
 *
 * Why real DB: the file's invariants (transactional create, FK-cascade
 * on user delete, owner-checked retry semantics) are properties of the
 * Postgres schema — mocking Prisma would let regressions through.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { ScheduledPublishStatus } from "@/generated/prisma";
import { createPostWithSchedules, retryScheduledPublish } from "../posts";
import { cleanupByPrefix, createTestUser, randomSuffix } from "@/test/real-prisma";

const PREFIX = `posts_${randomSuffix()}_`;

async function cleanupPosts(userIds: string[]): Promise<void> {
  if (userIds.length === 0) return;
  // Swallow per-table failures: if one of the tables doesn't exist in
  // the local DB (migration not yet applied), we still want the
  // afterEach `cleanupByPrefix(... clerkId: true)` to run and remove
  // the test users themselves. Otherwise pre-migration test runs
  // leave 24+ orphan users in the DB until someone notices manually.
  await prisma.scheduledPublish.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
  await prisma.post.deleteMany({ where: { userId: { in: userIds } } }).catch(() => {});
}

describe("createPostWithSchedules", () => {
  let userId: string;

  beforeEach(async () => {
    const u = await createTestUser({ clerkId: `${PREFIX}u_${randomSuffix()}` });
    userId = u.id;
  });

  afterEach(async () => {
    // Order matters: child rows first, then User rows. cleanupByPrefix
    // uses User.deleteMany with onDelete: Cascade — it would handle
    // descendants, but we also wrap each step in .catch() inside
    // cleanupPosts so a missing-table error pre-migration doesn't strand
    // the User row in afterEach.
    await cleanupPosts([userId]);
    await cleanupByPrefix(PREFIX, { clerkId: true });
  });

  it("creates a Post + N ScheduledPublishes in one transaction", async () => {
    const at = new Date(Date.now() + 60_000);
    const { postId } = await createPostWithSchedules(userId, {
      content: "hello world",
      schedules: [
        { platform: "X", scheduledAt: at },
        { platform: "LINKEDIN", scheduledAt: at },
        { platform: "THREADS", scheduledAt: at },
      ],
    });

    const post = await prisma.post.findUnique({ where: { id: postId } });
    expect(post?.content).toBe("hello world");
    expect(post?.userId).toBe(userId);

    const sps = await prisma.scheduledPublish.findMany({ where: { postId } });
    expect(sps).toHaveLength(3);
    const platforms = new Set(sps.map((s) => s.platform));
    expect(platforms).toEqual(new Set(["X", "LINKEDIN", "THREADS"]));
    for (const sp of sps) {
      expect(sp.status).toBe(ScheduledPublishStatus.PENDING);
      expect(sp.userId).toBe(userId);
      expect(sp.attemptCount).toBe(0);
    }
  });

  it("rejects empty content (no Post / SPs created)", async () => {
    await expect(
      createPostWithSchedules(userId, {
        content: "",
        schedules: [{ platform: "X", scheduledAt: new Date() }],
      })
    ).rejects.toThrow(/empty/i);
    expect(await prisma.post.count({ where: { userId } })).toBe(0);
  });

  it("rejects content over the 10_000-char hard cap (DoS defense)", async () => {
    await expect(
      createPostWithSchedules(userId, {
        content: "x".repeat(10_001),
        schedules: [{ platform: "X", scheduledAt: new Date() }],
      })
    ).rejects.toThrow(/hard cap/i);
  });

  it("rejects content exceeding a per-platform textLimit before any DB write", async () => {
    // X limit is 280; LinkedIn is 3000. A 500-char post passes LinkedIn
    // but fails X — the validation runs over every requested schedule
    // so a single failing platform aborts the whole transaction.
    const content = "x".repeat(500);
    await expect(
      createPostWithSchedules(userId, {
        content,
        schedules: [
          { platform: "LINKEDIN", scheduledAt: new Date() },
          { platform: "X", scheduledAt: new Date() },
        ],
      })
    ).rejects.toThrow(/X limit/);
    // Atomicity: no Post survives a failed validation.
    expect(await prisma.post.count({ where: { userId } })).toBe(0);
  });

  it("rejects scheduledAt more than 1 year out", async () => {
    const farFuture = new Date(Date.now() + 366 * 24 * 3600 * 1000);
    await expect(
      createPostWithSchedules(userId, {
        content: "ok",
        schedules: [{ platform: "X", scheduledAt: farFuture }],
      })
    ).rejects.toThrow(/1 year out/);
  });

  it("requires at least one schedule", async () => {
    await expect(createPostWithSchedules(userId, { content: "ok", schedules: [] })).rejects.toThrow(
      /schedule/i
    );
  });
});

describe("retryScheduledPublish", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createTestUser({ clerkId: `${PREFIX}A_${randomSuffix()}` });
    userB = await createTestUser({ clerkId: `${PREFIX}B_${randomSuffix()}` });
  });

  afterEach(async () => {
    // See cleanupPosts for the rationale: per-table catch ensures
    // cleanupByPrefix runs even when a downstream table is missing
    // (e.g. against a not-yet-migrated local DB).
    await cleanupPosts([userA.id, userB.id]);
    await cleanupByPrefix(PREFIX, { clerkId: true });
  });

  async function makeFailedPublish(uid: string): Promise<string> {
    const { postId } = await createPostWithSchedules(uid, {
      content: "to retry",
      schedules: [{ platform: "X", scheduledAt: new Date(Date.now() + 60_000) }],
    });
    const sp = await prisma.scheduledPublish.findFirstOrThrow({ where: { postId } });
    await prisma.scheduledPublish.update({
      where: { id: sp.id },
      data: {
        status: ScheduledPublishStatus.FAILED,
        attemptCount: 3,
        lastError: "previous failure",
      },
    });
    return sp.id;
  }

  it("resets a FAILED row back to PENDING with attemptCount=0 and increments manualRetryCount", async () => {
    const spId = await makeFailedPublish(userA.id);
    const result = await retryScheduledPublish(userA.id, spId);
    expect(result.ok).toBe(true);
    const sp = await prisma.scheduledPublish.findUniqueOrThrow({ where: { id: spId } });
    expect(sp.status).toBe(ScheduledPublishStatus.PENDING);
    expect(sp.attemptCount).toBe(0);
    expect(sp.manualRetryCount).toBe(1);
    expect(sp.lastError).toBeNull();
  });

  it("rejects a cross-user retry (returns ok:false, leaves row untouched)", async () => {
    const spId = await makeFailedPublish(userA.id);
    const result = await retryScheduledPublish(userB.id, spId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_found_or_not_failed");
    const sp = await prisma.scheduledPublish.findUniqueOrThrow({ where: { id: spId } });
    expect(sp.status).toBe(ScheduledPublishStatus.FAILED);
    expect(sp.attemptCount).toBe(3);
    expect(sp.manualRetryCount).toBe(0);
  });

  it("rejects retry on a row that isn't FAILED (PENDING / PUBLISHED / PUBLISHING)", async () => {
    const spId = await makeFailedPublish(userA.id);
    // Flip the row to PENDING so retry is no longer applicable.
    await prisma.scheduledPublish.update({
      where: { id: spId },
      data: { status: ScheduledPublishStatus.PENDING },
    });
    const result = await retryScheduledPublish(userA.id, spId);
    expect(result.ok).toBe(false);
    expect(result.reason).toBe("not_found_or_not_failed");
  });
});
