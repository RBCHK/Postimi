/**
 * One-time localStorage key migration from legacy `xreba_*` to `postimi_*`.
 *
 * Rules:
 * - Only copies if new key is absent (never overwrites user data on the new key).
 * - Always removes old key after successful copy, even if the new one already existed.
 * - Safe against throwing environments (Safari private mode can throw on any localStorage op).
 */

const MIGRATIONS: Record<string, string> = {
  xreba_theme: "postimi_theme",
  xreba_language: "postimi_language",
  xreba_model: "postimi_model",
  xreba_model_strategist: "postimi_model_strategist",
  xreba_model_researcher: "postimi_model_researcher",
  xreba_model_daily_insight: "postimi_model_daily_insight",
};

export function migrateLocalStorageKeys(): void {
  if (typeof window === "undefined") return;
  for (const [oldKey, newKey] of Object.entries(MIGRATIONS)) {
    try {
      const oldVal = localStorage.getItem(oldKey);
      if (oldVal === null) continue;
      if (localStorage.getItem(newKey) === null) {
        localStorage.setItem(newKey, oldVal);
      }
      localStorage.removeItem(oldKey);
    } catch {
      // localStorage disabled / quota exceeded / Safari private mode — ignore.
    }
  }
}
