import { describe, it, expect, vi, beforeEach } from "vitest";

// X (Twitter) token actions mirror linkedin-token / threads-token —
// thin auth wrappers around `@/lib/server/x-token`. In addition to the
// standard token/status/profile/disconnect surface, x-token exports
// `hasMediaWriteScope` which reads the OAuth scope list to decide
// whether the composer's image-upload UI should be enabled.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-x-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const serverXTokenMock = vi.hoisted(() => ({
  getXApiTokenForUser: vi.fn(),
  getXConnectionStatus: vi.fn(),
  getXProfileForComposer: vi.fn(),
  disconnectXAccount: vi.fn(),
  hasMediaWriteScope: vi.fn(),
}));
vi.mock("@/lib/server/x-token", () => serverXTokenMock);

import { requireUserId } from "@/lib/auth";
import {
  getXApiTokenForUser,
  getXConnectionStatus,
  getXProfileForComposer,
  disconnectXAccount,
  hasMediaWriteScope,
} from "../x-token";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  serverXTokenMock.getXApiTokenForUser.mockResolvedValue(null);
  serverXTokenMock.getXConnectionStatus.mockResolvedValue({ connected: false });
  serverXTokenMock.getXProfileForComposer.mockResolvedValue(null);
  serverXTokenMock.disconnectXAccount.mockResolvedValue(undefined);
  serverXTokenMock.hasMediaWriteScope.mockResolvedValue(false);
});

describe("getXApiTokenForUser", () => {
  it("authenticates then forwards userId", async () => {
    await getXApiTokenForUser();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverXTokenMock.getXApiTokenForUser).toHaveBeenCalledWith(USER_ID);
  });
});

describe("getXConnectionStatus", () => {
  it("forwards userId and returns the helper's status shape", async () => {
    serverXTokenMock.getXConnectionStatus.mockResolvedValue({
      connected: true,
      xUsername: "acme",
      connectedAt: new Date("2026-01-01"),
    });

    const status = await getXConnectionStatus();

    expect(serverXTokenMock.getXConnectionStatus).toHaveBeenCalledWith(USER_ID);
    expect(status.xUsername).toBe("acme");
  });
});

describe("getXProfileForComposer", () => {
  it("forwards userId", async () => {
    await getXProfileForComposer();
    expect(serverXTokenMock.getXProfileForComposer).toHaveBeenCalledWith(USER_ID);
  });
});

describe("disconnectXAccount", () => {
  it("authenticates before triggering disconnect", async () => {
    await disconnectXAccount();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverXTokenMock.disconnectXAccount).toHaveBeenCalledWith(USER_ID);
  });
});

describe("hasMediaWriteScope", () => {
  it("returns the helper's boolean verdict scoped by userId", async () => {
    serverXTokenMock.hasMediaWriteScope.mockResolvedValue(true);

    const result = await hasMediaWriteScope();

    expect(serverXTokenMock.hasMediaWriteScope).toHaveBeenCalledWith(USER_ID);
    expect(result).toBe(true);
  });

  it("returns false when the scope is absent", async () => {
    serverXTokenMock.hasMediaWriteScope.mockResolvedValue(false);
    expect(await hasMediaWriteScope()).toBe(false);
  });
});
