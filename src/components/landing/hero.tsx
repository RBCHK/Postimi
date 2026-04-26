import Link from "next/link";

import { Reveal } from "@/components/landing/primitives/reveal";
import { ComposerMock } from "@/components/landing/mocks/composer-mock";
import { ArrowRight, Linkedin, PlayCircle, Threads, XLogo } from "@/components/landing/icons";
import { Button } from "@/components/ui/button";
import { LANDING_COPY } from "@/lib/landing-copy";

const APP_URL = process.env.NEXT_PUBLIC_APP_URL ?? "https://app.postimi.com";

const PLATFORM_ICONS = {
  twitter: XLogo,
  linkedin: Linkedin,
  threads: Threads,
} as const;

export function Hero({
  waitlistCount,
  isSignedIn,
}: {
  waitlistCount: number;
  isSignedIn: boolean;
}) {
  const copy = LANDING_COPY.hero;
  return (
    <section id="top" className="relative overflow-hidden pb-6 pt-14">
      <div className="hero-glow" />
      <div className="grid-backdrop" />
      <div className="relative z-10 mx-auto max-w-[1240px] px-5 md:px-8">
        <Reveal>
          <span
            className="inline-flex h-7 items-center gap-2 rounded-full border px-3 font-mono text-[11px] font-medium tracking-[0.04em]"
            style={{
              background: "var(--accent-soft)",
              borderColor: "var(--accent-border)",
              color: "var(--accent-text)",
            }}
          >
            <span className="pulse-dot" /> {copy.pillTemplate(waitlistCount)}
          </span>
        </Reveal>
        <Reveal delay={80}>
          <h1 className="h-display mt-6 max-w-[980px]">
            {copy.headlineLead}
            <br />
            <span className="display-italic" style={{ color: "var(--accent-text)" }}>
              {copy.headlineAccent}
            </span>
          </h1>
        </Reveal>
        <Reveal delay={160}>
          <p className="lead mt-6 max-w-[620px]">{copy.leadParagraph}</p>
        </Reveal>
        <Reveal delay={240}>
          <div className="mt-9 flex flex-wrap items-center gap-3">
            {/* Auth-aware primary CTA — resolved server-side, no flash. */}
            {isSignedIn ? (
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <a href={APP_URL}>
                  {LANDING_COPY.nav.openApp} <ArrowRight className="size-4" />
                </a>
              </Button>
            ) : (
              <Button asChild size="lg" className="h-12 px-6 text-base">
                <Link href="#waitlist">
                  {copy.ctaPrimary} <ArrowRight className="size-4" />
                </Link>
              </Button>
            )}
            <Button asChild variant="outline" size="lg" className="h-12 px-6 text-base">
              <Link href="#how">
                <PlayCircle className="size-4" /> {copy.ctaSecondary}
              </Link>
            </Button>
            <span className="ml-1 font-mono text-xs" style={{ color: "var(--text-3)" }}>
              {copy.finePrint}
            </span>
          </div>
        </Reveal>
        <Reveal delay={360} className="mt-16 block">
          <ComposerMock />
        </Reveal>
        <Reveal delay={500}>
          <PlatformStrip />
        </Reveal>
      </div>
    </section>
  );
}

function PlatformStrip() {
  return (
    <div className="mt-12 border-t pt-6" style={{ borderColor: "var(--border)" }}>
      <div className="eyebrow mb-[18px] text-center">{LANDING_COPY.hero.platformsLabel}</div>
      <div
        className="flex flex-wrap items-center justify-center gap-6 sm:gap-12"
        style={{ color: "var(--text-3)" }}
      >
        {LANDING_COPY.hero.platforms.map((p) => {
          const Icon = PLATFORM_ICONS[p.icon];
          return (
            <span key={p.label} className="inline-flex items-center gap-2 text-base font-medium">
              <Icon className="size-[18px]" /> {p.label}
            </span>
          );
        })}
      </div>
    </div>
  );
}
