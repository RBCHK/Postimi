import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock logger before importing x-api
vi.mock("@/lib/x-api-logger", () => ({
  logXApiCall: vi.fn(),
}));

import { uploadMediaToX, postTweet } from "../x-api";
import type { XApiCredentials } from "../x-api";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const credentials: XApiCredentials = {
  accessToken: "test-token",
  xUserId: "123",
  xUsername: "testuser",
};

beforeEach(() => {
  mockFetch.mockReset();
});

describe("uploadMediaToX", () => {
  it("performs INIT → APPEND → FINALIZE flow", async () => {
    const imageBuffer = Buffer.alloc(500, "a");

    // INIT response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ media_id_string: "media_123" }),
    });

    // APPEND response (single chunk since < 1MB)
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    // FINALIZE response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ media_id_string: "media_123" }),
    });

    const mediaId = await uploadMediaToX(credentials, imageBuffer, "image/jpeg");

    expect(mediaId).toBe("media_123");
    expect(mockFetch).toHaveBeenCalledTimes(3);

    // Verify INIT call
    const initCall = mockFetch.mock.calls[0];
    expect(initCall[0]).toBe("https://api.x.com/2/media/upload");
    const initBody = JSON.parse(initCall[1].body);
    expect(initBody.command).toBe("INIT");
    expect(initBody.total_bytes).toBe(500);
    expect(initBody.media_type).toBe("image/jpeg");

    // Verify APPEND call uses FormData
    const appendCall = mockFetch.mock.calls[1];
    expect(appendCall[1].body).toBeInstanceOf(FormData);

    // Verify FINALIZE call
    const finalizeCall = mockFetch.mock.calls[2];
    const finalizeBody = JSON.parse(finalizeCall[1].body);
    expect(finalizeBody.command).toBe("FINALIZE");
    expect(finalizeBody.media_id).toBe("media_123");
  });

  it("sends multiple chunks for large images", async () => {
    // 2.5MB buffer → 3 chunks
    const imageBuffer = Buffer.alloc(2.5 * 1024 * 1024, "b");

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ media_id_string: "media_456" }),
    });

    // 3 APPEND calls
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });
    mockFetch.mockResolvedValueOnce({ ok: true, json: async () => ({}) });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ media_id_string: "media_456" }),
    });

    const mediaId = await uploadMediaToX(credentials, imageBuffer, "image/png");

    expect(mediaId).toBe("media_456");
    // INIT + 3 APPEND + FINALIZE = 5 calls
    expect(mockFetch).toHaveBeenCalledTimes(5);
  });

  it("throws on INIT failure", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      text: async () => "Bad request",
    });

    await expect(uploadMediaToX(credentials, Buffer.alloc(100), "image/jpeg")).rejects.toThrow(
      "X media INIT failed (400)"
    );
  });

  it("throws on APPEND failure", async () => {
    vi.useFakeTimers();
    // INIT succeeds, APPEND returns 500 (retryable).
    // fetchWithRetry exhausts its 3 attempts on the APPEND and throws
    // RetryableApiError, which surfaces as the caller's error.
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ media_id_string: "media_789" }),
    });
    const fail500 = () => ({
      ok: false,
      status: 500,
      text: async () => "Server error",
      headers: { get: () => null },
    });
    mockFetch
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500())
      .mockResolvedValueOnce(fail500());

    const pending = uploadMediaToX(credentials, Buffer.alloc(100), "image/jpeg");
    const settled = pending.catch((e) => e);
    await vi.runAllTimersAsync();
    const err = await settled;
    vi.useRealTimers();
    // After 3 retries the terminal error is RetryableApiError with
    // status 500 — the "X media APPEND failed" string no longer
    // applies because retry short-circuits the caller's custom error
    // message. We still verify the failure reaches the caller.
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/500|gave up/);
  });
});

describe("postTweet with media", () => {
  it("includes media_ids in request body when provided", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "tweet_1", text: "Hello" } }),
    });

    await postTweet(credentials, "Hello", {
      mediaIds: ["media_1", "media_2"],
    });

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toBe("Hello");
    expect(body.media).toEqual({ media_ids: ["media_1", "media_2"] });
  });

  it("does not include media field when no mediaIds", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ data: { id: "tweet_2", text: "No media" } }),
    });

    await postTweet(credentials, "No media");

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body.text).toBe("No media");
    expect(body.media).toBeUndefined();
  });
});
