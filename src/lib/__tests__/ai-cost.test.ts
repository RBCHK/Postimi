import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { calculateCost } from "../ai-cost";

vi.mock("@sentry/nextjs", () => ({
  captureException: vi.fn(),
  captureMessage: vi.fn(),
}));

describe("calculateCost", () => {
  it("calculates opus pricing (in=$15/M, out=$75/M)", () => {
    // 1M in + 1M out = 15 + 75 = 90
    expect(calculateCost("claude-opus-4-6", 1_000_000, 1_000_000)).toBeCloseTo(90, 5);
    expect(calculateCost("claude-opus-4-6", 1000, 0)).toBeCloseTo(0.015, 5);
  });

  it("calculates sonnet pricing (in=$3/M, out=$15/M)", () => {
    expect(calculateCost("claude-sonnet-4-6", 1_000_000, 1_000_000)).toBeCloseTo(18, 5);
  });

  it("calculates haiku pricing (in=$0.8/M, out=$4/M)", () => {
    expect(calculateCost("claude-haiku-4-5-20251001", 1_000_000, 1_000_000)).toBeCloseTo(4.8, 5);
  });

  it("returns 0 for zero tokens", () => {
    expect(calculateCost("claude-sonnet-4-6", 0, 0)).toBe(0);
  });

  it("falls back to opus pricing for unknown models and warns", () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const cost = calculateCost("claude-future-99", 1_000_000, 1_000_000);
    expect(cost).toBeCloseTo(90, 5);
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining("unknown model"));
    warnSpy.mockRestore();
  });

  it("reports unknown models to Sentry (billing safety)", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const Sentry = await import("@sentry/nextjs");

    calculateCost("claude-brand-new", 1000, 1000);

    expect(Sentry.captureMessage).toHaveBeenCalledWith(
      expect.stringContaining("unknown model"),
      expect.objectContaining({
        level: "warning",
        tags: expect.objectContaining({ area: "ai-cost", model: "claude-brand-new" }),
      })
    );
    warnSpy.mockRestore();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
  beforeEach(() => {
    vi.clearAllMocks();
  });
});
