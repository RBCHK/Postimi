import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// route.test.ts mocks `svix` at module level — necessary to exercise the
// happy path without a real signed payload. This complementary file does
// the opposite: imports the real svix library and sends a request with a
// deliberately-invalid signature. If a regression ever replaces the
// svix.verify() call with something weaker, the route stops rejecting
// bad signatures and this test will catch it.
//
// Only svix is real here. Prisma + Sentry + next/headers are stubbed —
// the request never reaches the user-sync branch because verification
// fails first.

const prismaMock = vi.hoisted(() => ({
  user: { upsert: vi.fn(), delete: vi.fn() },
  waitlistEntry: { updateMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

const headersMock = vi.hoisted(() => vi.fn());
vi.mock("next/headers", () => ({ headers: headersMock }));

// NOTE: no vi.mock("svix") — we want the real library so the actual
// signature verifier runs.

const ORIGINAL_SECRET = process.env.CLERK_WEBHOOK_SECRET;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.CLERK_WEBHOOK_SECRET = "whsec_aGVsbG93b3JsZGhlbGxvd29ybGRoZWxsb3dvcmxk";
  // Svix headers must be present so the code proceeds to verify() — that
  // is where the real library rejects the forged signature.
  headersMock.mockImplementation(
    async () =>
      new Map([
        ["svix-id", "msg_forged"],
        ["svix-timestamp", String(Math.floor(Date.now() / 1000))],
        // Deliberately bogus signature bytes. Real svix.verify() will
        // reject with `WebhookVerificationError` (or similar), which the
        // route catches and returns as 400.
        ["svix-signature", "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA="],
      ])
  );
});

afterEach(() => {
  if (ORIGINAL_SECRET === undefined) delete process.env.CLERK_WEBHOOK_SECRET;
  else process.env.CLERK_WEBHOOK_SECRET = ORIGINAL_SECRET;
});

function makeReq(payload: unknown): Request {
  return new Request("https://app.postimi.com/api/webhooks/clerk", {
    method: "POST",
    body: JSON.stringify(payload),
    headers: {
      "svix-id": "msg_forged",
      "svix-timestamp": String(Math.floor(Date.now() / 1000)),
      "svix-signature": "v1,AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=",
    },
  });
}

describe("POST /api/webhooks/clerk — real svix rejects forged signatures", () => {
  it("returns 400 when signature does not match CLERK_WEBHOOK_SECRET", async () => {
    // An attacker who knows the endpoint shape but not the secret sends
    // a well-formed body with bogus signature bytes. Real svix.verify()
    // must throw; the route catches and returns 400.
    const { POST } = await import("../route");
    const res = await POST(
      makeReq({
        type: "user.created",
        data: { id: "user_forged", email_addresses: [{ email_address: "a@b" }] },
      })
    );

    expect(res.status).toBe(400);
    // Critical: rejected before any DB side-effect — attacker must not
    // be able to trigger user.created on an arbitrary Clerk id.
    expect(prismaMock.user.upsert).not.toHaveBeenCalled();
    expect(prismaMock.waitlistEntry.updateMany).not.toHaveBeenCalled();
  });
});
