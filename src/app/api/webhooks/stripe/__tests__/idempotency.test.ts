/**
 * Stripe webhook idempotency tests — real Postgres.
 *
 * CLAUDE.md forbids mocking the DB in critical-path tests (prior
 * incident: mocks hid a broken migration). This file drives the real
 * `StripeWebhookEvent` PK to prove the idempotency lock works the way
 * production expects, not the way the mock was configured to lie.
 *
 * Covers:
 *   1. First call: claims the event (insert into StripeWebhookEvent) and
 *      processes downstream side-effects.
 *   2. Retry: the claim insert fails with P2002 → handler returns 200
 *      without touching downstream state.
 *   3. Concurrent deliveries: two parallel POSTs race on the PK, exactly
 *      one wins the claim, the other gets 200 no-op. Downstream
 *      side-effect fires exactly once.
 *   4. Handler error after claim: claim is rolled back so Stripe's retry
 *      can pick up where we left off (otherwise the side-effect is lost
 *      forever, since any future delivery would short-circuit as dup).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { prisma } from "@/lib/prisma";
import { cleanupByPrefix, createTestUser, randomSuffix } from "@/test/real-prisma";

// ─── Mocks (non-DB) ──────────────────────────────────────

const constructEventMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/stripe", () => ({
  stripe: {
    webhooks: { constructEvent: constructEventMock },
  },
}));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const ORIGINAL_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

// Per-file prefix lets us clean up exactly what we created. Generated
// once so every row in this suite is attributable to this test file.
const PREFIX = `stripe_idem_${randomSuffix()}_`;
let TEST_USER_ID: string;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

  // Fresh test user per test. `clerkId` carries the prefix so cleanup
  // can sweep it surgically. Subscription cascades with the user.
  const clerkId = `${PREFIX}user_${randomSuffix()}`;
  const user = await createTestUser({ clerkId });
  TEST_USER_ID = user.id;
});

afterEach(async () => {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;

  // Clean up webhook events + subscriptions + users scoped to this file.
  await cleanupByPrefix(PREFIX, {
    eventId: true,
    stripeSubscriptionId: true,
    clerkId: true,
  });
});

function makeRequest(signature = "sig_test"): Request {
  return new Request("https://app.postimi.com/api/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": signature },
  });
}

function makeSubscriptionCreatedEvent(eventId: string, subId: string, userId: string) {
  return {
    id: eventId,
    type: "customer.subscription.created",
    data: {
      object: {
        id: subId,
        status: "active",
        customer: `${PREFIX}cus_${randomSuffix()}`,
        metadata: { userId },
        items: {
          data: [
            {
              price: { id: `${PREFIX}price_1` },
              current_period_start: Math.floor(Date.now() / 1000),
              current_period_end: Math.floor(Date.now() / 1000) + 2592000,
            },
          ],
        },
        cancel_at_period_end: false,
        canceled_at: null,
      },
    },
  };
}

describe("POST /api/webhooks/stripe — idempotency (real DB)", () => {
  it("first delivery: records event + processes downstream", async () => {
    const eventId = `${PREFIX}evt_${randomSuffix()}`;
    const subId = `${PREFIX}sub_${randomSuffix()}`;
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent(eventId, subId, TEST_USER_ID));

    const { POST } = await import("../route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ received: true });
    expect(data.duplicate).toBeUndefined();

    // Event row actually exists in Postgres.
    const claim = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } });
    expect(claim).not.toBeNull();
    expect(claim?.type).toBe("customer.subscription.created");

    // Subscription row was upserted for this user.
    const sub = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub?.userId).toBe(TEST_USER_ID);
    expect(sub?.status).toBe("ACTIVE");
  });

  it("retry of same event.id: short-circuits with 200 and does NOT re-process", async () => {
    const eventId = `${PREFIX}evt_${randomSuffix()}`;
    const subId = `${PREFIX}sub_${randomSuffix()}`;
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent(eventId, subId, TEST_USER_ID));

    const { POST } = await import("../route");
    const res1 = await POST(makeRequest() as never);
    expect(res1.status).toBe(200);

    // Record initial state of the subscription to detect re-processing.
    const sub1 = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub1).not.toBeNull();
    const initialUpdatedAt = sub1!.updatedAt;

    // Second delivery with the SAME event id — the real P2002 is what
    // gates us here, not a mocked throw.
    const res2 = await POST(makeRequest() as never);
    expect(res2.status).toBe(200);
    const body = await res2.json();
    expect(body).toMatchObject({ received: true, duplicate: true });

    // The subscription row must NOT have been touched on the retry.
    const sub2 = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    expect(sub2?.updatedAt.getTime()).toBe(initialUpdatedAt.getTime());
  });

  it("two concurrent deliveries for same event.id: downstream fires exactly once", async () => {
    const eventId = `${PREFIX}evt_${randomSuffix()}`;
    const subId = `${PREFIX}sub_${randomSuffix()}`;
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent(eventId, subId, TEST_USER_ID));

    const { POST } = await import("../route");
    // Race two parallel requests against the real DB. Postgres PK
    // enforces exactly one winner.
    const [res1, res2] = await Promise.all([
      POST(makeRequest() as never),
      POST(makeRequest() as never),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Exactly one is marked duplicate.
    const bodies = await Promise.all([res1.json(), res2.json()]);
    const duplicates = bodies.filter((b) => b.duplicate === true);
    expect(duplicates).toHaveLength(1);

    // Exactly one event row in the ledger.
    const rows = await prisma.stripeWebhookEvent.findMany({ where: { eventId } });
    expect(rows).toHaveLength(1);

    // Exactly one subscription — upsert cannot duplicate rows by design,
    // but asserting it here locks in the end-state contract.
    const subs = await prisma.subscription.findMany({
      where: { stripeSubscriptionId: subId },
    });
    expect(subs).toHaveLength(1);
  });

  it("different event.ids: both process independently", async () => {
    // Subscription.userId is unique, so we use two distinct users so
    // both upserts can land without colliding on the same row.
    const userB = await createTestUser({
      clerkId: `${PREFIX}userB_${randomSuffix()}`,
    });

    const evA = `${PREFIX}evt_A_${randomSuffix()}`;
    const evB = `${PREFIX}evt_B_${randomSuffix()}`;
    const subA = `${PREFIX}subA_${randomSuffix()}`;
    const subB = `${PREFIX}subB_${randomSuffix()}`;

    const { POST } = await import("../route");

    constructEventMock.mockReturnValueOnce(makeSubscriptionCreatedEvent(evA, subA, TEST_USER_ID));
    await POST(makeRequest() as never);

    constructEventMock.mockReturnValueOnce(makeSubscriptionCreatedEvent(evB, subB, userB.id));
    await POST(makeRequest() as never);

    const claims = await prisma.stripeWebhookEvent.findMany({
      where: { eventId: { in: [evA, evB] } },
    });
    expect(claims).toHaveLength(2);

    const subs = await prisma.subscription.findMany({
      where: { stripeSubscriptionId: { in: [subA, subB] } },
    });
    expect(subs).toHaveLength(2);
  });

  it("handler error after claim: rolls back claim so Stripe retry can process", async () => {
    const eventId = `${PREFIX}evt_${randomSuffix()}`;
    // Use a userId that doesn't exist — upsert fails on FK.
    const event = makeSubscriptionCreatedEvent(
      eventId,
      `${PREFIX}sub_${randomSuffix()}`,
      `user_does_not_exist_${randomSuffix()}`
    );
    constructEventMock.mockReturnValue(event);

    const { POST } = await import("../route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(500);

    // Claim was rolled back → row does not exist.
    const claim = await prisma.stripeWebhookEvent.findUnique({ where: { eventId } });
    expect(claim).toBeNull();

    // Sentry.captureException called for the handler failure
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("signature verification failure captures exception to Sentry", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const { POST } = await import("../route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(400);

    // No claim was attempted, so no leftover rows from this test need
    // cleanup here — the prefix sweep in afterEach covers it anyway.
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
