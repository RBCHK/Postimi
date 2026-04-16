export const dynamic = "force-dynamic";

import { getCronConfigs, getCronRuns } from "@/app/actions/admin";
import { prisma } from "@/lib/prisma";
import { AdminView } from "./admin-view";

export default async function AdminPage() {
  const [configs, runs, waitlistRaw] = await Promise.all([
    getCronConfigs(),
    getCronRuns({ limit: 50 }),
    prisma.waitlistEntry.findMany({
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
    }),
  ]);

  const waitlist = waitlistRaw.map((e) => ({
    ...e,
    createdAt: e.createdAt.toISOString(),
    invitedAt: e.invitedAt?.toISOString() ?? null,
  }));

  return <AdminView initialConfigs={configs} initialRuns={runs} initialWaitlist={waitlist} />;
}
