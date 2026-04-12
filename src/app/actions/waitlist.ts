"use server";

import { createHash } from "crypto";
import { headers } from "next/headers";
import { z } from "zod";
import { prisma } from "@/lib/prisma";

const Input = z.object({
  email: z.string().trim().toLowerCase().email().max(254),
  source: z.string().max(64).optional(),
  locale: z.string().max(8).optional(),
});

export type WaitlistError = "invalid" | "rate_limited" | "server_error";
export type WaitlistResult = { ok: true } | { ok: false; error: WaitlistError };

const RATE_LIMIT_WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const RATE_LIMIT_MAX = 5;

export async function joinWaitlist(rawInput: unknown): Promise<WaitlistResult> {
  try {
    const parsed = Input.safeParse(rawInput);
    if (!parsed.success) return { ok: false, error: "invalid" };

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

    // Rate limit per IP: RATE_LIMIT_MAX inserts within RATE_LIMIT_WINDOW_MS
    const windowStart = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
    const recentCount = await prisma.waitlistEntry.count({
      where: { ipHash, createdAt: { gte: windowStart } },
    });
    if (recentCount >= RATE_LIMIT_MAX) return { ok: false, error: "rate_limited" };

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
