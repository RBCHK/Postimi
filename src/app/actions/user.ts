"use server";

import { requireUserId } from "@/lib/auth";
import { prisma } from "@/lib/prisma";

/**
 * Syncs the user's browser timezone to the DB.
 * Called once on app load from TimezoneSync client component.
 * No-op if timezone hasn't changed.
 */
export async function syncTimezone(timezone: string): Promise<void> {
  const userId = await requireUserId();
  const user = await prisma.user.findUnique({
    where: { id: userId },
    select: { timezone: true },
  });
  if (user?.timezone === timezone) return;
  await prisma.user.update({
    where: { id: userId },
    data: { timezone },
  });
}
