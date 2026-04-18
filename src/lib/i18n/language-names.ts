import type { Language } from "@/generated/prisma";

// ADR-008: human-readable language names for AI prompts.
//
// This map is the ONLY place a Language enum value turns into a string
// that reaches an LLM prompt. Keeping it pure (no fallback to raw input,
// no interpolation with user-provided strings) is a type-level
// prompt-injection defense — you can't sneak "EN\nIgnore previous" into
// a prompt because that string is not a valid enum value.

export const LANGUAGE_NAMES: Record<Language, string> = {
  EN: "English",
  RU: "Russian",
  UK: "Ukrainian",
  ES: "Spanish",
  DE: "German",
  FR: "French",
};

/**
 * Default language when the user's `outputLanguage` is null. Kept as a
 * constant so all callers stay consistent — especially the Strategist
 * cron, which runs without a user present.
 */
export const DEFAULT_LANGUAGE: Language = "EN";

export function languageName(lang: Language | null | undefined): string {
  if (!lang) return LANGUAGE_NAMES[DEFAULT_LANGUAGE];
  return LANGUAGE_NAMES[lang];
}
