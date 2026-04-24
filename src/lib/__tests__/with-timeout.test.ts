import { describe, it, expect, vi } from "vitest";
import { withTimeout, TimeoutError } from "@/lib/with-timeout";

describe("withTimeout", () => {
  it("resolves with the promise result when it beats the timeout", async () => {
    const fast = new Promise<string>((resolve) => setTimeout(() => resolve("ok"), 10));
    const result = await withTimeout(fast, 1000, "test-fast");
    expect(result).toBe("ok");
  });

  it("rejects with TimeoutError when the promise hangs past the budget", async () => {
    vi.useFakeTimers();
    // A promise that never resolves on its own — only the timeout
    // branch can settle the race.
    const hanging = new Promise<string>(() => {
      /* never resolves */
    });

    const pending = withTimeout(hanging, 500, "hanging-op");
    const settled = pending.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(500);
    const err = await settled;
    vi.useRealTimers();

    expect(err).toBeInstanceOf(TimeoutError);
    expect((err as TimeoutError).timeoutMs).toBe(500);
    expect((err as Error).message).toMatch(/hanging-op/);
    expect((err as Error).message).toMatch(/500/);
  });

  it("propagates the original rejection when the promise fails before the timeout", async () => {
    const boom = new Error("original failure");
    const rejecting = new Promise<string>((_resolve, reject) => {
      setTimeout(() => reject(boom), 10);
    });

    await expect(withTimeout(rejecting, 1000, "op")).rejects.toBe(boom);
  });
});
