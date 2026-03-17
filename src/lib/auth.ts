import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";

/**
 * Returns the internal DB userId for the currently authenticated Clerk user.
 * Auto-creates DB record on first encounter (fallback if webhook hasn't fired yet).
 * Throws if not authenticated.
 */
export async function requireUserId(): Promise<string> {
  const { userId: clerkId } = await auth();
  if (!clerkId) throw new Error("Unauthorized");

  const existing = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (existing) return existing.id;

  // Auto-create user if webhook hasn't synced yet
  const clerkUser = await currentUser();
  const user = await prisma.user.upsert({
    where: { clerkId },
    update: {},
    create: {
      clerkId,
      email: clerkUser?.emailAddresses[0]?.emailAddress ?? "",
      name: [clerkUser?.firstName, clerkUser?.lastName].filter(Boolean).join(" ") || null,
      imageUrl: clerkUser?.imageUrl ?? null,
    },
    select: { id: true },
  });

  return user.id;
}
