import { describe, it, expect, vi, beforeEach } from "vitest";

// Followers actions are thin wrappers over `@/lib/server/followers` — the
// public Server Action must call `requireUserId()` first and forward the
// authenticated userId to every helper. The security boundary is the
// auth check here; the helpers assume userId is trustworthy.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-followers-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const serverFollowersMock = vi.hoisted(() => ({
  saveFollowersSnapshot: vi.fn(),
  getFollowersHistory: vi.fn(),
  getLatestFollowersSnapshot: vi.fn(),
}));
vi.mock("@/lib/server/followers", () => serverFollowersMock);

import { requireUserId } from "@/lib/auth";
import {
  saveFollowersSnapshot,
  getFollowersHistory,
  getLatestFollowersSnapshot,
} from "../followers";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  serverFollowersMock.saveFollowersSnapshot.mockResolvedValue({
    id: "snap-1",
    followersCount: 0,
    followingCount: 0,
    capturedAt: new Date(),
  });
  serverFollowersMock.getFollowersHistory.mockResolvedValue([]);
  serverFollowersMock.getLatestFollowersSnapshot.mockResolvedValue(null);
});

describe("saveFollowersSnapshot", () => {
  it("authenticates before hitting the helper", async () => {
    await saveFollowersSnapshot({ followersCount: 100, followingCount: 50 });
    expect(requireUserId).toHaveBeenCalledTimes(1);
  });

  it("forwards (userId, data) to the server helper", async () => {
    const data = { followersCount: 123, followingCount: 45 };
    await saveFollowersSnapshot(data);
    expect(serverFollowersMock.saveFollowersSnapshot).toHaveBeenCalledWith(USER_ID, data);
  });
});

describe("getFollowersHistory", () => {
  it("defaults to 30 days when argument is omitted", async () => {
    await getFollowersHistory();
    expect(serverFollowersMock.getFollowersHistory).toHaveBeenCalledWith(USER_ID, 30);
  });

  it("forwards the days argument verbatim", async () => {
    await getFollowersHistory(7);
    expect(serverFollowersMock.getFollowersHistory).toHaveBeenCalledWith(USER_ID, 7);
  });
});

describe("getLatestFollowersSnapshot", () => {
  it("authenticates and forwards userId", async () => {
    await getLatestFollowersSnapshot();
    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverFollowersMock.getLatestFollowersSnapshot).toHaveBeenCalledWith(USER_ID);
  });
});
