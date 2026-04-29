import { prisma } from "@/lib/prisma";

// 2026-04 refactor: synthetic User row that owns AiUsage records for
// platform-wide GLOBAL research (not attributable to any real user).
//
// Avoids a nullable `AiUsage.userId` schema refactor that would touch
// every aggregation in admin / billing dashboards. Cost stays auditable
// per CLAUDE.md "Critical path ≠ non-critical side effect" — global
// research is not a critical-path billing item, but its cost MUST be
// trackable, not hidden in Anthropic's console alone.
//
// Properties:
//   - clerkId is a fixed sentinel that no real Clerk user can take
//     (Clerk IDs start with "user_" or "session_"; "system_*" is ours)
//   - email is on the .internal TLD so it can't accidentally route mail
//   - never logs in via Clerk (no Clerk user with this id exists)
//   - excluded from per-user cron loops via NOT clerkId

export const SYSTEM_USER_CLERK_ID = "system_global_research";
export const SYSTEM_USER_EMAIL = "system+global-research@postimi.internal";

/**
 * Idempotent. Run at the top of any cron that needs to reserve AiUsage
 * for non-user-scoped operations (today: researcher Phase A).
 */
export async function ensureSystemUser(): Promise<{ id: string }> {
  return prisma.user.upsert({
    where: { clerkId: SYSTEM_USER_CLERK_ID },
    create: {
      clerkId: SYSTEM_USER_CLERK_ID,
      email: SYSTEM_USER_EMAIL,
      name: "Global Research (system)",
      timezone: "UTC",
    },
    update: {},
    select: { id: true },
  });
}

/**
 * Use as `where: { ...excludeSystemUser() }` in any cron that iterates
 * `prisma.user.findMany()` over real users. SYSTEM_USER has no
 * subscription, no platforms, no niche — running the per-user loop
 * for it would error or no-op every time.
 */
export function excludeSystemUser() {
  return { clerkId: { not: SYSTEM_USER_CLERK_ID } } as const;
}
