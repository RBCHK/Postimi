import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { SubscriptionStatus } from "@/generated/prisma";

// ─── Mocks ───────────────────────────────────────────────

const prismaMock = {
  subscription: {
    upsert: vi.fn(),
    updateMany: vi.fn(),
  },
  stripeWebhookEvent: {
    create: vi.fn(),
    delete: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

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

function makeRequest(body: string, signature = "sig_test"): Request {
  return new Request("https://app.postimi.com/api/webhooks/stripe", {
    method: "POST",
    body,
    headers: { "stripe-signature": signature },
  });
}

function makeSubscriptionEvent(type: string, sub: Record<string, unknown>, id = "evt_test") {
  return {
    id,
    type,
    data: { object: sub },
  };
}

// ─── Tests ───────────────────────────────────────────────

describe("POST /api/webhooks/stripe", () => {
  it("returns 400 when signature is missing", async () => {
    const { POST } = await import("../route");
    const req = new Request("https://app.postimi.com/api/webhooks/stripe", {
      method: "POST",
      body: "{}",
    });
    // NextRequest has different interface; use as-is for test
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

  it("handles customer.subscription.created — upserts subscription", async () => {
    const sub = {
      id: "sub_stripe_1",
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
    };

    constructEventMock.mockReturnValue(makeSubscriptionEvent("customer.subscription.created", sub));

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_stripe_1" },
      create: expect.objectContaining({
        userId: "user-1",
        stripeCustomerId: "cus_1",
        stripeSubscriptionId: "sub_stripe_1",
        stripePriceId: "price_1",
        status: SubscriptionStatus.ACTIVE,
        cancelAtPeriodEnd: false,
      }),
      update: expect.objectContaining({
        stripePriceId: "price_1",
        status: SubscriptionStatus.ACTIVE,
      }),
    });
  });

  it("handles customer.subscription.updated — upserts with new status", async () => {
    const sub = {
      id: "sub_stripe_1",
      status: "past_due",
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
      cancel_at_period_end: true,
      canceled_at: Math.floor(Date.now() / 1000),
    };

    constructEventMock.mockReturnValue(makeSubscriptionEvent("customer.subscription.updated", sub));

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    expect(prismaMock.subscription.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        create: expect.objectContaining({
          status: SubscriptionStatus.PAST_DUE,
          cancelAtPeriodEnd: true,
        }),
      })
    );
  });

  it("handles customer.subscription.deleted — sets status to CANCELED", async () => {
    const sub = {
      id: "sub_stripe_1",
      status: "canceled",
      customer: "cus_1",
      metadata: { userId: "user-1" },
    };

    constructEventMock.mockReturnValue(makeSubscriptionEvent("customer.subscription.deleted", sub));

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    expect(prismaMock.subscription.updateMany).toHaveBeenCalledWith({
      where: { stripeSubscriptionId: "sub_stripe_1" },
      data: {
        status: SubscriptionStatus.CANCELED,
        canceledAt: expect.any(Date),
      },
    });
  });

  it("handles unknown event type gracefully", async () => {
    constructEventMock.mockReturnValue({
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
    const sub = {
      id: "sub_stripe_1",
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
    };

    constructEventMock.mockReturnValue(makeSubscriptionEvent("customer.subscription.created", sub));

    // First claim succeeds, second raises P2002 (already-processed).
    const uniqueErr = new Error("Unique constraint failed");
    Object.assign(uniqueErr, { code: "P2002" });
    prismaMock.stripeWebhookEvent.create
      .mockResolvedValueOnce({ eventId: "evt_test" })
      .mockRejectedValueOnce(uniqueErr);

    const { POST } = await import("../route");
    await POST(makeRequest("{}") as never);
    await POST(makeRequest("{}") as never);

    // Downstream side-effect fires exactly once — retry is a no-op.
    expect(prismaMock.subscription.upsert).toHaveBeenCalledTimes(1);
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
    const sub = {
      id: "sub_stripe_orphan",
      status: "active",
      customer: "cus_1",
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

    constructEventMock.mockReturnValue(makeSubscriptionEvent("customer.subscription.created", sub));

    const { POST } = await import("../route");
    const res = await POST(makeRequest("{}") as never);
    expect(res.status).toBe(200);

    // Should NOT attempt to upsert — no userId
    expect(prismaMock.subscription.upsert).not.toHaveBeenCalled();
  });
});
