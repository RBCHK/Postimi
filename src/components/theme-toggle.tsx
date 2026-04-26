"use client";

import { useSyncExternalStore } from "react";
import { Moon, Sun } from "lucide-react";

import { Button } from "@/components/ui/button";
import { applyTheme, getStoredTheme, saveTheme, type ThemePreference } from "@/lib/theme";

const STORAGE_EVENT = "postimi_theme_change";

function subscribe(onChange: () => void) {
  window.addEventListener("storage", onChange);
  window.addEventListener(STORAGE_EVENT, onChange);
  return () => {
    window.removeEventListener("storage", onChange);
    window.removeEventListener(STORAGE_EVENT, onChange);
  };
}

function getServerSnapshot(): ThemePreference {
  return "system";
}

/**
 * Toggles between light and dark themes. Reuses the existing hand-rolled
 * theme system in `src/lib/theme.ts` (postimi_theme localStorage + .dark
 * class on <html>) so we don't introduce a parallel theme provider.
 *
 * Uses useSyncExternalStore so React reads localStorage at hydration time
 * without the "setState in useEffect" cascade warning. The button label
 * and icon resolve only after hydration (mounted flag) to avoid SSR
 * mismatch — server doesn't know the user's stored preference.
 */
export function ThemeToggle({ className }: { className?: string }) {
  const pref = useSyncExternalStore(subscribe, getStoredTheme, getServerSnapshot);
  const mounted = useSyncExternalStore(
    () => () => {},
    () => true,
    () => false
  );

  const isDark =
    pref === "dark" ||
    (pref === "system" &&
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-color-scheme: dark)").matches);

  function toggle() {
    const next: ThemePreference = isDark ? "light" : "dark";
    saveTheme(next);
    applyTheme(next);
    window.dispatchEvent(new Event(STORAGE_EVENT));
  }

  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={
        mounted ? (isDark ? "Switch to light theme" : "Switch to dark theme") : "Toggle theme"
      }
      onClick={toggle}
      className={className}
    >
      {mounted ? (
        isDark ? (
          <Sun className="size-4" />
        ) : (
          <Moon className="size-4" />
        )
      ) : (
        <Sun className="size-4 opacity-0" />
      )}
    </Button>
  );
}
