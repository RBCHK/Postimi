import { describe, it, expect } from "vitest";
import {
  PlatformMetadataSchema,
  parsePlatformMetadata,
  XPostMetadataSchema,
  LinkedInPostMetadataSchema,
  ThreadsPostMetadataSchema,
} from "../types";

describe("PlatformMetadataSchema — discriminated union", () => {
  it("accepts valid X metadata", () => {
    const parsed = parsePlatformMetadata({
      platform: "X",
      postType: "REPLY",
      inReplyToId: "123",
      conversationId: "abc",
    });
    expect(parsed.platform).toBe("X");
  });

  it("accepts valid LinkedIn metadata", () => {
    const parsed = parsePlatformMetadata({
      platform: "LINKEDIN",
      postUrl: "https://linkedin.com/feed/update/urn:li:activity:123",
      postType: "POST",
    });
    expect(parsed.platform).toBe("LINKEDIN");
  });

  it("accepts valid Threads metadata", () => {
    const parsed = parsePlatformMetadata({
      platform: "THREADS",
      mediaType: "TEXT_POST",
    });
    expect(parsed.platform).toBe("THREADS");
  });

  it("rejects X shape under LINKEDIN discriminator — no cross-platform", () => {
    // X has `postType: POST|REPLY|QUOTE` but LinkedIn's postType is
    // `POST|REPOST|ARTICLE`. Even if we stuff an X-shaped postType into a
    // LINKEDIN row it must fail because `postUrl` is required.
    const result = PlatformMetadataSchema.safeParse({
      platform: "LINKEDIN",
      postType: "REPLY", // not a valid LinkedIn postType, and postUrl missing
    });
    expect(result.success).toBe(false);
  });

  it("rejects Threads metadata under X discriminator", () => {
    const result = PlatformMetadataSchema.safeParse({
      platform: "X",
      mediaType: "TEXT_POST", // Threads-only field, no valid postType
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown platform discriminator", () => {
    const result = PlatformMetadataSchema.safeParse({
      platform: "TIKTOK",
      foo: "bar",
    });
    expect(result.success).toBe(false);
  });

  it("rejects missing discriminator", () => {
    const result = PlatformMetadataSchema.safeParse({
      postType: "POST",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid LinkedIn postUrl", () => {
    const result = LinkedInPostMetadataSchema.safeParse({
      platform: "LINKEDIN",
      postUrl: "not-a-url",
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid X postType", () => {
    const result = XPostMetadataSchema.safeParse({
      platform: "X",
      postType: "THREAD", // not in enum
    });
    expect(result.success).toBe(false);
  });

  it("rejects invalid Threads mediaType", () => {
    const result = ThreadsPostMetadataSchema.safeParse({
      platform: "THREADS",
      mediaType: "GIF", // not in enum
    });
    expect(result.success).toBe(false);
  });

  it("parsePlatformMetadata throws on invalid input", () => {
    expect(() => parsePlatformMetadata({ platform: "X" })).toThrow();
    expect(() => parsePlatformMetadata({})).toThrow();
    expect(() => parsePlatformMetadata(null)).toThrow();
  });
});
