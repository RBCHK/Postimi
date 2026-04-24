import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  postToLinkedIn,
  postToLinkedInWithImage,
  postToLinkedInWithImages,
  uploadImageToLinkedIn,
  type LinkedInApiCredentials,
} from "../linkedin-api";

// Contract tests for src/lib/linkedin-api.ts.
//
// LinkedIn's REST API returns the new post identifier in the
// `x-restli-id` header (NOT the body), and the image upload is a
// two-step flow (initializeUpload → PUT binary). These tests lock
// that shape so a header-name change or body-field rename upstream
// fails loudly before a silent scheduled-post regression.

const creds: LinkedInApiCredentials = {
  accessToken: "test-token",
  linkedinUserId: "li-user-abc",
  linkedinName: "Test User",
};

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

type MockInit = { status?: number; text?: string; headers?: Record<string, string> };

function response(body: unknown, init: MockInit = {}) {
  const status = init.status ?? 200;
  const headers = new Map(Object.entries(init.headers ?? {}).map(([k, v]) => [k.toLowerCase(), v]));
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 || status === 201 ? "OK" : "Error",
    text: async () => init.text ?? JSON.stringify(body),
    json: async () => body,
    headers: {
      get: (name: string) => headers.get(name.toLowerCase()) ?? null,
    },
  };
}

describe("postToLinkedIn", () => {
  it("returns the post URN from the x-restli-id header", async () => {
    mockFetch.mockResolvedValueOnce(
      response({}, { status: 201, headers: { "x-restli-id": "urn:li:share:7200000000000000000" } })
    );

    const result = await postToLinkedIn(creds, "hello LinkedIn");
    expect(result.postUrn).toBe("urn:li:share:7200000000000000000");
  });

  it("sends the author URN, lifecycleState, visibility, and commentary in the body", async () => {
    mockFetch.mockResolvedValueOnce(
      response({}, { status: 201, headers: { "x-restli-id": "urn:li:share:1" } })
    );

    await postToLinkedIn(creds, "lock body shape");

    const init = mockFetch.mock.calls[0]![1] as { body?: string; headers?: Record<string, string> };
    const body = JSON.parse(init.body ?? "{}");
    expect(body).toEqual({
      author: "urn:li:person:li-user-abc",
      lifecycleState: "PUBLISHED",
      visibility: "PUBLIC",
      commentary: "lock body shape",
      distribution: { feedDistribution: "MAIN_FEED" },
    });
    // LinkedIn-Version and X-Restli-Protocol-Version headers must be present —
    // posts fail without them.
    expect(init.headers).toMatchObject({
      "LinkedIn-Version": expect.any(String),
      "X-Restli-Protocol-Version": "2.0.0",
    });
  });

  it("returns empty string when x-restli-id header is absent", async () => {
    // Defensive: never throw on a missing header, but the caller can
    // detect the empty string and surface the failure.
    mockFetch.mockResolvedValueOnce(response({}, { status: 201 }));
    const result = await postToLinkedIn(creds, "text");
    expect(result.postUrn).toBe("");
  });

  it("throws on non-2xx with the status code in the error message", async () => {
    mockFetch.mockResolvedValueOnce(response({}, { status: 400, text: "invalid author" }));
    await expect(postToLinkedIn(creds, "text")).rejects.toThrow(/LinkedIn post failed 400/);
  });
});

describe("uploadImageToLinkedIn", () => {
  it("runs initializeUpload → PUT binary → returns the image URN", async () => {
    const imageUrn = "urn:li:image:D4D22AQG_abc";
    const uploadUrl = "https://li-upload.example/ingest/img-123";
    const buf = Buffer.from(new Uint8Array(32));

    mockFetch
      .mockResolvedValueOnce(response({ value: { uploadUrl, image: imageUrn } }))
      .mockResolvedValueOnce(response({}, { status: 201 }));

    const result = await uploadImageToLinkedIn(creds, buf, "image/jpeg");
    expect(result).toBe(imageUrn);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    // First call: initializeUpload body must carry the owner URN exactly.
    const initInit = mockFetch.mock.calls[0]![1] as { body?: string };
    const initBody = JSON.parse(initInit.body ?? "{}");
    expect(initBody).toEqual({
      initializeUploadRequest: { owner: "urn:li:person:li-user-abc" },
    });

    // Second call: binary PUT to the returned uploadUrl with the
    // caller-supplied mime type.
    const [putUrl, putInit] = mockFetch.mock.calls[1]! as [
      string,
      { method?: string; headers?: Record<string, string> },
    ];
    expect(putUrl).toBe(uploadUrl);
    expect(putInit.method).toBe("PUT");
    expect(putInit.headers).toMatchObject({ "Content-Type": "image/jpeg" });
  });

  it("throws when initializeUpload fails before any binary bytes are sent", async () => {
    const buf = Buffer.from(new Uint8Array(4));
    mockFetch.mockResolvedValueOnce(response({}, { status: 400, text: "bad owner" }));

    await expect(uploadImageToLinkedIn(creds, buf, "image/png")).rejects.toThrow(
      /image upload init failed 400/
    );
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});

describe("postToLinkedInWithImage", () => {
  it("builds the content.media block with title and image URN", async () => {
    mockFetch.mockResolvedValueOnce(
      response({}, { status: 201, headers: { "x-restli-id": "urn:li:share:2" } })
    );

    const imageUrn = "urn:li:image:AQG_img";
    await postToLinkedInWithImage(creds, "image caption", imageUrn);

    const init = mockFetch.mock.calls[0]![1] as { body?: string };
    const body = JSON.parse(init.body ?? "{}");
    expect(body.content).toEqual({ media: { title: "Image", id: imageUrn } });
    expect(body.commentary).toBe("image caption");
  });
});

describe("postToLinkedInWithImages", () => {
  it("builds the content.multiImage.images array preserving URN order", async () => {
    mockFetch.mockResolvedValueOnce(
      response({}, { status: 201, headers: { "x-restli-id": "urn:li:share:3" } })
    );

    const urns = ["urn:li:image:A", "urn:li:image:B", "urn:li:image:C"];
    await postToLinkedInWithImages(creds, "multi caption", urns);

    const init = mockFetch.mock.calls[0]![1] as { body?: string };
    const body = JSON.parse(init.body ?? "{}");
    expect(body.content).toEqual({
      multiImage: {
        images: [{ id: "urn:li:image:A" }, { id: "urn:li:image:B" }, { id: "urn:li:image:C" }],
      },
    });
  });
});
