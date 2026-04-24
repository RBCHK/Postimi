import Link from "next/link";
import { auth } from "@clerk/nextjs/server";
import { WaitlistForm } from "@/components/waitlist-form";

export const metadata = {
  title: "Postimi — AI growth copilot for creators",
  description:
    "Postimi helps creators grow on X, LinkedIn, and Threads with an AI strategist that understands your voice, tracks your metrics, and plans your content.",
};

// auth() reads cookies — opts the page into dynamic rendering. Explicit for clarity.
export const dynamic = "force-dynamic";

export default async function LandingPage() {
  const { userId } = await auth();
  const ctaHref = userId
    ? (process.env.NEXT_PUBLIC_APP_URL ?? "https://app.postimi.com")
    : "/sign-in";
  const ctaLabel = userId ? "Open app" : "Sign in";

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="flex items-center justify-between px-6 py-5 md:px-10">
        <span className="text-lg font-semibold tracking-tight">Postimi</span>
        <Link
          href={ctaHref}
          className="text-sm text-muted-foreground [@media(hover:hover)]:hover:text-foreground"
        >
          {ctaLabel}
        </Link>
      </header>

      <main className="mx-auto max-w-4xl px-6 pt-12 pb-24 md:px-10 md:pt-20">
        {/* Hero */}
        <section className="text-center">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">
            Your AI growth copilot for X, LinkedIn, and Threads.
          </h1>
          <p className="mx-auto mt-5 max-w-2xl text-base text-muted-foreground md:text-lg">
            Postimi studies your analytics, understands your voice, and helps you plan and publish
            the content that actually moves the needle — without the grind.
          </p>
          <div className="mx-auto mt-8 max-w-md">
            <WaitlistForm source="landing_hero" />
          </div>
        </section>

        {/* What it does */}
        <section className="mt-24">
          <h2 className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
            What Postimi does
          </h2>
          <div className="mt-6 grid gap-4 md:grid-cols-3">
            <div className="rounded-lg border p-5">
              <h3 className="text-sm font-medium">AI content strategist</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                A thinking partner that reviews your posts, spots patterns, and suggests the next
                best move.
              </p>
            </div>
            <div className="rounded-lg border p-5">
              <h3 className="text-sm font-medium">Scheduled publishing</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Plan a whole week across X, LinkedIn, and Threads — drafts, threads, replies, and
                articles in one place.
              </p>
            </div>
            <div className="rounded-lg border p-5">
              <h3 className="text-sm font-medium">Real analytics</h3>
              <p className="mt-2 text-sm text-muted-foreground">
                Impressions, engagement, followers and post velocity — tracked against your growth
                goal, not vanity charts.
              </p>
            </div>
          </div>
        </section>

        {/* How it works */}
        <section className="mt-24">
          <h2 className="text-center text-xs font-medium uppercase tracking-wider text-muted-foreground">
            How it works
          </h2>
          <ol className="mt-6 space-y-4">
            <li className="rounded-lg border p-5">
              <div className="text-sm font-medium">1. Connect your accounts</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Link X, LinkedIn, and Threads via OAuth. Postimi never stores your password.
              </p>
            </li>
            <li className="rounded-lg border p-5">
              <div className="text-sm font-medium">2. Let the strategist read your history</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Import past posts + metrics. The strategist builds a model of your voice and
                identifies what&apos;s working.
              </p>
            </li>
            <li className="rounded-lg border p-5">
              <div className="text-sm font-medium">3. Plan, draft, publish</div>
              <p className="mt-1 text-sm text-muted-foreground">
                Use the AI copilot to draft, schedule, and publish across platforms — or iterate on
                reply strategy in real time.
              </p>
            </li>
          </ol>
        </section>

        {/* Waitlist footer CTA */}
        <section className="mt-24 rounded-lg border bg-muted/30 p-8 text-center">
          <h2 className="text-xl font-semibold">Ready to grow with Postimi?</h2>
          <p className="mx-auto mt-2 max-w-md text-sm text-muted-foreground">
            Join the waitlist. We&apos;re inviting creators in small batches.
          </p>
          <div className="mx-auto mt-6 max-w-md">
            <WaitlistForm source="landing_footer" />
          </div>
        </section>
      </main>

      <footer className="border-t px-6 py-6 text-sm text-muted-foreground md:px-10">
        <div className="mx-auto flex max-w-4xl flex-col items-center justify-between gap-3 sm:flex-row">
          <span>© {new Date().getFullYear()} Postimi</span>
          <nav className="flex gap-6">
            <Link href="/legal/privacy" className="[@media(hover:hover)]:hover:text-foreground">
              Privacy
            </Link>
            <Link href="/legal/terms" className="[@media(hover:hover)]:hover:text-foreground">
              Terms
            </Link>
            <Link href={ctaHref} className="[@media(hover:hover)]:hover:text-foreground">
              {ctaLabel}
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  );
}
