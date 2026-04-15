export const dynamic = "force-dynamic";

import { prisma } from "@/lib/prisma";
import { WaitlistAdminView } from "./waitlist-view";

export default async function AdminWaitlistPage() {
  const entries = await prisma.waitlistEntry.findMany({
    orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
    take: 500,
    select: {
      id: true,
      email: true,
      source: true,
      locale: true,
      priority: true,
      createdAt: true,
      invitedAt: true,
      invitationId: true,
      convertedUserId: true,
    },
  });

  const serialized = entries.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    invitedAt: e.invitedAt?.toISOString() ?? null,
  }));

  return <WaitlistAdminView entries={serialized} />;
}
