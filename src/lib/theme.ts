export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "postimi_theme";

export function applyTheme(pref: ThemePreference) {
  const dark =
    pref === "dark" ||
    (pref === "system" && window.matchMedia("(prefers-color-scheme: dark)").matches);
  document.documentElement.classList.toggle("dark", dark);
}

export function saveTheme(pref: ThemePreference) {
  localStorage.setItem(STORAGE_KEY, pref);
}

export function getStoredTheme(): ThemePreference {
  if (typeof window === "undefined") return "system";
  return (localStorage.getItem(STORAGE_KEY) as ThemePreference) ?? "system";
}
