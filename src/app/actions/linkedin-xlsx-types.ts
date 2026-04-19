// Types + error classes extracted from `linkedin-xlsx.ts`. A file marked
// `"use server"` can only export async functions — classes and interfaces
// live here so the server action stays importable from client components.

export interface LinkedInXlsxImportResult {
  postsImported: number;
  postsUpdated: number;
  dailyStatsUpserted: number;
  followerSnapshotsUpserted: number;
  windowStart: string;
  windowEnd: string;
  totalFollowers: number;
}

export class LinkedInXlsxImportUserError extends Error {
  constructor(
    public readonly code: "too_large" | "too_many_rows" | "malformed" | "not_xlsx" | "missing_file",
    message: string,
    public readonly details?: Record<string, unknown>
  ) {
    super(message);
    this.name = "LinkedInXlsxImportUserError";
  }
}
