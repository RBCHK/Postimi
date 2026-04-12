import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";

/**
 * Returns the Stripe customer ID for a user, creating one if needed.
 * Idempotent: searches Stripe by metadata before creating to avoid duplicates on race.
 */
export async function getOrCreateStripeCustomer(user: {
  id: string;
  clerkId: string;
  email: string;
  stripeCustomerId: string | null;
}): Promise<string> {
  if (user.stripeCustomerId) return user.stripeCustomerId;

  // Race-condition guard: check if Stripe already has this user
  const existing = await stripe.customers.search({
    query: `metadata['userId']:'${user.id}'`,
    limit: 1,
  });

  const customerId =
    existing.data[0]?.id ??
    (
      await stripe.customers.create({
        email: user.email,
        metadata: { userId: user.id, clerkId: user.clerkId },
      })
    ).id;

  await prisma.user.update({
    where: { id: user.id },
    data: { stripeCustomerId: customerId },
  });

  return customerId;
}
