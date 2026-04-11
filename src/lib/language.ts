import type { LanguageSettings } from "@/lib/types";

export const LANGUAGE_STORAGE_KEY = "postimi_language";

export const DEFAULT_LANGUAGE_SETTINGS: LanguageSettings = {
  interfaceLanguage: "en",
  conversationLanguage: "ru",
  contentLanguage: "en",
};

export function getStoredLanguageSettings(): LanguageSettings {
  if (typeof window === "undefined") return DEFAULT_LANGUAGE_SETTINGS;
  try {
    const raw = localStorage.getItem(LANGUAGE_STORAGE_KEY);
    if (!raw) return DEFAULT_LANGUAGE_SETTINGS;
    return { ...DEFAULT_LANGUAGE_SETTINGS, ...JSON.parse(raw) };
  } catch {
    return DEFAULT_LANGUAGE_SETTINGS;
  }
}
