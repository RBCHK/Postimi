/**
 * Real-prisma integration tests for the post-2026-04 research lib.
 *
 * The two-scope model (GLOBAL per-platform vs USER per-user) needs DB-
 * level coverage because:
 *   1. The CHECK constraint on ResearchNote enforces invariants the
 *      lib functions rely on — must verify it actually trips.
 *   2. `getRecentResearchNotes(userId, platform, limit)` is implemented
 *      as two parallel queries; cross-user / cross-platform leakage is
 *      a class-of-bug we want to catch with seeded data, not unit mocks.
 *   3. Delete guards (scope + platform/userId) are owner-checks at the
 *      lib boundary; mocking Prisma would let bugs through.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import {
  saveGlobalResearchNote,
  saveUserResearchNote,
  getGlobalResearchNotes,
  getUserNicheResearchNotes,
  getRecentResearchNotes,
  listAllGlobalResearchNotes,
  getAllUserResearchNotes,
  deleteGlobalResearchNote,
  deleteUserResearchNote,
} from "../research";
import { cleanupByPrefix, createTestUser, randomSuffix } from "@/test/real-prisma";

const PREFIX = `research_${randomSuffix()}_`;

async function cleanupResearchNotes(userIds: string[]): Promise<void> {
  if (userIds.length > 0) {
    await prisma.researchNote.deleteMany({ where: { userId: { in: userIds } } });
  }
  // Wipe the platform-scoped notes we may have written under our prefix
  // (no userId — find by createdAt within last 5 minutes is good enough
  // for test isolation alongside cleanupByPrefix at the user level).
  const fiveMinAgo = new Date(Date.now() - 5 * 60 * 1000);
  await prisma.researchNote.deleteMany({
    where: { scope: "GLOBAL", createdAt: { gt: fiveMinAgo }, topic: { startsWith: PREFIX } },
  });
}

const sampleData = (topicSuffix: string) => ({
  topic: `${PREFIX}topic-${topicSuffix}`,
  summary: "summary content",
  sources: [{ title: "t", url: "https://example.com", snippet: "s" }],
  queries: ["q1"],
});

describe("research lib — GLOBAL scope", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}gx_${randomSuffix()}` });
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupResearchNotes([userId]);
    await cleanupByPrefix(PREFIX, { clerkId: true });
  });

  it("saveGlobalResearchNote writes scope=GLOBAL with userId=null and platform set", async () => {
    const saved = await saveGlobalResearchNote("X", sampleData("g1"));
    const row = await prisma.researchNote.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.scope).toBe("GLOBAL");
    expect(row.userId).toBeNull();
    expect(row.platform).toBe("X");
    expect(row.niche).toBeNull();
  });

  it("getGlobalResearchNotes filters by platform — LinkedIn note absent from X query", async () => {
    await saveGlobalResearchNote("X", sampleData("x1"));
    await saveGlobalResearchNote("LINKEDIN", sampleData("li1"));
    const xNotes = await getGlobalResearchNotes("X", 10);
    const liNotes = await getGlobalResearchNotes("LINKEDIN", 10);
    expect(xNotes.every((n) => n.topic.includes(PREFIX))).toBe(true);
    expect(xNotes.find((n) => n.topic.includes("li1"))).toBeUndefined();
    expect(liNotes.find((n) => n.topic.includes("x1"))).toBeUndefined();
  });

  it("deleteGlobalResearchNote rejects if note's platform doesn't match argument", async () => {
    const xNote = await saveGlobalResearchNote("X", sampleData("g2"));
    await expect(deleteGlobalResearchNote("LINKEDIN", xNote.id)).rejects.toThrow(/not found/i);
    // Original note still present
    const stillThere = await prisma.researchNote.findUnique({ where: { id: xNote.id } });
    expect(stillThere).not.toBeNull();
  });

  it("deleteGlobalResearchNote succeeds when platform matches", async () => {
    const note = await saveGlobalResearchNote("THREADS", sampleData("g3"));
    await deleteGlobalResearchNote("THREADS", note.id);
    const gone = await prisma.researchNote.findUnique({ where: { id: note.id } });
    expect(gone).toBeNull();
  });
});

describe("research lib — USER scope", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createTestUser({ clerkId: `${PREFIX}A_${randomSuffix()}` });
    userB = await createTestUser({ clerkId: `${PREFIX}B_${randomSuffix()}` });
  });

  afterEach(async () => {
    await cleanupResearchNotes([userA.id, userB.id]);
    await cleanupByPrefix(PREFIX, { clerkId: true });
  });

  it("saveUserResearchNote writes scope=USER with userId + niche", async () => {
    const saved = await saveUserResearchNote(userA.id, "AI tools", sampleData("u1"));
    const row = await prisma.researchNote.findUniqueOrThrow({ where: { id: saved.id } });
    expect(row.scope).toBe("USER");
    expect(row.userId).toBe(userA.id);
    expect(row.niche).toBe("AI tools");
    expect(row.platform).toBeNull();
  });

  it("getUserNicheResearchNotes scopes to userId — userB's notes absent from userA's query", async () => {
    await saveUserResearchNote(userA.id, "AI tools", sampleData("ua"));
    await saveUserResearchNote(userB.id, "fitness", sampleData("ub"));
    const aNotes = await getUserNicheResearchNotes(userA.id, 10);
    expect(aNotes.length).toBe(1);
    expect(aNotes[0]?.topic).toContain("ua");
  });

  it("deleteUserResearchNote rejects on cross-user delete attempt", async () => {
    const noteB = await saveUserResearchNote(userB.id, "fitness", sampleData("u2"));
    await expect(deleteUserResearchNote(userA.id, noteB.id)).rejects.toThrow(/not found/i);
    // userB's note still present
    const stillThere = await prisma.researchNote.findUnique({ where: { id: noteB.id } });
    expect(stillThere).not.toBeNull();
  });

  it("deleteUserResearchNote rejects when scope is GLOBAL (not USER)", async () => {
    const globalNote = await saveGlobalResearchNote("X", sampleData("u3"));
    await expect(deleteUserResearchNote(userA.id, globalNote.id)).rejects.toThrow(/not found/i);
    const stillThere = await prisma.researchNote.findUnique({ where: { id: globalNote.id } });
    expect(stillThere).not.toBeNull();
    // Cleanup the GLOBAL note the test created (no user owns it)
    await prisma.researchNote.delete({ where: { id: globalNote.id } });
  });

  it("getAllUserResearchNotes returns USER scope only — global notes never leak", async () => {
    await saveUserResearchNote(userA.id, "niche", sampleData("ua"));
    const globalNote = await saveGlobalResearchNote("X", sampleData("g"));
    const notes = await getAllUserResearchNotes(userA.id);
    expect(notes.find((n) => n.id === globalNote.id)).toBeUndefined();
    expect(notes.length).toBe(1);
    await prisma.researchNote.delete({ where: { id: globalNote.id } });
  });
});

describe("research lib — CHECK constraint enforcement", () => {
  let userId: string;

  beforeEach(async () => {
    const user = await createTestUser({ clerkId: `${PREFIX}cc_${randomSuffix()}` });
    userId = user.id;
  });

  afterEach(async () => {
    await cleanupResearchNotes([userId]);
    await cleanupByPrefix(PREFIX, { clerkId: true });
  });

  it("DB rejects scope=GLOBAL with non-null userId (raw insert bypassing lib)", async () => {
    // Use raw SQL to bypass lib helpers — we want to verify the Postgres
    // CHECK constraint trips, not just our application logic.
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ResearchNote" (id, scope, "userId", platform, topic, summary, sources, queries) VALUES ($1, 'GLOBAL', $2, 'X', 'topic', 'summary', '[]'::jsonb, ARRAY[]::text[])`,
        `cc-${randomSuffix()}`,
        userId
      )
    ).rejects.toThrow(/check/i);
  });

  it("DB rejects scope=USER with null userId", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ResearchNote" (id, scope, "userId", topic, summary, sources, queries) VALUES ($1, 'USER', NULL, 'topic', 'summary', '[]'::jsonb, ARRAY[]::text[])`,
        `cc-${randomSuffix()}`
      )
    ).rejects.toThrow(/check/i);
  });

  it("DB rejects scope=GLOBAL with null platform", async () => {
    await expect(
      prisma.$executeRawUnsafe(
        `INSERT INTO "ResearchNote" (id, scope, "userId", platform, topic, summary, sources, queries) VALUES ($1, 'GLOBAL', NULL, NULL, 'topic', 'summary', '[]'::jsonb, ARRAY[]::text[])`,
        `cc-${randomSuffix()}`
      )
    ).rejects.toThrow(/check/i);
  });
});

describe("research lib — getRecentResearchNotes (mixed scope)", () => {
  let userA: { id: string };
  let userB: { id: string };

  beforeEach(async () => {
    userA = await createTestUser({ clerkId: `${PREFIX}mxA_${randomSuffix()}` });
    userB = await createTestUser({ clerkId: `${PREFIX}mxB_${randomSuffix()}` });
  });

  afterEach(async () => {
    await cleanupResearchNotes([userA.id, userB.id]);
    await cleanupByPrefix(PREFIX, { clerkId: true });
  });

  it("returns latest GLOBAL platform notes + USER notes for the requester only — no cross-user leak", async () => {
    // Seed: 2 GLOBAL X, 1 GLOBAL LINKEDIN, 1 userA niche, 1 userB niche
    const gx1 = await saveGlobalResearchNote("X", sampleData("gx1"));
    const gx2 = await saveGlobalResearchNote("X", sampleData("gx2"));
    const gli = await saveGlobalResearchNote("LINKEDIN", sampleData("gli"));
    const ua = await saveUserResearchNote(userA.id, "ai", sampleData("ua"));
    const ub = await saveUserResearchNote(userB.id, "fit", sampleData("ub"));

    const result = await getRecentResearchNotes(userA.id, "X", 5);
    const ids = new Set(result.map((n) => n.id));

    // Must include: userA's note + GLOBAL X notes
    expect(ids.has(ua.id)).toBe(true);
    expect(ids.has(gx1.id)).toBe(true);
    expect(ids.has(gx2.id)).toBe(true);

    // Must NOT include: userB's note (other user) OR LinkedIn global
    expect(ids.has(ub.id)).toBe(false);
    expect(ids.has(gli.id)).toBe(false);

    // Cleanup the platform-bound globals manually since they have no userId
    await prisma.researchNote.deleteMany({ where: { id: { in: [gx1.id, gx2.id, gli.id] } } });
  });

  it("orders results by createdAt descending across both scopes", async () => {
    // Save in known order so createdAt is ascending: g, then user
    const g = await saveGlobalResearchNote("X", sampleData("ord-g"));
    await new Promise((r) => setTimeout(r, 5));
    const u = await saveUserResearchNote(userA.id, "ai", sampleData("ord-u"));

    const result = await getRecentResearchNotes(userA.id, "X", 5);
    const filtered = result.filter((n) => n.id === g.id || n.id === u.id);
    // Most recent first → user note should precede global
    expect(filtered[0]?.id).toBe(u.id);
    expect(filtered[1]?.id).toBe(g.id);

    await prisma.researchNote.delete({ where: { id: g.id } });
  });
});

describe("research lib — listAllGlobalResearchNotes (cron self-management)", () => {
  it("returns all GLOBAL notes for one platform, ordered by recency", async () => {
    const a = await saveGlobalResearchNote("THREADS", sampleData("la"));
    await new Promise((r) => setTimeout(r, 5));
    const b = await saveGlobalResearchNote("THREADS", sampleData("lb"));
    const all = await listAllGlobalResearchNotes("THREADS");
    const ids = all.map((n) => n.id);
    expect(ids.indexOf(b.id)).toBeLessThan(ids.indexOf(a.id));
    await prisma.researchNote.deleteMany({ where: { id: { in: [a.id, b.id] } } });
  });
});
