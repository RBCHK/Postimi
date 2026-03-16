"use server";

import { prisma } from "@/lib/prisma";
import type { ResearchNoteItem, ResearchSource } from "@/lib/types";

export async function saveResearchNote(data: {
  topic: string;
  summary: string;
  sources: ResearchSource[];
  queries: string[];
}): Promise<ResearchNoteItem> {
  const row = await prisma.researchNote.create({
    data: {
      topic: data.topic,
      summary: data.summary,
      sources: data.sources as object,
      queries: data.queries,
    },
  });

  return {
    id: row.id,
    topic: row.topic,
    summary: row.summary,
    sources: row.sources as unknown as ResearchSource[],
    queries: row.queries,
    createdAt: row.createdAt,
  };
}

export async function getRecentResearchNotes(limit = 3): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    summary: r.summary,
    sources: r.sources as unknown as ResearchSource[],
    queries: r.queries,
    createdAt: r.createdAt,
  }));
}

export async function getAllResearchNotes(): Promise<ResearchNoteItem[]> {
  const rows = await prisma.researchNote.findMany({
    orderBy: { createdAt: "desc" },
  });

  return rows.map((r) => ({
    id: r.id,
    topic: r.topic,
    summary: r.summary,
    sources: r.sources as unknown as ResearchSource[],
    queries: r.queries,
    createdAt: r.createdAt,
  }));
}

export async function deleteResearchNote(id: string): Promise<void> {
  await prisma.researchNote.delete({ where: { id } });
}
