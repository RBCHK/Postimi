"use server";

import { requireUserId } from "@/lib/auth";
import type { ResearchNoteItem } from "@/lib/types";
import { getAllUserResearchNotes as _getAllUserResearchNotes } from "@/lib/server/research";

// Public Server Actions for Research notes. The UI only needs a read
// of the current user's USER-scope niche notes (rendered on /strategist).
// All other research lifecycle (save/delete/get-mixed-with-global) is
// driven by the researcher cron and the strategist/daily-insight crons —
// they import directly from `@/lib/server/research`, never from here.
//
// Deliberately NOT exposed as Server Actions:
//   - saveResearchNote — only the cron should write notes
//   - deleteResearchNote — owner-checked but unused from UI
//   - getRecentResearchNotes (mixed scope) — internal cron concern
// Adding them here would make them callable RPC endpoints with no UI
// contract; per CLAUDE.md, every "use server" export is public.

export async function getAllUserResearchNotes(): Promise<ResearchNoteItem[]> {
  const userId = await requireUserId();
  return _getAllUserResearchNotes(userId);
}
