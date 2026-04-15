"use server";

import { requireAdmin } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { createClerkInvitation } from "@/lib/clerk-invitations";
import { sendEmail } from "@/lib/email";
import { invitationEmailTemplate } from "@/emails/invitation";
import { revalidatePath } from "next/cache";

export type InvitationResult =
  | { id: string; email: string; status: "sent"; invitationId: string }
  | { id: string; email: string; status: "skipped"; reason: "already_invited" }
  | { id: string; email: string; status: "failed"; error: string };

export interface BatchInvitationResult {
  sent: number;
  skipped: number;
  failed: number;
  results: InvitationResult[];
}

const CONCURRENCY = 5;

async function runWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let idx = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (true) {
      const i = idx++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function sendBatchInvitations(
  waitlistEntryIds: string[]
): Promise<BatchInvitationResult> {
  await requireAdmin();

  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!appUrl) throw new Error("NEXT_PUBLIC_APP_URL is not set");

  const entries = await prisma.waitlistEntry.findMany({
    where: { id: { in: waitlistEntryIds } },
    select: { id: true, email: true, locale: true, invitedAt: true },
  });

  const results = await runWithConcurrency(
    entries,
    CONCURRENCY,
    async (entry): Promise<InvitationResult> => {
      if (entry.invitedAt) {
        return { id: entry.id, email: entry.email, status: "skipped", reason: "already_invited" };
      }

      try {
        const invitation = await createClerkInvitation(entry.email, `${appUrl}/sign-up`);

        const signupUrl = invitation.url ?? `${appUrl}/sign-up`;
        const tpl = invitationEmailTemplate({ signupUrl, locale: entry.locale ?? "en" });
        await sendEmail({ to: entry.email, subject: tpl.subject, html: tpl.html, text: tpl.text });

        await prisma.waitlistEntry.update({
          where: { id: entry.id },
          data: { invitedAt: new Date(), invitationId: invitation.id },
        });

        return { id: entry.id, email: entry.email, status: "sent", invitationId: invitation.id };
      } catch (err) {
        return {
          id: entry.id,
          email: entry.email,
          status: "failed",
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  );

  revalidatePath("/admin/waitlist");

  return {
    sent: results.filter((r) => r.status === "sent").length,
    skipped: results.filter((r) => r.status === "skipped").length,
    failed: results.filter((r) => r.status === "failed").length,
    results,
  };
}
