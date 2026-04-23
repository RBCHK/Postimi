import { NextResponse, type NextRequest } from "next/server";
import * as Sentry from "@sentry/nextjs";
import { stripe } from "@/lib/stripe";
import { prisma } from "@/lib/prisma";
import { SubscriptionStatus } from "@/generated/prisma";
import type Stripe from "stripe";

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

/**
 * Maps Stripe subscription status strings to our Prisma enum.
 */
const STATUS_MAP: Record<string, SubscriptionStatus> = {
  active: SubscriptionStatus.ACTIVE,
  trialing: SubscriptionStatus.TRIALING,
  past_due: SubscriptionStatus.PAST_DUE,
  canceled: SubscriptionStatus.CANCELED,
  incomplete: SubscriptionStatus.INCOMPLETE,
  incomplete_expired: SubscriptionStatus.INCOMPLETE_EXPIRED,
  unpaid: SubscriptionStatus.UNPAID,
};

function mapStatus(stripeStatus: string): SubscriptionStatus {
  return STATUS_MAP[stripeStatus] ?? SubscriptionStatus.INCOMPLETE;
}

/**
 * Prisma error code for unique-constraint violation. Used here to detect
 * that a webhook event has already been recorded — we treat that as
 * "already processed, skip" and return 200.
 */
const PRISMA_UNIQUE_VIOLATION = "P2002";

function isUniqueViolation(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  return (err as { code?: string }).code === PRISMA_UNIQUE_VIOLATION;
}

/**
 * Records the webhook event id in the idempotency ledger BEFORE
 * processing. Returns true when this is the first time we've seen the
 * event and the caller should proceed to process it. Returns false when
 * the event was already recorded by a prior (possibly concurrent)
 * delivery — the caller must respond 200 and do nothing else.
 *
 * Race-safety: two concurrent requests for the same event.id race on
 * the PK insert. Postgres guarantees only one commits; the other
 * receives a unique-constraint violation (P2002).
 */
async function claimEvent(event: Stripe.Event): Promise<boolean> {
  try {
    await prisma.stripeWebhookEvent.create({
      data: { eventId: event.id, type: event.type },
    });
    return true;
  } catch (err) {
    if (isUniqueViolation(err)) return false;
    throw err;
  }
}

/**
 * Upserts a Subscription record from a Stripe subscription object.
 * Idempotent — safe to call on retried webhook events.
 */
async function upsertSubscription(sub: Stripe.Subscription): Promise<void> {
  const userId = sub.metadata.userId;
  if (!userId) {
    Sentry.captureMessage("[stripe-webhook] subscription missing metadata.userId", {
      level: "error",
      tags: { route: "webhooks/stripe", subscriptionId: sub.id },
    });
    console.error("[stripe-webhook] subscription missing metadata.userId:", sub.id);
    return;
  }

  const customerId = typeof sub.customer === "string" ? sub.customer : sub.customer.id;
  const item = sub.items.data[0];
  // Stripe SDK v17+: period lives on the item, not the subscription root
  const periodStart = item ? new Date(item.current_period_start * 1000) : new Date();
  const periodEnd = item ? new Date(item.current_period_end * 1000) : new Date();

  await prisma.subscription.upsert({
    where: { stripeSubscriptionId: sub.id },
    create: {
      userId,
      stripeCustomerId: customerId,
      stripeSubscriptionId: sub.id,
      stripePriceId: item?.price.id ?? "",
      status: mapStatus(sub.status),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
    update: {
      stripePriceId: item?.price.id ?? "",
      status: mapStatus(sub.status),
      currentPeriodStart: periodStart,
      currentPeriodEnd: periodEnd,
      cancelAtPeriodEnd: sub.cancel_at_period_end,
      canceledAt: sub.canceled_at ? new Date(sub.canceled_at * 1000) : null,
    },
  });
}

export async function POST(req: NextRequest) {
  if (!WEBHOOK_SECRET) {
    Sentry.captureMessage("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set", {
      level: "error",
      tags: { route: "webhooks/stripe" },
    });
    console.error("[stripe-webhook] STRIPE_WEBHOOK_SECRET not set");
    return NextResponse.json({ error: "webhook_not_configured" }, { status: 500 });
  }

  const body = await req.text();
  const signature = req.headers.get("stripe-signature");
  if (!signature) {
    return NextResponse.json({ error: "missing_signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, signature, WEBHOOK_SECRET);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "webhooks/stripe", step: "signature-verify" },
    });
    console.error("[stripe-webhook] signature verification failed:", err);
    return NextResponse.json({ error: "invalid_signature" }, { status: 400 });
  }

  // Idempotency: claim the event before processing. If another delivery
  // for the same event.id has already been processed (or is racing with
  // us), bail out with 200. Stripe keeps retrying on 5xx, so we never
  // surface a dedup hit as an error.
  let claimed: boolean;
  try {
    claimed = await claimEvent(event);
  } catch (err) {
    Sentry.captureException(err, {
      tags: { route: "webhooks/stripe", step: "claim-event", event: event.type },
    });
    console.error("[stripe-webhook] claim-event failed:", event.type, err);
    return NextResponse.json({ error: "claim_failed" }, { status: 500 });
  }
  if (!claimed) {
    return NextResponse.json({ received: true, duplicate: true });
  }

  try {
    switch (event.type) {
      case "customer.subscription.created":
      case "customer.subscription.updated": {
        const sub = event.data.object as Stripe.Subscription;
        await upsertSubscription(sub);
        break;
      }
      case "customer.subscription.deleted": {
        const sub = event.data.object as Stripe.Subscription;
        await prisma.subscription.updateMany({
          where: { stripeSubscriptionId: sub.id },
          data: {
            status: SubscriptionStatus.CANCELED,
            canceledAt: new Date(),
          },
        });
        break;
      }
      case "invoice.payment_failed": {
        const invoice = event.data.object as Stripe.Invoice;
        Sentry.captureMessage("[stripe-webhook] payment failed", {
          level: "warning",
          tags: { route: "webhooks/stripe", customer: String(invoice.customer ?? "unknown") },
        });
        console.warn("[stripe-webhook] payment failed for customer:", invoice.customer);
        break;
      }
      default:
        // Unhandled event type — acknowledge receipt
        break;
    }
  } catch (err) {
    // Handler failed after claiming the event. Roll back the claim so
    // Stripe's retry can pick up where we left off — otherwise the next
    // delivery would short-circuit on duplicate and the side-effect
    // stays lost forever.
    await prisma.stripeWebhookEvent.delete({ where: { eventId: event.id } }).catch((delErr) => {
      Sentry.captureException(delErr, {
        tags: { route: "webhooks/stripe", step: "rollback-claim", event: event.type },
      });
    });

    Sentry.captureException(err, {
      tags: { route: "webhooks/stripe", step: "handler", event: event.type },
    });
    console.error("[stripe-webhook] error handling event:", event.type, err);
    return NextResponse.json({ error: "handler_failed" }, { status: 500 });
  }

  return NextResponse.json({ received: true });
}
