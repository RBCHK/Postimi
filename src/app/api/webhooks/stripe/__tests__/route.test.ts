import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubscriptionStatus } from "@/generated/prisma";
import { prisma } from "@/lib/prisma";
import { cleanupByPrefix, createTestUser, randomSuffix } from "@/test/real-prisma";

// ─── Mocks (non-DB) ──────────────────────────────────────

const constructEventMock = vi.fn();
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
const PREFIX = `stripe_route_${randomSuffix()}_`;
let TEST_USER_ID: string;

beforeEach(async () => {
  vi.resetModules();
  vi.clearAllMocks();
  constructEventMock.mockReset();
  process.env.STRIPE_WEBHOOK_SECRET = "whsec_test";

  const clerkId = `${PREFIX}user_${randomSuffix()}`;
  const user = await createTestUser({ clerkId });
  TEST_USER_ID = user.id;
});

afterEach(async () => {
  if (ORIGINAL_SECRET === undefined) delete process.env.STRIPE_WEBHOOK_SECRET;
  else process.env.STRIPE_WEBHOOK_SECRET = ORIGINAL_SECRET;

  await cleanupByPrefix(PREFIX, {
    eventId: true,
    stripeSubscriptionId: true,
    clerkId: true,
  });
});

function makeRequest(body: string, signature = "sig_test"): Request {
  return new Request("https://app.postimi.com/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  });
}

function makeSubscriptionEvent(type: string, sub: Record<string, unknown>, id: string) {
  return {
    id,
    type,
    data: { object: sub },
  };
}

describe("POST /api/webhooks/stripe — behavior (real DB)", () => {
  it("returns 400 when signature is missing", async () => {
    const { POST } = await import("../route");
    const req = new Request("https://app.postimi.com/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });
    const res = await POST(req as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("missing_signature");
  });

  it("returns 400 when signature verification fails", async () => {
    constructEventMock.mockImplementation(() => {
      throw new Error("Invalid signature");
    });

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(data.error).toBe("invalid_signature");
  });

  it("customer.subscription.created: creates Subscription row in DB with correct fields", async () => {
    const subId = `${PREFIX}sub_${randomSuffix()}`;
    const custId = `${PREFIX}cus_${randomSuffix()}`;
    const sub = {
      id: subId,
      status: "active",
      customer: custId,
      metadata: { userId: TEST_USER_ID },
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
    };

    constructEventMock.mockReturnValue(
      makeSubscriptionEvent("customer.subscription.created", sub, `${PREFIX}evt_${randomSuffix()}`)
    );

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    const saved = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    expect(saved).toMatchObject({
      userId: TEST_USER_ID,
      stripeCustomerId: custId,
      stripeSubscriptionId: subId,
      stripePriceId: "price_1",
      status: SubscriptionStatus.ACTIVE,
      cancelAtPeriodEnd: false,
    });
  });

  it("customer.subscription.updated: updates existing Subscription in place", async () => {
    const subId = `${PREFIX}sub_${randomSuffix()}`;
    const custId = `${PREFIX}cus_${randomSuffix()}`;

    // Seed initial subscription
    await prisma.subscription.create({
      data: {
        userId: TEST_USER_ID,
        stripeCustomerId: custId,
        stripeSubscriptionId: subId,
        stripePriceId: "price_1",
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(Date.now() - 86400_000),
        currentPeriodEnd: new Date(Date.now() + 86400_000 * 30),
        cancelAtPeriodEnd: false,
      },
    });

    const sub = {
      id: subId,
      status: "past_due",
      customer: custId,
      metadata: { userId: TEST_USER_ID },
      items: {
        data: [
          {
            price: { id: "price_1" },
            current_period_start: Math.floor(Date.now() / 1000),
            current_period_end: Math.floor(Date.now() / 1000) + 2592000,
          },
        ],
      },
      cancel_at_period_end: true,
      canceled_at: Math.floor(Date.now() / 1000),
    };

    constructEventMock.mockReturnValue(
      makeSubscriptionEvent("customer.subscription.updated", sub, `${PREFIX}evt_${randomSuffix()}`)
    );

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    const saved = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    expect(saved?.status).toBe(SubscriptionStatus.PAST_DUE);
    expect(saved?.cancelAtPeriodEnd).toBe(true);
  });

  it("customer.subscription.deleted: marks CANCELED in DB", async () => {
    const subId = `${PREFIX}sub_${randomSuffix()}`;
    const custId = `${PREFIX}cus_${randomSuffix()}`;

    await prisma.subscription.create({
      data: {
        userId: TEST_USER_ID,
        stripeCustomerId: custId,
        stripeSubscriptionId: subId,
        stripePriceId: "price_1",
        status: SubscriptionStatus.ACTIVE,
        currentPeriodStart: new Date(Date.now() - 86400_000),
        currentPeriodEnd: new Date(Date.now() + 86400_000 * 30),
        cancelAtPeriodEnd: false,
      },
    });

    const sub = {
      id: subId,
      status: "canceled",
      customer: custId,
      metadata: { userId: TEST_USER_ID },
    };

    constructEventMock.mockReturnValue(
      makeSubscriptionEvent("customer.subscription.deleted", sub, `${PREFIX}evt_${randomSuffix()}`)
    );

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    const saved = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    expect(saved?.status).toBe(SubscriptionStatus.CANCELED);
    expect(saved?.canceledAt).toBeInstanceOf(Date);
  });

  it("handles unknown event type gracefully", async () => {
    constructEventMock.mockReturnValue({
      id: `${PREFIX}evt_${randomSuffix()}`,
      type: "some.unknown.event",
      data: { object: {} },
    });

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.received).toBe(true);
  });

  it("second delivery with same event.id short-circuits (idempotency)", async () => {
    const eventId = `${PREFIX}evt_${randomSuffix()}`;
    const subId = `${PREFIX}sub_${randomSuffix()}`;
    const sub = {
      id: subId,
      status: "active",
      customer: `${PREFIX}cus_${randomSuffix()}`,
      metadata: { userId: TEST_USER_ID },
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
    };

    constructEventMock.mockReturnValue(
      makeSubscriptionEvent("customer.subscription.created", sub, eventId)
    );

    const { POST } = await import("../route");
    await POST(makeRequest("{}") as never);
    const before = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    const initialUpdatedAt = before!.updatedAt.getTime();

    // Second delivery — real DB P2002 trips the idempotency gate.
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.duplicate).toBe(true);

    const after = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    // No re-write: updatedAt is unchanged.
    expect(after!.updatedAt.getTime()).toBe(initialUpdatedAt);
  });

  it("returns 500 when STRIPE_WEBHOOK_SECRET is not set", async () => {
    delete process.env.STRIPE_WEBHOOK_SECRET;

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(500);
    const data = await res.json();
    expect(data.error).toBe("webhook_not_configured");
  });

  it("skips subscription without userId in metadata", async () => {
    const subId = `${PREFIX}sub_orphan_${randomSuffix()}`;
    const sub = {
      id: subId,
      status: "active",
      customer: `${PREFIX}cus_${randomSuffix()}`,
      metadata: {}, // no userId
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
    };

    constructEventMock.mockReturnValue(
      makeSubscriptionEvent("customer.subscription.created", sub, `${PREFIX}evt_${randomSuffix()}`)
    );

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    // No subscription row was created.
    const saved = await prisma.subscription.findUnique({
      where: { stripeSubscriptionId: subId },
    });
    expect(saved).toBeNull();
  });
});
