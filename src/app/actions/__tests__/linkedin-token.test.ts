import { describe, it, expect, vi, beforeEach } from "vitest";

// LinkedIn token actions are thin auth wrappers over
// `@/lib/server/linkedin-token`. Their single job is:
// (a) requireUserId() before anything else,
// (b) forward the authenticated userId to the private helper.
// A bypass here leaks OAuth tokens / profile data cross-tenant.
// The crypto path is covered separately in token-encryption.test.ts —
// these tests stay at the Server Action boundary.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-linkedin-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const serverLinkedInMock = vi.hoisted(() => ({
  getLinkedInApiTokenForUser: vi.fn(),
  getLinkedInConnectionStatus: vi.fn(),
  getLinkedInProfileForComposer: vi.fn(),
  disconnectLinkedInAccount: vi.fn(),
}));
vi.mock("@/lib/server/linkedin-token", () => serverLinkedInMock);

import { requireUserId } from "@/lib/auth";
import {
  getLinkedInApiTokenForUser,
  getLinkedInConnectionStatus,
  getLinkedInProfileForComposer,
  disconnectLinkedInAccount,
} from "../linkedin-token";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  serverLinkedInMock.getLinkedInApiTokenForUser.mockResolvedValue(null);
  serverLinkedInMock.getLinkedInConnectionStatus.mockResolvedValue({ connected: false });
  serverLinkedInMock.getLinkedInProfileForComposer.mockResolvedValue(null);
  serverLinkedInMock.disconnectLinkedInAccount.mockResolvedValue(undefined);
});

describe("getLinkedInApiTokenForUser", () => {
  it("authenticates then forwards userId", async () => {
    await getLinkedInApiTokenForUser();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverLinkedInMock.getLinkedInApiTokenForUser).toHaveBeenCalledWith(USER_ID);
  });

  it("returns null when no connection exists", async () => {
    serverLinkedInMock.getLinkedInApiTokenForUser.mockResolvedValue(null);
    expect(await getLinkedInApiTokenForUser()).toBeNull();
  });
});

describe("getLinkedInConnectionStatus", () => {
  it("forwards userId and returns the helper's status shape", async () => {
    serverLinkedInMock.getLinkedInConnectionStatus.mockResolvedValue({
      connected: true,
      linkedinName: "Jane",
      connectedAt: new Date("2026-01-01"),
    });

    const status = await getLinkedInConnectionStatus();

    expect(serverLinkedInMock.getLinkedInConnectionStatus).toHaveBeenCalledWith(USER_ID);
    expect(status.connected).toBe(true);
    expect(status.linkedinName).toBe("Jane");
  });
});

describe("getLinkedInProfileForComposer", () => {
  it("forwards userId", async () => {
    await getLinkedInProfileForComposer();
    expect(serverLinkedInMock.getLinkedInProfileForComposer).toHaveBeenCalledWith(USER_ID);
  });
});

describe("disconnectLinkedInAccount", () => {
  it("authenticates before triggering disconnect", async () => {
    await disconnectLinkedInAccount();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverLinkedInMock.disconnectLinkedInAccount).toHaveBeenCalledWith(USER_ID);
  });
});
