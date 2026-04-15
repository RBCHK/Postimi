import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { SubscriptionStatus } from "@/generated/prisma";

/**
 * Test-only endpoint: grants the authenticated user an ACTIVE subscription.
 * Gated by ALLOW_TEST_SEED env flag — must NOT be set in production.
 * Used by Playwright global-setup to seed subscription state for E2E runs.
 */
export async function POST() {
  if (process.env.ALLOW_TEST_SEED !== "true") {
    return NextResponse.json({ error: "Not found" }, { status: 404 });
  }

  const userId = await requireUserId();
  const now = new Date();
  const periodEnd = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);

  await prisma.subscription.upsert({
    where: { userId },
    update: {
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
    },
    create: {
      userId,
      status: SubscriptionStatus.ACTIVE,
      currentPeriodStart: now,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: false,
      stripeCustomerId: `test_cus_${userId}`,
      stripeSubscriptionId: `test_sub_${userId}`,
      stripePriceId: "test_price",
    },
  });

  return NextResponse.json({ ok: true });
}
