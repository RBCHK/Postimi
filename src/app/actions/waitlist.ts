"use server";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.string().max(64).optional(),
  locale: z.string().max(8).optional(),
  // Honeypot: hidden input that humans don't see and bots tend to fill.
  // Any non-empty value is a bot signal. We swallow silently (return `ok`)
  // so the bot doesn't learn the trap exists.
  hp: z.string().max(512).optional(),
});

export type WaitlistError = "invalid" | "rate_limited" | "server_error";
export type WaitlistResult = { ok: true } | { ok: false; error: WaitlistError };

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5;
// Per-email cap: one legitimate signup per email per window. The `upsert`
// below is idempotent, so a human re-submitting the same email is a no-op
// anyway — this cap catches abusers who rotate IPs but try to spray a
// single stolen email against the create path.
const EMAIL_RATE_LIMIT_MAX = 3;

export async function joinWaitlist(rawInput: unknown): Promise<WaitlistResult> {
  try {
    const parsed = Input.safeParse(rawInput);
    if (!parsed.success) return { ok: false, error: "invalid" };

    // Honeypot trip: silently report success without touching the DB.
    // Bots see `ok: true` and move on; a legitimate human never fills
    // the hidden `hp` input.
    if (parsed.data.hp && parsed.data.hp.length > 0) {
      return { ok: true };
    }

    const salt = process.env.WAITLIST_IP_SALT;
    if (!salt) {
      console.error("[joinWaitlist] WAITLIST_IP_SALT is not set");
      return { ok: false, error: "server_error" };
    }

    const h = await headers();
    const ip = h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
    const ua = h.get("user-agent")?.slice(0, 500) ?? null;
    const ipHash = createHash("sha256")
      .update(ip + salt)
      .digest("hex");

    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);

    // Two rate-limit layers — any one tripping rejects:
    //   1. per exact IP hash (existing — casual abuse)
    //   2. per email — catches stolen-list sprays even when IP rotates
    // Both run in parallel on one DB round-trip. A /24 subnet layer
    // would catch rotating-tail proxy pools but needs a separate column
    // on WaitlistEntry; intentionally deferred to keep this PR migration-free.
    const [recentByIp, recentByEmail] = await Promise.all([
      prisma.waitlistEntry.count({
        where: { ipHash, createdAt: { gte: windowStart } },
      }),
      prisma.waitlistEntry.count({
        where: { email: parsed.data.email, createdAt: { gte: windowStart } },
      }),
    ]);
    if (recentByIp >= RATE_LIMIT_MAX || recentByEmail >= EMAIL_RATE_LIMIT_MAX) {
      return { ok: false, error: "rate_limited" };
    }

    // Idempotent on email — don't overwrite an existing entry (including source/locale)
    await prisma.waitlistEntry.upsert({
      where: { email: parsed.data.email },
      create: {
        email: parsed.data.email,
        source: parsed.data.source,
        locale: parsed.data.locale,
        userAgent: ua,
        ipHash,
      },
      update: {},
    });

    return { ok: true };
  } catch (err) {
    console.error("[joinWaitlist] error:", err);
    return { ok: false, error: "server_error" };
  }
}
