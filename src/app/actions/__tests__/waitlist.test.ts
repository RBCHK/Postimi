import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────

const prismaMock = {
  waitlistEntry: {
    count: vi.fn(),
    upsert: vi.fn(),
  },
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const headersMock = vi.fn();
vi.mock("next/headers", () => ({
  headers: () => headersMock(),
}));

function makeHeaders(entries: Record<string, string | null>): Headers {
  const h = new Headers();
  for (const [k, v] of Object.entries(entries)) {
    if (v !== null) h.set(k, v);
  }
  return h;
}

const ORIGINAL_SALT = process.env.WAITLIST_IP_SALT;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.WAITLIST_IP_SALT = "test-salt";
  headersMock.mockResolvedValue(
    makeHeaders({ "x-forwarded-for": "1.2.3.4", "user-agent": "test-ua" })
  );
  prismaMock.waitlistEntry.count.mockResolvedValue(0);
  prismaMock.waitlistEntry.upsert.mockResolvedValue({ id: "wl-1" });
});

afterEach(() => {
  if (ORIGINAL_SALT === undefined) delete process.env.WAITLIST_IP_SALT;
  else process.env.WAITLIST_IP_SALT = ORIGINAL_SALT;
});

// ─── Tests ───────────────────────────────────────────────

describe("joinWaitlist", () => {
  it("rejects invalid email with { ok: false, error: 'invalid' }", async () => {
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "not-an-email" });

    expect(result).toEqual({ ok: false, error: "invalid" });
    expect(prismaMock.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("rejects missing email with { ok: false, error: 'invalid' }", async () => {
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({});

    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("rejects email longer than 254 chars", async () => {
    const { joinWaitlist } = await import("../waitlist");
    const longLocal = "a".repeat(250);
    const result = await joinWaitlist({ email: `${longLocal}@example.com` });

    expect(result).toEqual({ ok: false, error: "invalid" });
  });

  it("returns server_error when WAITLIST_IP_SALT is not set", async () => {
    delete process.env.WAITLIST_IP_SALT;
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "user@example.com" });

    expect(result).toEqual({ ok: false, error: "server_error" });
    expect(prismaMock.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("successfully inserts a new entry and returns { ok: true }", async () => {
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({
      email: "User@Example.COM",
      source: "landing_hero",
      locale: "en",
    });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.waitlistEntry.upsert).toHaveBeenCalledTimes(1);

    const args = prismaMock.waitlistEntry.upsert.mock.calls[0][0];
    expect(args.where).toEqual({ email: "user@example.com" });
    expect(args.create.email).toBe("user@example.com");
    expect(args.create.source).toBe("landing_hero");
    expect(args.create.locale).toBe("en");
    expect(args.create.userAgent).toBe("test-ua");
    expect(args.create.ipHash).toMatch(/^[a-f0-9]{64}$/);
    expect(args.update).toEqual({});
  });

  it("is idempotent — repeated call with same email triggers upsert (DB handles dedup)", async () => {
    const { joinWaitlist } = await import("../waitlist");
    await joinWaitlist({ email: "dup@example.com" });
    await joinWaitlist({ email: "dup@example.com" });

    // Both calls pass through to upsert; the {} update clause makes it a no-op on conflict
    expect(prismaMock.waitlistEntry.upsert).toHaveBeenCalledTimes(2);
    expect(prismaMock.waitlistEntry.upsert.mock.calls[0][0].update).toEqual({});
  });

  it("returns rate_limited when IP exceeds RATE_LIMIT_MAX within window", async () => {
    prismaMock.waitlistEntry.count.mockResolvedValueOnce(5);
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "user@example.com" });

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(prismaMock.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("allows insert when count is below rate limit threshold", async () => {
    prismaMock.waitlistEntry.count.mockResolvedValueOnce(4);
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "user@example.com" });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.waitlistEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it("returns server_error when Prisma throws", async () => {
    prismaMock.waitlistEntry.upsert.mockRejectedValueOnce(new Error("connection refused"));
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "user@example.com" });

    expect(result).toEqual({ ok: false, error: "server_error" });
  });

  it("hashes IP with salt — same IP produces same hash", async () => {
    const { joinWaitlist } = await import("../waitlist");
    await joinWaitlist({ email: "a@example.com" });
    await joinWaitlist({ email: "b@example.com" });

    const hash1 = prismaMock.waitlistEntry.upsert.mock.calls[0][0].create.ipHash;
    const hash2 = prismaMock.waitlistEntry.upsert.mock.calls[1][0].create.ipHash;
    expect(hash1).toBe(hash2);
    expect(hash1).not.toContain("1.2.3.4"); // raw IP never stored
  });

  it("uses first IP when x-forwarded-for contains a chain", async () => {
    headersMock.mockResolvedValueOnce(
      makeHeaders({ "x-forwarded-for": "5.6.7.8, 10.0.0.1", "user-agent": "test-ua" })
    );
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "chain@example.com" });

    expect(result).toEqual({ ok: true });
    // Hash is deterministic — different IP → different hash than base case
    const hash = prismaMock.waitlistEntry.upsert.mock.calls[0][0].create.ipHash;
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("truncates user-agent to 500 chars", async () => {
    const longUa = "x".repeat(800);
    headersMock.mockResolvedValueOnce(
      makeHeaders({ "x-forwarded-for": "1.2.3.4", "user-agent": longUa })
    );
    const { joinWaitlist } = await import("../waitlist");
    await joinWaitlist({ email: "ua@example.com" });

    const ua = prismaMock.waitlistEntry.upsert.mock.calls[0][0].create.userAgent;
    expect(ua).toHaveLength(500);
  });

  it("honeypot tripped: reports ok without touching the DB", async () => {
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "bot@example.com", hp: "I am a bot" });

    // Bot should see success to avoid learning the trap exists.
    expect(result).toEqual({ ok: true });
    expect(prismaMock.waitlistEntry.count).not.toHaveBeenCalled();
    expect(prismaMock.waitlistEntry.upsert).not.toHaveBeenCalled();
  });

  it("empty hp string is ignored (legitimate form)", async () => {
    const { joinWaitlist } = await import("../waitlist");
    const result = await joinWaitlist({ email: "real@example.com", hp: "" });

    expect(result).toEqual({ ok: true });
    expect(prismaMock.waitlistEntry.upsert).toHaveBeenCalledTimes(1);
  });

  it("per-email rate limit: 3+ recent inserts for same email → rate_limited", async () => {
    // First count call → IP bucket (0, OK). Second call → email bucket (3, tripped).
    prismaMock.waitlistEntry.count
      .mockResolvedValueOnce(0) // IP bucket
      .mockResolvedValueOnce(3); // email bucket
    const { joinWaitlist } = await import("../waitlist");

    const result = await joinWaitlist({ email: "target@example.com" });

    expect(result).toEqual({ ok: false, error: "rate_limited" });
    expect(prismaMock.waitlistEntry.upsert).not.toHaveBeenCalled();
  });
});
