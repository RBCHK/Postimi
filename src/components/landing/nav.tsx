"use client";

import { useEffect, useState } from "react";
import Link from "next/link";

import { ThemeToggle } from "@/components/theme-toggle";
import { Button } from "@/components/ui/button";
import { LANDING_COPY } from "@/lib/landing-copy";
import { cn } from "@/lib/utils";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.postimi.com";

// Auth status comes in via prop (resolved server-side in src/app/page.tsx).
// Marketing pages intentionally don't mount <ClerkProvider> — keeps the
// Clerk SDK out of the marketing bundle.
export function LandingNav({ isSignedIn }: { isSignedIn: boolean }) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    function onScroll() {
      setScrolled(window.scrollY > 8);
    }
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header
      className={cn(
        "sticky top-0 z-50 backdrop-blur-md transition-[background,border-color] duration-200 pt-[env(safe-area-inset-top)]",
        scrolled && "nav-elevated"
      )}
    >
      <div className="mx-auto flex h-16 max-w-[1240px] items-center justify-between px-5 md:px-8">
        <Link href="#top" className="flex items-center gap-2.5">
          <span className="logo-mark">P</span>
          <span
            className="text-base font-semibold tracking-[-0.01em]"
            style={{ color: "var(--text-0)" }}
          >
            {LANDING_COPY.nav.brand}
          </span>
          <span
            className="hidden h-[22px] items-center rounded-full border px-2 font-mono text-[10px] font-medium tracking-[0.04em] sm:inline-flex"
            style={{
              background: "var(--bg-2)",
              borderColor: "var(--border)",
              color: "var(--text-2)",
            }}
          >
            {LANDING_COPY.nav.beta}
          </span>
        </Link>

        <nav className="hidden items-center gap-1 md:flex">
          {LANDING_COPY.nav.links.map((l) => (
            <Button
              key={l.href}
              asChild
              variant="ghost"
              size="sm"
              className="font-normal"
              style={{ color: "var(--text-1)" }}
            >
              <Link href={l.href}>{l.label}</Link>
            </Button>
          ))}
        </nav>

        <div className="flex items-center gap-1.5">
          <ThemeToggle className="hidden sm:inline-flex" />
          {/* Auth-aware CTA — resolved server-side, no flash. */}
          {isSignedIn ? (
            <Button asChild size="sm">
              <a href={APP_URL}>{LANDING_COPY.nav.openApp}</a>
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="#waitlist">{LANDING_COPY.nav.join}</Link>
            </Button>
          )}
        </div>
      </div>
    </header>
  );
}
