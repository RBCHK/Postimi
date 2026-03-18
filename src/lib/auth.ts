import { auth, currentUser } from "@clerk/nextjs/server";
import { prisma } from "@/lib/prisma";
import { redirect } from "next/navigation";

const ADMIN_CLERK_IDS = (process.env.ADMIN_CLERK_IDS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

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
  if (!clerkUser) throw new Error("Unauthorized");

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

/**
 * Returns the internal DB userId if the current Clerk user is an admin.
 * Redirects to "/" if not admin. Use in server components / layouts.
 */
export async function requireAdmin(): Promise<string> {
  const { userId: clerkId } = await auth();
  if (!clerkId || !ADMIN_CLERK_IDS.includes(clerkId)) {
    redirect("/");
  }

  const user = await prisma.user.findUnique({
    where: { clerkId },
    select: { id: true },
  });
  if (!user) redirect("/");

  return user.id;
}

/**
 * Returns true if the current Clerk user is an admin.
 * For conditional UI rendering in server components.
 */
export async function isAdmin(): Promise<boolean> {
  const { userId: clerkId } = await auth();
  if (!clerkId) return false;
  return ADMIN_CLERK_IDS.includes(clerkId);
}
