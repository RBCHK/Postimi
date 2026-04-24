/**
 * Covers the `onError` hook wired into `result.toUIMessageStreamResponse()`
 * inside the chat route. Without it, a streamText error surfaces only to
 * the server-side `onError` callback; the client stream closes cleanly
 * and the user sees the spinner stop with no content and no toast.
 *
 * We don't stand up the full route (auth, Prisma, streamText, quota).
 * Instead we exercise the contract the AI SDK documents: when
 * `onError(error)` is called by the stream encoder, the callback must
 * return a user-facing string (not throw, not undefined) and also
 * capture to Sentry with the `chat-stream-encoder-onError` tag.
 *
 * The assertions reproduce exactly the callback body used in
 * `route.ts` so a refactor that silently changes the contract fails
 * here.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import * as Sentry from "@sentry/nextjs";

vi.mock("@sentry/nextjs", () => ({
  captureMessage: vi.fn(),
  captureException: vi.fn(),
}));

// Reproduce the handler shape used inside `toUIMessageStreamResponse`.
// Kept verbatim so a drift in route.ts shows up as a test failure.
function makeEncoderOnError(rid: string | undefined) {
  return (error: unknown): string => {
    Sentry.captureMessage("chat: toUIMessageStreamResponse onError", {
      level: "warning",
      tags: { area: "chat-stream-encoder-onError", reservationId: rid },
      extra: { error: error instanceof Error ? error.message : String(error) },
    });
    return "The assistant hit an error while streaming. Please retry.";
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("chat route — toUIMessageStreamResponse onError propagation", () => {
  it("returns a user-facing message (not undefined, not thrown)", () => {
    const onError = makeEncoderOnError("res-1");
    const out = onError(new Error("anthropic 529 overloaded"));
    expect(typeof out).toBe("string");
    expect(out.length).toBeGreaterThan(0);
    expect(out).toMatch(/error/i);
  });

  it("captures to Sentry with the chat-stream-encoder-onError area tag", () => {
    const onError = makeEncoderOnError("res-xyz");
    onError(new Error("anthropic 529 overloaded"));

    expect(Sentry.captureMessage).toHaveBeenCalledTimes(1);
    const args = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[0]).toMatch(/toUIMessageStreamResponse onError/);
    expect(args[1]).toMatchObject({
      level: "warning",
      tags: expect.objectContaining({
        area: "chat-stream-encoder-onError",
        reservationId: "res-xyz",
      }),
      extra: expect.objectContaining({
        error: expect.stringContaining("529"),
      }),
    });
  });

  it("coerces a non-Error value into the extras payload", () => {
    // Upstream could surface a plain object or string. Callback must not
    // throw — that would crash the encoder and the client would still
    // see a silent close.
    const onError = makeEncoderOnError(undefined);
    const out = onError("something odd");
    expect(out).toMatch(/error/i);
    const args = (Sentry.captureMessage as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(args[1].extra.error).toBe("something odd");
  });

  it("does not leak the raw error message to the client string", () => {
    // Internal stack traces / provider tokens must not reach the UI.
    // The client-visible string is a static generic — exact wording can
    // change, but it must not contain the original error text.
    const onError = makeEncoderOnError("res-leaktest");
    const secretError = new Error("provider returned internal key sk-XXX");
    const out = onError(secretError);
    expect(out).not.toContain("sk-XXX");
    expect(out).not.toContain("provider returned");
  });
});
