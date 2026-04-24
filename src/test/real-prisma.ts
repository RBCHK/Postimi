/**
 * Shared helpers for integration tests that hit a real Postgres.
 *
 * Why real DB: CLAUDE.md mandates "integration tests must hit a real
 * database, not mocks" — a prior incident shipped a broken migration
 * because mocked tests reported green while prod was actually broken.
 *
 * Cleanup model: every test creates rows with a predictable prefix
 * (e.g. `user_test_<rnd>`, `evt_test_<rnd>`). `cleanupByPrefix` deletes
 * rows owned by the prefix so parallel test files never collide and
 * never leave drift behind. We never truncate whole tables.
 */
import { prisma } from "@/lib/prisma";

/**
 * Returns a short random suffix suitable for building test-scoped IDs.
 * Length 8 keeps IDs readable in logs while collision probability per
 * test file stays negligible.
 */
export function randomSuffix(): string {
  return Math.random().toString(36).slice(2, 10);
}

/**
 * Surgical cleanup. Each entry owns one table and a prefix — rows whose
 * PK (or key field) starts with that prefix get wiped. This is always
 * safe because production IDs use cuid() which never starts with the
 * test prefixes we use.
 */
export async function cleanupByPrefix(
  prefix: string,
  options: {
    clerkId?: boolean;
    email?: boolean;
    eventId?: boolean;
    stripeSubscriptionId?: boolean;
    userIdField?: boolean;
  } = {}
): Promise<void> {
  // Delete children first because `User` has many cascade relations —
  // we want a predictable order even though Cascade would normally
  // handle it.
  if (options.eventId) {
    await prisma.stripeWebhookEvent.deleteMany({
      where: { eventId: { startsWith: prefix } },
    });
  }
  if (options.stripeSubscriptionId) {
    await prisma.subscription.deleteMany({
      where: { stripeSubscriptionId: { startsWith: prefix } },
    });
  }
  if (options.email) {
    await prisma.waitlistEntry.deleteMany({
      where: { email: { startsWith: prefix } },
    });
  }
  if (options.clerkId) {
    // User has many relations via onDelete: Cascade — safe to drop by clerkId.
    await prisma.user.deleteMany({
      where: { clerkId: { startsWith: prefix } },
    });
  }
}

/**
 * Creates a test User row and returns it. Safe to call many times in
 * one test — callers pass a unique suffix via `clerkId`.
 */
export async function createTestUser(opts: {
  clerkId: string;
  email?: string;
  name?: string | null;
}): Promise<{ id: string; clerkId: string }> {
  const user = await prisma.user.create({
    data: {
      clerkId: opts.clerkId,
      email: opts.email ?? `${opts.clerkId}@test.postimi`,
      name: opts.name ?? null,
    },
    select: { id: true, clerkId: true },
  });
  return user;
}
