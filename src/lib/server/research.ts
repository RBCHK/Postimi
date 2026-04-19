import { prisma } from "@/lib/prisma";
import type { ResearchNoteItem, ResearchSource } from "@/lib/types";

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

export async function saveResearchNote(
  userId: string,
  data: {
    topic: string;
    summary: string;
    sources: ResearchSource[];
    queries: string[];
  }
): Promise<ResearchNoteItem> {
  const row = await prisma.researchNote.create({
    data: {
      userId,
      topic: data.topic,
      summary: data.summary,
      sources: data.sources as object,
      queries: data.queries,
    },
  });

  return mapRow(row);
}

export async function getRecentResearchNotes(
  userId: string,
  limit: number
): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map(mapRow);
}

export async function getAllResearchNotes(userId: string): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
  });

  return rows.map(mapRow);
}

export async function deleteResearchNote(userId: string, id: string): Promise<void> {
  const note = await prisma.researchNote.findFirst({ where: { id, userId } });
  if (!note) throw new Error("Research note not found");
  await prisma.researchNote.delete({ where: { id } });
}
