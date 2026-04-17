"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { useSyncExternalStore } from "react";

function subscribeTheme(callback: () => void) {
  const observer = new MutationObserver(callback);
  observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["class"],
  });
  return () => observer.disconnect();
}

function getIsDarkSnapshot() {
  return document.documentElement.classList.contains("dark");
}

function getServerSnapshot() {
  return false;
}

// Mirrors the .dark CSS variables in src/app/globals.css so Clerk's UserButton
// popover, SignIn card, and modals match the rest of the app in dark mode.
// Hardcoded (not var(--…)) because Clerk's appearance API doesn't accept CSS variables.
const DARK_APPEARANCE = {
  variables: {
    colorBackground: "#232528",
    colorForeground: "#ffffff",
    colorNeutral: "#ffffff",
    colorPrimary: "#5e6ad2",
    colorPrimaryForeground: "#ffffff",
    colorInput: "rgba(255, 255, 255, 0.08)",
    colorInputForeground: "#ffffff",
    colorMuted: "#1c1e21",
    colorMutedForeground: "#b0b0b0",
    colorBorder: "rgba(255, 255, 255, 0.05)",
  },
  elements: {
    // Clerk thins `colorBorder` opacity ~10x for buttons in dark mode, leaving
    // social buttons invisible against the card. Force a visible subtle surface.
    socialButtonsBlockButton: {
      backgroundColor: "rgba(255, 255, 255, 0.05)",
      border: "1px solid rgba(255, 255, 255, 0.12)",
      "&:hover": { backgroundColor: "rgba(255, 255, 255, 0.1)" },
    },
    dividerLine: { backgroundColor: "rgba(255, 255, 255, 0.1)" },
    // UserButton popover section dividers blend into the dark card otherwise
    // (Clerk uses `colorBorder` opacity which we keep subtle for the rest of the UI).
    userButtonPopoverActions: { borderTop: "1px solid rgba(255, 255, 255, 0.1)" },
    userButtonPopoverFooter: { borderTop: "1px solid rgba(255, 255, 255, 0.1)" },
    userButtonPopoverActionButton: {
      "&:not(:last-child)": { borderBottom: "1px solid rgba(255, 255, 255, 0.1)" },
    },
  },
} as const;

/**
 * Shared ClerkProvider wrapper used by both the app shell and the sign-in route.
 * Marketing pages (landing, waitlist, legal) intentionally do NOT mount this —
 * keeping Clerk SDK out of marketing bundles is part of the subdomain split rationale.
 *
 * Subscribes to the `.dark` class on <html> via useSyncExternalStore so Clerk
 * UserButton popover / SignIn card follow the app theme. Uses appearance.variables
 * (not baseTheme) because @clerk/themes@2.x is built against @clerk/shared@3 while
 * @clerk/nextjs@7 uses @clerk/shared@4 — the BaseTheme objects are not interchangeable.
 * The `key` prop forces a clean remount on theme change.
 */
export function ClerkProviderWrapper({ children }: { children: React.ReactNode }) {
  const isDark = useSyncExternalStore(subscribeTheme, getIsDarkSnapshot, getServerSnapshot);

  return (
    <ClerkProvider
      key={isDark ? "dark" : "light"}
      appearance={isDark ? DARK_APPEARANCE : undefined}
    >
      {children}
    </ClerkProvider>
  );
}
