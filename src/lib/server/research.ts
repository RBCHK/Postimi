import { prisma } from "@/lib/prisma";
import type { Platform } from "@/generated/prisma";
import type { ResearchNoteItem, ResearchSource } from "@/lib/types";

// ADR-008 / 2026-04 refactor: ResearchNote has two scopes.
//   GLOBAL — platform-wide industry research, shared across all users.
//            userId is null, platform is required.
//   USER   — per-user niche research. userId required, niche captures the
//            user's declared focus area at write time.
//
// Strategist/daily-insight read both via getRecentResearchNotes(userId,
// platform, limit). Implementation uses two separate queries (one per
// scope) so the isolation invariant is locally inspectable — cross-user
// or cross-platform leakage requires editing both queries, not slipping
// through a clever OR clause.

function mapRow(row: {
  id: string;
  topic: string;
  summary: string;
  sources: unknown;
  queries: string[];
  createdAt: Date;
}): ResearchNoteItem {
  return {
    id: row.id,
    topic: row.topic,
    summary: row.summary,
    sources: row.sources as unknown as ResearchSource[],
    queries: row.queries,
    createdAt: row.createdAt,
  };
}

// ─── USER scope (per-user niche research) ────────────────

export async function saveUserResearchNote(
  userId: string,
  niche: string | null,
  data: {
    topic: string;
    summary: string;
    sources: ResearchSource[];
    queries: string[];
  }
): Promise<ResearchNoteItem> {
  const row = await prisma.researchNote.create({
    data: {
      scope: "USER",
      userId,
      niche,
      topic: data.topic,
      summary: data.summary,
      sources: data.sources as object,
      queries: data.queries,
    },
  });
  return mapRow(row);
}

export async function getUserNicheResearchNotes(
  userId: string,
  limit: number
): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    where: { scope: "USER", userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapRow);
}

export async function getAllUserResearchNotes(userId: string): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    where: { scope: "USER", userId },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapRow);
}

export async function deleteUserResearchNote(userId: string, id: string): Promise<void> {
  // Find-then-delete with explicit scope+userId guard. We throw on
  // not-found rather than silent no-op — silence trains the model
  // (cron deleteOldUserNote tool) to spam delete attempts when its
  // ID hallucinations don't land.
  const note = await prisma.researchNote.findFirst({
    where: { id, scope: "USER", userId },
    select: { id: true },
  });
  if (!note) throw new Error("User research note not found");
  await prisma.researchNote.delete({ where: { id } });
}

// ─── GLOBAL scope (platform-wide research) ───────────────

export async function saveGlobalResearchNote(
  platform: Platform,
  data: {
    topic: string;
    summary: string;
    sources: ResearchSource[];
    queries: string[];
  }
): Promise<ResearchNoteItem> {
  const row = await prisma.researchNote.create({
    data: {
      scope: "GLOBAL",
      userId: null,
      platform,
      topic: data.topic,
      summary: data.summary,
      sources: data.sources as object,
      queries: data.queries,
    },
  });
  return mapRow(row);
}

export async function getGlobalResearchNotes(
  platform: Platform,
  limit: number
): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    where: { scope: "GLOBAL", platform },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  return rows.map(mapRow);
}

export async function listAllGlobalResearchNotes(platform: Platform): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    where: { scope: "GLOBAL", platform },
    orderBy: { createdAt: "desc" },
  });
  return rows.map(mapRow);
}

export async function deleteGlobalResearchNote(platform: Platform, id: string): Promise<void> {
  // Platform-scoped guard: the cron's deleteOldGlobalNote tool runs inside
  // a per-platform loop; even if the model hallucinates a noteId from a
  // different platform's research, this rejects the delete.
  const note = await prisma.researchNote.findFirst({
    where: { id, scope: "GLOBAL", platform },
    select: { id: true },
  });
  if (!note) throw new Error("Global research note not found for platform");
  await prisma.researchNote.delete({ where: { id } });
}

// ─── Mixed read (consumed by strategist + daily-insight) ─

/**
 * Returns up to `limit` GLOBAL notes for the platform plus up to `limit`
 * USER notes for the user, merged by createdAt desc. Implemented as two
 * independent queries — never one OR — so the scope invariant is locally
 * inspectable: a cross-user leak requires editing both queries, not
 * slipping through a clever boolean.
 */
export async function getRecentResearchNotes(
  userId: string,
  platform: Platform,
  limit: number
): Promise<ResearchNoteItem[]> {
  const [globalRows, userRows] = await Promise.all([
    prisma.researchNote.findMany({
      where: { scope: "GLOBAL", platform },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
    prisma.researchNote.findMany({
      where: { scope: "USER", userId },
      orderBy: { createdAt: "desc" },
      take: limit,
    }),
  ]);
  const all = [...globalRows, ...userRows].sort(
    (a, b) => b.createdAt.getTime() - a.createdAt.getTime()
  );
  return all.slice(0, limit * 2).map(mapRow);
}
