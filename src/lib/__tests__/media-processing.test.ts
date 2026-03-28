import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  processImage,
  generateThumbnail,
  isAllowedMimeType,
  ALLOWED_MIME_TYPES,
  MAX_FILE_SIZE,
} from "../media-processing";

// Helper: create a test image buffer of given dimensions
async function createTestImage(
  width: number,
  height: number,
  format: "jpeg" | "png" | "webp" = "jpeg"
): Promise<Buffer> {
  return sharp({
    create: { width, height, channels: 3, background: { r: 255, g: 0, b: 0 } },
  })
    .toFormat(format)
    .toBuffer();
}

describe("isAllowedMimeType", () => {
  it("accepts valid mime types", () => {
    for (const type of ALLOWED_MIME_TYPES) {
      expect(isAllowedMimeType(type)).toBe(true);
    }
  });

  it("rejects invalid mime types", () => {
    expect(isAllowedMimeType("image/svg+xml")).toBe(false);
    expect(isAllowedMimeType("application/pdf")).toBe(false);
    expect(isAllowedMimeType("video/mp4")).toBe(false);
    expect(isAllowedMimeType("")).toBe(false);
  });
});

describe("processImage", () => {
  it("returns processed image with correct dimensions for small image", async () => {
    const input = await createTestImage(800, 600);
    const result = await processImage(input, "image/jpeg");

    expect(result.width).toBe(800);
    expect(result.height).toBe(600);
    expect(result.mimeType).toBe("image/jpeg");
    expect(result.buffer.length).toBeGreaterThan(0);
  });

  it("resizes image exceeding max dimension", async () => {
    const input = await createTestImage(5000, 3000);
    const result = await processImage(input, "image/jpeg");

    expect(result.width).toBeLessThanOrEqual(4096);
    expect(result.height).toBeLessThanOrEqual(4096);
    // Aspect ratio preserved
    expect(Math.abs(result.width / result.height - 5000 / 3000)).toBeLessThan(0.02);
  });

  it("preserves PNG format", async () => {
    const input = await createTestImage(100, 100, "png");
    const result = await processImage(input, "image/png");

    expect(result.mimeType).toBe("image/png");
  });

  it("preserves WebP format", async () => {
    const input = await createTestImage(100, 100, "webp");
    const result = await processImage(input, "image/webp");

    expect(result.mimeType).toBe("image/webp");
  });
});

describe("generateThumbnail", () => {
  it("generates JPEG thumbnail with reduced width", async () => {
    const input = await createTestImage(2000, 1000);
    const result = await generateThumbnail(input);

    expect(result.mimeType).toBe("image/jpeg");

    // Verify thumbnail dimensions
    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBeLessThanOrEqual(400);
    expect(meta.format).toBe("jpeg");
  });

  it("does not upscale small images", async () => {
    const input = await createTestImage(200, 150);
    const result = await generateThumbnail(input);

    const meta = await sharp(result.buffer).metadata();
    expect(meta.width).toBe(200);
  });
});

describe("constants", () => {
  it("MAX_FILE_SIZE is 5MB", () => {
    expect(MAX_FILE_SIZE).toBe(5 * 1024 * 1024);
  });
});
