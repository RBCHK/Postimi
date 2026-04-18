import { NextResponse } from "next/server";
import { Webhook } from "svix";
import { headers } from "next/headers";
import { prisma } from "@/lib/prisma";
import { localeToLanguage } from "@/lib/i18n/locale-to-language";

interface ClerkUserEvent {
  id: string;
  email_addresses?: { email_address: string }[];
  first_name?: string | null;
  last_name?: string | null;
  image_url?: string | null;
  // Clerk user may carry locale in a few places depending on how the app
  // is configured. We read all three and let `localeToLanguage` pick
  // the first whitelisted one — never trust the raw value.
  public_metadata?: { locale?: unknown } | null;
  unsafe_metadata?: { locale?: unknown } | null;
  locale?: unknown;
}

export async function POST(req: Request) {
  const headerPayload = await headers();
  const svixId = headerPayload.get("svix-id");
  const svixTimestamp = headerPayload.get("svix-timestamp");
  const svixSignature = headerPayload.get("svix-signature");

  if (!svixId || !svixTimestamp || !svixSignature) {
    return NextResponse.json({ error: "Missing svix headers" }, { status: 400 });
  }

  const payload = await req.json();
  const body = JSON.stringify(payload);

  const webhookSecret = process.env.CLERK_WEBHOOK_SECRET;
  if (!webhookSecret) {
    console.error("[clerk-webhook] CLERK_WEBHOOK_SECRET not configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 500 });
  }

  const wh = new Webhook(webhookSecret);

  try {
    wh.verify(body, {
      "svix-id": svixId,
      "svix-timestamp": svixTimestamp,
      "svix-signature": svixSignature,
    });
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const { type, data } = payload as { type: string; data: ClerkUserEvent };

  if (type === "user.created" || type === "user.updated") {
    const email = (data.email_addresses?.[0]?.email_address ?? "").toLowerCase();
    const name = [data.first_name, data.last_name].filter(Boolean).join(" ") || null;

    // ADR-008 Phase 5: derive outputLanguage from Clerk locale on
    // user.created only. On user.updated we never overwrite — the user
    // may have explicitly changed their language in Settings, and a
    // webhook refire must not clobber that choice.
    const locale =
      (data.public_metadata && (data.public_metadata as { locale?: unknown }).locale) ??
      (data.unsafe_metadata && (data.unsafe_metadata as { locale?: unknown }).locale) ??
      data.locale ??
      null;
    const derivedLanguage = localeToLanguage(locale);

    const user = await prisma.user.upsert({
      where: { clerkId: data.id },
      update: {
        email,
        name,
        imageUrl: data.image_url ?? null,
      },
      create: {
        clerkId: data.id,
        email,
        name,
        imageUrl: data.image_url ?? null,
        // Null → reader falls back to DEFAULT_LANGUAGE ("EN").
        outputLanguage: derivedLanguage,
      },
    });

    // Link waitlist conversion (best-effort; never fail webhook on this).
    if (type === "user.created" && email) {
      try {
        await prisma.waitlistEntry.updateMany({
          where: { email, convertedUserId: null },
          data: { convertedUserId: user.id },
        });
      } catch (err) {
        console.error("[clerk-webhook] waitlist conversion link failed:", err);
      }
    }
  }

  if (type === "user.deleted") {
    // Cascade deletes handle related data via onDelete: Cascade
    await prisma.user.delete({ where: { clerkId: data.id } }).catch(() => {
      // User may not exist in our DB yet
    });
  }

  return NextResponse.json({ ok: true });
}
