import { describe, it, expect, vi, beforeEach } from "vitest";

// Threads token actions mirror linkedin-token.ts — thin auth wrappers
// around `@/lib/server/threads-token`. The crypto path lives in
// token-encryption.test.ts; this file pins the Server Action contract.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-threads-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const serverThreadsMock = vi.hoisted(() => ({
  getThreadsApiTokenForUser: vi.fn(),
  getThreadsConnectionStatus: vi.fn(),
  getThreadsProfileForComposer: vi.fn(),
  disconnectThreadsAccount: vi.fn(),
}));
vi.mock("@/lib/server/threads-token", () => serverThreadsMock);

import { requireUserId } from "@/lib/auth";
import {
  getThreadsApiTokenForUser,
  getThreadsConnectionStatus,
  getThreadsProfileForComposer,
  disconnectThreadsAccount,
} from "../threads-token";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  serverThreadsMock.getThreadsApiTokenForUser.mockResolvedValue(null);
  serverThreadsMock.getThreadsConnectionStatus.mockResolvedValue({ connected: false });
  serverThreadsMock.getThreadsProfileForComposer.mockResolvedValue(null);
  serverThreadsMock.disconnectThreadsAccount.mockResolvedValue(undefined);
});

describe("getThreadsApiTokenForUser", () => {
  it("authenticates then forwards userId", async () => {
    await getThreadsApiTokenForUser();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverThreadsMock.getThreadsApiTokenForUser).toHaveBeenCalledWith(USER_ID);
  });
});

describe("getThreadsConnectionStatus", () => {
  it("forwards userId and returns the helper's status shape", async () => {
    serverThreadsMock.getThreadsConnectionStatus.mockResolvedValue({
      connected: true,
      threadsUsername: "acme",
      connectedAt: new Date("2026-01-01"),
    });

    const status = await getThreadsConnectionStatus();

    expect(serverThreadsMock.getThreadsConnectionStatus).toHaveBeenCalledWith(USER_ID);
    expect(status.threadsUsername).toBe("acme");
  });
});

describe("getThreadsProfileForComposer", () => {
  it("forwards userId", async () => {
    await getThreadsProfileForComposer();
    expect(serverThreadsMock.getThreadsProfileForComposer).toHaveBeenCalledWith(USER_ID);
  });
});

describe("disconnectThreadsAccount", () => {
  it("authenticates before triggering disconnect", async () => {
    await disconnectThreadsAccount();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverThreadsMock.disconnectThreadsAccount).toHaveBeenCalledWith(USER_ID);
  });
});
