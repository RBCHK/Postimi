/**
 * Stripe webhook idempotency tests.
 *
 * Stripe retries any delivery that returns 5xx or times out, which means
 * a single subscription.created event can hit our handler many times.
 * Without dedup we'd re-grant the subscription on every retry. These
 * tests lock in:
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

// ─── Mocks ───────────────────────────────────────────────

const prismaMock = vi.hoisted(() => ({
  subscription: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  stripeWebhookEvent: {
    create: vi.fn(),
    delete: vi.fn(),
  },
}));

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

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

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";
  prismaMock.subscription.upsert.mockResolvedValue({ id: "sub-1" });
  prismaMock.subscription.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.stripeWebhookEvent.create.mockResolvedValue({ eventId: "evt_1" });
  prismaMock.stripeWebhookEvent.delete.mockResolvedValue({ eventId: "evt_1" });
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

function makeRequest(signature = "sig_test"): Request {
  return new Request("https://app.postimi.com/api/webhooks/stripe", {
    method: "POST",
    body: "{}",
    headers: { "stripe-signature": signature },
  });
}

function makeSubscriptionCreatedEvent(eventId = "evt_1", subId = "sub_stripe_1") {
  return {
    id: eventId,
    type: "customer.subscription.created",
    data: {
      object: {
        id: subId,
        status: "active",
        customer: "cus_1",
        metadata: { userId: "user-1" },
        items: {
          data: [
            {
              price: { id: "price_1" },
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

/**
 * Builds a pseudo-Prisma unique-constraint error. Only the `code` field
 * is inspected by the handler, so a plain object is sufficient — we
 * don't need to reach into the real Prisma error class.
 */
function uniqueViolation(target = "PRIMARY"): unknown {
  const err = new Error("Unique constraint failed");
  Object.assign(err, { code: "P2002", meta: { target: [target] } });
  return err;
}

// ─── Tests ───────────────────────────────────────────────

describe("POST /api/webhooks/stripe — idempotency", () => {
  it("first delivery: records event + processes downstream", async () => {
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent());

    const { POST } = await import("../route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ received: true });
    expect(data.duplicate).toBeUndefined();

    // Event recorded BEFORE downstream processing
    expect(prismaMock.stripeWebhookEvent.create).toHaveBeenCalledWith({
      data: { eventId: "evt_1", type: "customer.subscription.created" },
    });
    // Downstream grant fired exactly once
    expect(prismaMock.subscription.upsert).toHaveBeenCalledTimes(1);
  });

  it("retry of same event.id: short-circuits with 200 and does NOT re-process", async () => {
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent());
    // Second delivery: claim fails with unique-violation
    prismaMock.stripeWebhookEvent.create.mockRejectedValueOnce(uniqueViolation("eventId"));

    const { POST } = await import("../route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data).toMatchObject({ received: true, duplicate: true });

    // Downstream grant MUST NOT fire
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
  });

  it("two concurrent deliveries for same event.id: downstream fires exactly once", async () => {
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent());

    // Simulate the race: the first claim succeeds, the second observes
    // the committed row and throws P2002. Postgres guarantees exactly
    // this ordering under a PK insert race.
    prismaMock.stripeWebhookEvent.create
      .mockResolvedValueOnce({ eventId: "evt_1" })
      .mockRejectedValueOnce(uniqueViolation("eventId"));

    const { POST } = await import("../route");
    const [res1, res2] = await Promise.all([
      POST(makeRequest() as never),
      POST(makeRequest() as never),
    ]);

    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    // Exactly one of the two responses is marked duplicate.
    const bodies = await Promise.all([res1.json(), res2.json()]);
    const duplicates = bodies.filter((b) => b.duplicate === true);
    expect(duplicates).toHaveLength(1);

    // And the downstream grant fires exactly once across both calls.
    expect(prismaMock.subscription.upsert).toHaveBeenCalledTimes(1);
  });

  it("different event.ids: both process independently", async () => {
    const { POST } = await import("../route");

    constructEventMock.mockReturnValueOnce(makeSubscriptionCreatedEvent("evt_A", "sub_A"));
    await POST(makeRequest() as never);

    constructEventMock.mockReturnValueOnce(makeSubscriptionCreatedEvent("evt_B", "sub_B"));
    await POST(makeRequest() as never);

    expect(prismaMock.stripeWebhookEvent.create).toHaveBeenCalledTimes(2);
    expect(prismaMock.subscription.upsert).toHaveBeenCalledTimes(2);
  });

  it("handler error after claim: rolls back claim so Stripe retry can process", async () => {
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent());
    prismaMock.subscription.upsert.mockRejectedValueOnce(new Error("db down"));

    const { POST } = await import("../route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(500);
    // Claim row deleted → next delivery will re-claim and retry
    expect(prismaMock.stripeWebhookEvent.delete).toHaveBeenCalledWith({
      where: { eventId: "evt_1" },
    });

    // Sentry.captureException called for the handler failure
    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });

  it("claim insert fails with non-P2002 error: 500 without touching downstream", async () => {
    constructEventMock.mockReturnValue(makeSubscriptionCreatedEvent());
    prismaMock.stripeWebhookEvent.create.mockRejectedValueOnce(new Error("connection refused"));

    const { POST } = await import("../route");
    const res = await POST(makeRequest() as never);

    expect(res.status).toBe(500);
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();

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
    // Claim should NOT run if signature is invalid
    expect(prismaMock.stripeWebhookEvent.create).not.toHaveBeenCalled();

    const Sentry = await import("@sentry/nextjs");
    expect(Sentry.captureException).toHaveBeenCalled();
  });
});
