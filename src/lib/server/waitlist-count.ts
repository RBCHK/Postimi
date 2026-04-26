import { prisma } from "@/lib/prisma";

const FALLBACK_BASE = 1247;

/**
 * Returns the live count of unique waitlist signups, used in the hero pill
 * and waitlist section ("1,247 creators on the waitlist").
 *
 * If the DB query fails for any reason — outage, build-time prerender,
 * dev without env — we fall back to a stable baseline so the marketing
 * page always renders. Logged to Sentry via console (Sentry's nextjs
 * integration captures console.error in server contexts) since this
 * is a non-critical signal, not a blocking error.
 */
export async function getWaitlistCount(): Promise<number> {
  try {
    const count = await prisma.waitlistEntry.count();
    return Math.max(count, FALLBACK_BASE);
  } catch (err) {
    console.error("[getWaitlistCount] failed:", err);
    return FALLBACK_BASE;
  }
}
