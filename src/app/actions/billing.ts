"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import type { SubscriptionStatus } from "@/generated/prisma";

export type BillingInfo = {
  hasSubscription: boolean;
  status: SubscriptionStatus | null;
  currentPeriodEnd: string | null; // ISO string
  cancelAtPeriodEnd: boolean;
};

export async function getBillingInfo(): Promise<BillingInfo> {
  const userId = await requireUserId();

  const subscription = await prisma.subscription.findUnique({
    where: { userId },
    select: {
      status: true,
      currentPeriodEnd: true,
      cancelAtPeriodEnd: true,
    },
  });

  if (!subscription) {
    return {
      hasSubscription: false,
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
    };
  }

  return {
    hasSubscription: true,
    status: subscription.status,
    currentPeriodEnd: subscription.currentPeriodEnd.toISOString(),
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}
