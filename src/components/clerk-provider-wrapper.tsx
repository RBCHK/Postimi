"use client";

import { ClerkProvider } from "@clerk/nextjs";
import { dark } from "@clerk/themes";
import { useEffect, useState } from "react";

/**
 * Shared ClerkProvider wrapper used by both the app shell and the sign-in route.
 * Marketing pages (landing, waitlist, legal) intentionally do NOT mount this —
 * keeping Clerk SDK out of marketing bundles is part of the subdomain split rationale.
 *
 * Tracks `document.documentElement.classList.contains('dark')` so Clerk
 * UserButton popover / modals follow the app theme.
 */
export function ClerkProviderWrapper({ children }: { children: React.ReactNode }) {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    const root = document.documentElement;
    const update = () => setIsDark(root.classList.contains("dark"));
    update();
    const obs = new MutationObserver(update);
    obs.observe(root, { attributes: true, attributeFilter: ["class"] });
    return () => obs.disconnect();
  }, []);

  return (
    <ClerkProvider appearance={isDark ? { baseTheme: dark } : undefined}>{children}</ClerkProvider>
  );
}
