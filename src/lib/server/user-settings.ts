import { z } from "zod";
import { prisma } from "@/lib/prisma";
import type { Language } from "@/generated/prisma";

// ADR-008 Phase 5: user-scoped profile settings.
//
// `outputLanguage` is typed as the Prisma enum. Any payload that isn't
// one of the enum values is rejected at the DB layer — the guard below
// mirrors that check so we fail fast without a round-trip.

export const VALID_LANGUAGES: readonly Language[] = ["EN", "RU", "UK", "ES", "DE", "FR"];

export async function updateOutputLanguage(userId: string, lang: Language): Promise<void> {
  if (!VALID_LANGUAGES.includes(lang)) {
    throw new Error(`Invalid language: ${typeof lang === "string" ? lang.slice(0, 20) : "?"}`);
  }

  await prisma.user.update({
    where: { id: userId },
    data: { outputLanguage: lang },
  });
}

export async function getOutputLanguage(userId: string): Promise<Language | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { outputLanguage: true },
  });
  return user?.outputLanguage ?? null;
}

// ─── Niche (drives per-user niche research) ─────────────
//
// Niche reaches the AI prompt of a researcher with web-search and
// deleteOldUserNote tools — so it's a prompt-injection surface, not just
// a free-text field. Defenses, in order:
//   1. Length cap (DB: VARCHAR(100); Zod: max 100).
//   2. Strip control / non-printable characters and collapse whitespace.
//   3. Whitelist of allowed characters (letters, digits, separators) —
//      blocks newline-injected "SYSTEM: ignore prior" payloads.
//   4. Reject obvious prompt-injection markers (system/assistant/ignore
//      previous) and tool-name echoes (deleteOldUserNote/Global). This
//      is a cheap filter, not a complete defense; the structural
//      defenses on the cron tools (closure-bound userId/platform on
//      deletes) are what actually contain damage.

// Match common prompt-injection / tool-priming phrases. Two passes:
//   - word-boundary tokens: system, assistant, secret, password, token, api[_-]key
//   - tool-name echoes: any "delete...note" form (CamelCase, snake_case,
//     spaced, with arbitrary middle word like "global"/"user"/etc.)
const NICHE_FORBIDDEN_WORDS =
  /\b(system|assistant|ignore (prior|previous)|secret|password|token|api[_\s-]?key)\b/i;
const NICHE_FORBIDDEN_TOOL_ECHO = /delete[\s_]*old[\s_]*\w*[\s_]*note/i;

const NICHE_SCHEMA = z
  .string()
  .min(1, "Niche cannot be empty")
  .max(100, "Niche too long (max 100 chars)")
  .regex(
    /^[\p{L}\p{N}\s\-&,.()'"/]+$/u,
    "Niche may only contain letters, digits, spaces, and basic punctuation"
  )
  .refine(
    (s) => !NICHE_FORBIDDEN_WORDS.test(s) && !NICHE_FORBIDDEN_TOOL_ECHO.test(s),
    "Niche contains reserved tokens"
  );

export function sanitizeNiche(raw: string | null | undefined): string | null {
  if (raw === null || raw === undefined) return null;
  // Strip control chars (including \n, \r, \t, \0) and collapse runs of
  // whitespace. This must happen BEFORE schema validation so that
  // "AI tools\n\nSYSTEM: ..." can't pass by virtue of the regex matching
  // line by line.
  const cleaned = raw
    .replace(/[\x00-\x1F\x7F]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return null;
  return NICHE_SCHEMA.parse(cleaned);
}

export async function getUserNiche(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { niche: true },
  });
  return user?.niche ?? null;
}

export async function setUserNiche(userId: string, niche: string | null): Promise<void> {
  const sanitized = sanitizeNiche(niche);
  await prisma.user.update({
    where: { id: userId },
    data: { niche: sanitized },
  });
}
