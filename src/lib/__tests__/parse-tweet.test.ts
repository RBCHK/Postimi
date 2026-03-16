import { describe, it, expect, vi, beforeEach } from "vitest";
import { fetchTweetFromText, fetchTweetText } from "../parse-tweet";

// Mock global fetch
const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

beforeEach(() => {
  mockFetch.mockReset();
});

describe("fetchTweetText", () => {
  it("returns tweet text on success", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        html: '<p>Hello world <a href="#">link</a></p>',
      }),
    });

    const result = await fetchTweetText("https://x.com/user/status/123");
    expect(result).toEqual({ text: "Hello world link" });
  });

  it("strips HTML tags and decodes entities", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        html: "<p>Rock &amp; Roll &lt;great&gt;</p>",
      }),
    });

    const result = await fetchTweetText("https://x.com/user/status/123");
    expect(result).toEqual({ text: "Rock & Roll <great>" });
  });

  it("converts <br> to newline", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({
        html: "<p>Line one<br/>Line two</p>",
      }),
    });

    const result = await fetchTweetText("https://x.com/user/status/123");
    expect(result).toEqual({ text: "Line one\nLine two" });
  });

  it("returns error when response is not ok", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const result = await fetchTweetText("https://x.com/user/status/123");
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("returns error when html produces empty text", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ html: "<p></p>" }),
    });

    const result = await fetchTweetText("https://x.com/user/status/123");
    expect(result).toMatchObject({ error: expect.any(String) });
  });

  it("returns error on fetch exception", async () => {
    mockFetch.mockRejectedValueOnce(new Error("network error"));

    const result = await fetchTweetText("https://x.com/user/status/123");
    expect(result).toMatchObject({ error: expect.any(String) });
  });
});

describe("fetchTweetFromText", () => {
  it("returns null when no tweet URL in text", async () => {
    const result = await fetchTweetFromText("just some text without URLs");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("returns null when text has non-twitter URL", async () => {
    const result = await fetchTweetFromText("check https://github.com/user/repo");
    expect(result).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("extracts tweet text when x.com URL is present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ html: "<p>Tweet content</p>" }),
    });

    const result = await fetchTweetFromText("check this out https://x.com/user/status/123456");
    expect(result).toEqual({ text: "Tweet content" });
  });

  it("extracts tweet text when twitter.com URL is present", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: async () => ({ html: "<p>Old twitter post</p>" }),
    });

    const result = await fetchTweetFromText("https://twitter.com/user/status/789");
    expect(result).toEqual({ text: "Old twitter post" });
  });

  it("returns null when fetch fails", async () => {
    mockFetch.mockResolvedValueOnce({ ok: false });

    const result = await fetchTweetFromText("https://x.com/user/status/999");
    expect(result).toBeNull();
  });
});
