import { describe, it, expect } from "vitest";
import { getAudienceSize, AUDIENCE_SIZE_BOUNDARIES } from "../audience-size";

describe("getAudienceSize — boundary cases", () => {
  it("returns NANO for null/undefined/negative", () => {
    expect(getAudienceSize(null)).toBe("NANO");
    expect(getAudienceSize(undefined)).toBe("NANO");
    expect(getAudienceSize(-1)).toBe("NANO");
    expect(getAudienceSize(0)).toBe("NANO");
  });

  describe("NANO / MICRO boundary (1000)", () => {
    it("999 followers → NANO", () => {
      expect(getAudienceSize(999)).toBe("NANO");
    });
    it("1000 followers → MICRO", () => {
      expect(getAudienceSize(1000)).toBe("MICRO");
    });
    it("1001 followers → MICRO", () => {
      expect(getAudienceSize(1001)).toBe("MICRO");
    });
  });

  describe("MICRO / MID boundary (10 000)", () => {
    it("9999 followers → MICRO", () => {
      expect(getAudienceSize(9_999)).toBe("MICRO");
    });
    it("10000 followers → MID", () => {
      expect(getAudienceSize(10_000)).toBe("MID");
    });
    it("10001 followers → MID", () => {
      expect(getAudienceSize(10_001)).toBe("MID");
    });
  });

  describe("MID / MACRO boundary (100 000)", () => {
    it("99999 followers → MID", () => {
      expect(getAudienceSize(99_999)).toBe("MID");
    });
    it("100000 followers → MACRO", () => {
      expect(getAudienceSize(100_000)).toBe("MACRO");
    });
    it("100001 followers → MACRO", () => {
      expect(getAudienceSize(100_001)).toBe("MACRO");
    });
  });

  describe("representative mid-band values", () => {
    it("500 → NANO", () => expect(getAudienceSize(500)).toBe("NANO"));
    it("5 000 → MICRO", () => expect(getAudienceSize(5_000)).toBe("MICRO"));
    it("50 000 → MID", () => expect(getAudienceSize(50_000)).toBe("MID"));
    it("1 000 000 → MACRO", () => expect(getAudienceSize(1_000_000)).toBe("MACRO"));
  });

  it("exposes boundary constants matching behavior", () => {
    expect(AUDIENCE_SIZE_BOUNDARIES.NANO).toBe(0);
    expect(AUDIENCE_SIZE_BOUNDARIES.MICRO).toBe(1_000);
    expect(AUDIENCE_SIZE_BOUNDARIES.MID).toBe(10_000);
    expect(AUDIENCE_SIZE_BOUNDARIES.MACRO).toBe(100_000);
  });
});
