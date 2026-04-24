import { describe, it, expect, vi, beforeEach } from "vitest";

// Trends actions delegate to `@/lib/server/trends`. The wrapper's job is
// to call requireUserId() first and forward the userId to every helper.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-trends-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const serverTrendsMock = vi.hoisted(() => ({
  saveTrendSnapshots: vi.fn(),
  getLatestTrends: vi.fn(),
  cleanupOldTrends: vi.fn(),
}));
vi.mock("@/lib/server/trends", () => serverTrendsMock);

import { requireUserId } from "@/lib/auth";
import { saveTrendSnapshots, getLatestTrends, cleanupOldTrends } from "../trends";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  serverTrendsMock.saveTrendSnapshots.mockResolvedValue(0);
  serverTrendsMock.getLatestTrends.mockResolvedValue([]);
  serverTrendsMock.cleanupOldTrends.mockResolvedValue(0);
});

describe("saveTrendSnapshots", () => {
  it("authenticates and forwards (userId, date, trends, fetchHour)", async () => {
    const date = new Date("2026-04-20T00:00:00.000Z");
    const trends = [{ topic: "a", volume: 1 } as never];

    await saveTrendSnapshots(date, trends, 14);

    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverTrendsMock.saveTrendSnapshots).toHaveBeenCalledWith(USER_ID, date, trends, 14);
  });

  it("passes fetchHour=undefined when omitted", async () => {
    const date = new Date("2026-04-20T00:00:00.000Z");
    await saveTrendSnapshots(date, []);
    expect(serverTrendsMock.saveTrendSnapshots).toHaveBeenCalledWith(USER_ID, date, [], undefined);
  });
});

describe("getLatestTrends", () => {
  it("forwards userId to the helper", async () => {
    await getLatestTrends();
    expect(serverTrendsMock.getLatestTrends).toHaveBeenCalledWith(USER_ID);
  });
});

describe("cleanupOldTrends", () => {
  it("defaults keepDays to 10 when argument is omitted", async () => {
    await cleanupOldTrends();
    expect(serverTrendsMock.cleanupOldTrends).toHaveBeenCalledWith(USER_ID, 10);
  });

  it("forwards an explicit keepDays argument", async () => {
    await cleanupOldTrends(30);
    expect(serverTrendsMock.cleanupOldTrends).toHaveBeenCalledWith(USER_ID, 30);
  });
});
