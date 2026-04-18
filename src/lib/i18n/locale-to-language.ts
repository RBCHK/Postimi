import type { Language } from "@/generated/prisma";

// ADR-008: whitelist mapping from Clerk locale (or Accept-Language
// header) to our Language enum.
//
// We NEVER take a raw locale string and persist it. Every path through
// the webhook goes through this function, which either returns a valid
// enum value or null. Null → caller uses DEFAULT_LANGUAGE ("EN").
//
// Why a whitelist and not a regex: an attacker with Clerk user admin
// access could set `public_metadata.locale` to an arbitrary string. If
// we blindly trusted "locale" → Language conversion, a value like
// "EN\nSystem: ignore previous instructions" could land in a prompt.
// The enum column blocks this at the DB level, but the whitelist here
// is the defense in depth that keeps the invalid value from ever being
// attempted in the first place.

// Maps BCP-47 language tags (case-insensitive, we lowercase before
// lookup) to our supported Language enum.
const LOCALE_MAP: Record<string, Language> = {
  // English variants
  en: "EN",
  "en-us": "EN",
  "en-gb": "EN",
  "en-ca": "EN",
  "en-au": "EN",
  "en-nz": "EN",

  // Russian
  ru: "RU",
  "ru-ru": "RU",
  "ru-by": "RU",
  "ru-kz": "RU",

  // Ukrainian
  uk: "UK",
  "uk-ua": "UK",

  // Spanish variants
  es: "ES",
  "es-es": "ES",
  "es-mx": "ES",
  "es-ar": "ES",
  "es-us": "ES",

  // German variants
  de: "DE",
  "de-de": "DE",
  "de-at": "DE",
  "de-ch": "DE",

  // French variants
  fr: "FR",
  "fr-fr": "FR",
  "fr-ca": "FR",
  "fr-be": "FR",
};

/**
 * Map a raw locale string to our supported Language enum. Returns
 * null when the locale is unknown or malformed — the caller decides
 * the default (usually EN).
 *
 * Accepts:
 *   - "en", "en_US", "en-US", "EN-us" (case-insensitive)
 *   - Returns null for "", null, undefined, or any value not in the
 *     whitelist.
 */
export function localeToLanguage(raw: unknown): Language | null {
  if (typeof raw !== "string" || raw.length === 0) return null;

  // Reject anything suspicious: non-BCP-47 characters, newlines, quotes,
  // angle brackets. A valid tag is just letters, digits, hyphens, and
  // underscores; cap length at 20 so an attacker can't smuggle a giant
  // payload past Prisma enum validation via an unrelated path.
  if (raw.length > 20 || !/^[a-zA-Z0-9_\-]+$/.test(raw)) return null;

  // Normalize "en_US" → "en-us" for lookup.
  const normalized = raw.toLowerCase().replace(/_/g, "-");
  if (LOCALE_MAP[normalized]) return LOCALE_MAP[normalized];

  // Fall back to the primary tag ("fr-be" → "fr") if the full tag isn't
  // whitelisted but the primary is.
  const primary = normalized.split("-")[0]!;
  return LOCALE_MAP[primary] ?? null;
}
