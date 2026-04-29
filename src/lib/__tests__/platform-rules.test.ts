import { describe, it, expect } from "vitest";
import { PLATFORM_RULES, getRules, validatePostForPlatform } from "@/lib/platform/rules";
import { PLATFORMS } from "@/lib/types";

// Static-rule contract tests. The constants in `PLATFORM_RULES` are
// the single source of truth used by the composer (UX validation),
// the auto-publish cron (defense-in-depth), and any future per-
// platform composer features. Anchor-test stable values so a copy-
// paste-rename mistake on one row trips a known failure rather than
// hitting a real platform's API with a doomed payload.

describe("PLATFORM_RULES", () => {
  it("is exhaustive over the Platform enum", () => {
    for (const platform of PLATFORMS) {
      expect(PLATFORM_RULES).toHaveProperty(platform);
    }
    expect(Object.keys(PLATFORM_RULES).sort()).toEqual([...PLATFORMS].sort());
  });

  it("X has the well-known 280-char text limit", () => {
    expect(PLATFORM_RULES.X.textLimit).toBe(280);
  });

  it("LinkedIn has the well-known 3000-char text limit", () => {
    expect(PLATFORM_RULES.LINKEDIN.textLimit).toBe(3000);
  });

  it("Threads has the well-known 500-char text limit", () => {
    expect(PLATFORM_RULES.THREADS.textLimit).toBe(500);
  });

  it("media counts are sane (>=1 photo, >=1 video, max >= photo and video)", () => {
    for (const platform of PLATFORMS) {
      const m = PLATFORM_RULES[platform].mediaCount;
      expect(m.photo).toBeGreaterThanOrEqual(1);
      expect(m.video).toBeGreaterThanOrEqual(1);
      expect(m.max).toBeGreaterThanOrEqual(m.photo);
      expect(m.max).toBeGreaterThanOrEqual(m.video);
    }
  });

  it("file-size limits are positive integers", () => {
    for (const platform of PLATFORMS) {
      const f = PLATFORM_RULES[platform].maxFileSizeBytes;
      expect(f.photo).toBeGreaterThan(0);
      expect(f.video).toBeGreaterThan(0);
      expect(Number.isInteger(f.photo)).toBe(true);
      expect(Number.isInteger(f.video)).toBe(true);
    }
  });
});

describe("getRules", () => {
  it("returns the same object as the lookup", () => {
    expect(getRules("X")).toBe(PLATFORM_RULES.X);
    expect(getRules("LINKEDIN")).toBe(PLATFORM_RULES.LINKEDIN);
    expect(getRules("THREADS")).toBe(PLATFORM_RULES.THREADS);
  });
});

describe("validatePostForPlatform", () => {
  it("returns null when content fits the platform limit", () => {
    expect(validatePostForPlatform("X", { content: "hi" })).toBeNull();
    expect(validatePostForPlatform("LINKEDIN", { content: "x".repeat(2000) })).toBeNull();
    expect(validatePostForPlatform("THREADS", { content: "x".repeat(400) })).toBeNull();
  });

  it("rejects content exceeding the platform's textLimit", () => {
    expect(validatePostForPlatform("X", { content: "x".repeat(281) })).toMatch(/X limit \(280/);
    expect(validatePostForPlatform("LINKEDIN", { content: "x".repeat(3001) })).toMatch(
      /LINKEDIN limit \(3000/
    );
    expect(validatePostForPlatform("THREADS", { content: "x".repeat(501) })).toMatch(
      /THREADS limit \(500/
    );
  });

  it("accepts content exactly at the boundary", () => {
    expect(validatePostForPlatform("X", { content: "x".repeat(280) })).toBeNull();
    expect(validatePostForPlatform("LINKEDIN", { content: "x".repeat(3000) })).toBeNull();
    expect(validatePostForPlatform("THREADS", { content: "x".repeat(500) })).toBeNull();
  });

  it("rejects mediaCount over the platform's max", () => {
    expect(validatePostForPlatform("X", { content: "ok", mediaCount: 5 })).toMatch(
      /Too many media items for X/
    );
    expect(validatePostForPlatform("LINKEDIN", { content: "ok", mediaCount: 10 })).toMatch(
      /Too many media items for LINKEDIN/
    );
    expect(validatePostForPlatform("THREADS", { content: "ok", mediaCount: 21 })).toMatch(
      /Too many media items for THREADS/
    );
  });

  it("returns null when mediaCount is undefined (not all callers attach media)", () => {
    expect(validatePostForPlatform("X", { content: "ok" })).toBeNull();
  });

  it("returns null when mediaCount is exactly at the max", () => {
    expect(validatePostForPlatform("X", { content: "ok", mediaCount: 4 })).toBeNull();
  });
});
