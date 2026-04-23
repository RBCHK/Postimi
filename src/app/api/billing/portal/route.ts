import { NextResponse } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { auth } from "@clerk/nextjs/server";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { getOrCreateStripeCustomer } from "@/lib/stripe-customer";

export async function POST() {
  try {
    const { userId: clerkId } = await auth();
    if (!clerkId) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

    const user = await prisma.user.findUnique({
      where: { clerkId },
      select: { id: true, clerkId: true, email: true, stripeCustomerId: true },
    });
    if (!user) return NextResponse.json({ error: "user_not_found" }, { status: 404 });

    const customerId = await getOrCreateStripeCustomer(user);

    const session = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing`,
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "billing/portal" },
    });
    console.error("[billing/portal]", err);
    return NextResponse.json({ error: "portal_failed" }, { status: 500 });
  }
}
