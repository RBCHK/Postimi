"use client";

import { useEffect } from "react";
import { applyTheme, getStoredTheme } from "@/lib/theme";
import { migrateLocalStorageKeys } from "@/lib/storage-migration";

export function ThemeInitializer() {
  useEffect(() => {
    // Migrate legacy xreba_* keys to postimi_* before reading any storage.
    // Theme itself is already migrated by the inline head script; this covers
    // language + model keys which are read later in the app lifecycle.
    migrateLocalStorageKeys();
    applyTheme(getStoredTheme());

    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    function onChange() {
      if (getStoredTheme() === "system") {
        applyTheme("system");
      }
    }
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return null;
}
