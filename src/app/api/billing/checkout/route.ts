import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { stripe, STRIPE_PRICE_ID } from "@/lib/stripe";
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

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      mode: "subscription",
      line_items: [{ price: STRIPE_PRICE_ID, quantity: 1 }],
      success_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?checkout=success`,
      cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/settings/billing?checkout=cancel`,
      allow_promotion_codes: true,
      metadata: { userId: user.id },
    });

    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[billing/checkout]", err);
    return NextResponse.json({ error: "checkout_failed" }, { status: 500 });
  }
}
