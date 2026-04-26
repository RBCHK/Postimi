import type { Metadata } from "next";
import { auth } from "@clerk/nextjs/server";

import { LandingNav } from "@/components/landing/nav";
import { Hero } from "@/components/landing/hero";
import { Pillars } from "@/components/landing/pillars";
import { HowItWorks } from "@/components/landing/how-it-works";
import { StrategistDeepDive } from "@/components/landing/strategist-deep-dive";
import { VoiceBank } from "@/components/landing/voice-bank";
import { AnalyticsSection } from "@/components/landing/analytics-section";
import { Comparison } from "@/components/landing/comparison";
import { Testimonials } from "@/components/landing/testimonials";
import { FounderNote } from "@/components/landing/founder-note";
import { Faq } from "@/components/landing/faq";
import { Waitlist } from "@/components/landing/waitlist";
import { Footer } from "@/components/landing/footer";
import { getWaitlistCount } from "@/lib/server/waitlist-count";

export const metadata: Metadata = {
  title: "Postimi — An AI strategist that reads your data and tells you what to post next",
  description:
    "Postimi reads your analytics, learns your voice, and helps you plan and publish content that actually moves the needle on X, LinkedIn, and Threads.",
  openGraph: {
    title: "Postimi — AI growth copilot for creators",
    description:
      "An AI strategist that reads your data and tells you what to post next. Built for solo creators on X, LinkedIn, and Threads.",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Postimi — AI growth copilot for creators",
    description: "An AI strategist that reads your data and tells you what to post next.",
  },
};

// auth() reads cookies — opts the page into dynamic rendering. Explicit for clarity.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const [waitlistCount, { userId }] = await Promise.all([getWaitlistCount(), auth()]);
  const isSignedIn = userId !== null;

  return (
    <div data-landing className="min-h-screen">
      <LandingNav isSignedIn={isSignedIn} />
      <main>
        <Hero waitlistCount={waitlistCount} isSignedIn={isSignedIn} />
        <Pillars />
        <HowItWorks />
        <StrategistDeepDive />
        <VoiceBank />
        <AnalyticsSection />
        <Comparison />
        <Testimonials />
        <FounderNote />
        <Faq />
        <Waitlist count={waitlistCount} />
      </main>
      <Footer />
    </div>
  );
}
