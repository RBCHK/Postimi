"use server";

import { requireUserId } from "@/lib/auth";
import type { ResearchNoteItem, ResearchSource } from "@/lib/types";
import {
  saveResearchNote as _saveResearchNote,
  getRecentResearchNotes as _getRecentResearchNotes,
  getAllResearchNotes as _getAllResearchNotes,
  deleteResearchNote as _deleteResearchNote,
} from "@/lib/server/research";

export async function saveResearchNote(data: {
  topic: string;
  summary: string;
  sources: ResearchSource[];
  queries: string[];
}): Promise<ResearchNoteItem> {
  const userId = await requireUserId();
  return _saveResearchNote(userId, data);
}

export async function getRecentResearchNotes(limit = 3): Promise<ResearchNoteItem[]> {
  const userId = await requireUserId();
  return _getRecentResearchNotes(userId, limit);
}

export async function getAllResearchNotes(): Promise<ResearchNoteItem[]> {
  const userId = await requireUserId();
  return _getAllResearchNotes(userId);
}

export async function deleteResearchNote(id: string): Promise<void> {
  const userId = await requireUserId();
  return _deleteResearchNote(userId, id);
}
