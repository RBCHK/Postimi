import { prisma } from "@/lib/prisma";
import { SubscriptionStatus } from "@/generated/prisma";
import type { Subscription } from "@/generated/prisma";
import { SubscriptionRequiredError } from "@/lib/errors";

/**
 * Returns the active (or trialing) subscription for a user, or null.
 * "Active" means status is ACTIVE or TRIALING and the current period hasn't ended.
 */
export async function getActiveSubscription(userId: string): Promise<Subscription | null> {
  return prisma.subscription.findFirst({
    where: {
      userId,
      status: { in: [SubscriptionStatus.ACTIVE, SubscriptionStatus.TRIALING] },
      currentPeriodEnd: { gt: new Date() },
    },
  });
}

/**
 * Returns the active subscription or throws SubscriptionRequiredError.
 * Use in server actions / API routes that require a paid user.
 */
export async function requireActiveSubscription(userId: string): Promise<Subscription> {
  const sub = await getActiveSubscription(userId);
  if (!sub) throw new SubscriptionRequiredError();
  return sub;
}
