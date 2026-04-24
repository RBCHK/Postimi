import { describe, it, expect, vi, beforeEach } from "vitest";

// `daily-insight` is a thin action layer over `src/lib/server/daily-insight`.
// Tests exercise both: the server-action userId propagation and the
// underlying helper's UTC-midnight date handling (per CLAUDE.md the
// cron pipeline expects UTC-midnight keys, never local-tz midnight).

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-insight-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

const prismaMock = vi.hoisted(() => ({
  dailyInsight: {
    upsert: vi.fn(),
    findFirst: vi.fn(),
    findUnique: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import {
  saveDailyInsight as saveDailyInsightAction,
  getLatestDailyInsight as getLatestDailyInsightAction,
  getTodayInsight as getTodayInsightAction,
} from "../daily-insight";
import {
  saveDailyInsight as saveDailyInsightServer,
  getLatestDailyInsight as getLatestDailyInsightServer,
  getTodayInsight as getTodayInsightServer,
} from "@/lib/server/daily-insight";

const BASE_ROW = {
  id: "di-1",
  date: new Date("2026-04-20T00:00:00.000Z"),
  insights: ["a", "b"],
  context: { something: 1 },
  createdAt: new Date("2026-04-20T12:00:00.000Z"),
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.dailyInsight.upsert.mockResolvedValue(BASE_ROW);
  prismaMock.dailyInsight.findFirst.mockResolvedValue(null);
  prismaMock.dailyInsight.findUnique.mockResolvedValue(null);
});

describe("action layer — userId propagation", () => {
  it("saveDailyInsight forwards the authenticated userId to the server helper", async () => {
    await saveDailyInsightAction({
      date: new Date("2026-04-20T14:00:00.000Z"),
      insights: ["a"],
      context: { ok: 1 } as never,
    });

    const call = prismaMock.dailyInsight.upsert.mock.calls[0]![0];
    expect(call.where.userId_date.userId).toBe(USER_ID);
    expect(call.create.userId).toBe(USER_ID);
  });

  it("getLatestDailyInsight scopes findFirst by userId", async () => {
    await getLatestDailyInsightAction();

    expect(prismaMock.dailyInsight.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  it("getTodayInsight scopes findUnique by userId (via compound key)", async () => {
    await getTodayInsightAction();

    const call = prismaMock.dailyInsight.findUnique.mock.calls[0]![0];
    expect(call.where.userId_date.userId).toBe(USER_ID);
  });
});

describe("server helper — UTC-midnight date handling", () => {
  it("saveDailyInsight converts any date in-day to UTC midnight for the key", async () => {
    // A timestamp partway through the day should still index against
    // that day's UTC midnight — otherwise the cron's idempotency key
    // drifts by timezone and you get duplicate rows per day.
    const midDay = new Date("2026-04-20T17:43:00.000Z");

    await saveDailyInsightServer(USER_ID, {
      date: midDay,
      insights: ["x"],
      context: {} as never,
    });

    const call = prismaMock.dailyInsight.upsert.mock.calls[0]![0];
    const key = call.where.userId_date.date as Date;
    expect(key.toISOString()).toBe("2026-04-20T00:00:00.000Z");
    expect(call.create.date.toISOString()).toBe("2026-04-20T00:00:00.000Z");
  });

  it("saveDailyInsight writes insights + context on both create and update branches", async () => {
    const insights = ["i1", "i2"];
    const context = { lol: 42 } as never;

    await saveDailyInsightServer(USER_ID, {
      date: new Date("2026-04-20T00:00:00.000Z"),
      insights,
      context,
    });

    const call = prismaMock.dailyInsight.upsert.mock.calls[0]![0];
    expect(call.create.insights).toBe(insights);
    expect(call.create.context).toBe(context);
    expect(call.update.insights).toBe(insights);
    expect(call.update.context).toBe(context);
    // No userId in the update branch — upsert matches on userId_date key
    expect(call.update.userId).toBeUndefined();
  });

  it("getLatestDailyInsight orders by date desc — returns the most recent row", async () => {
    prismaMock.dailyInsight.findFirst.mockResolvedValue(BASE_ROW);

    const out = await getLatestDailyInsightServer(USER_ID);

    expect(prismaMock.dailyInsight.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID },
      orderBy: { date: "desc" },
    });
    expect(out).toEqual({
      id: BASE_ROW.id,
      date: BASE_ROW.date,
      insights: BASE_ROW.insights,
      context: BASE_ROW.context,
      createdAt: BASE_ROW.createdAt,
    });
  });

  it("getTodayInsight looks up today's UTC-midnight key, not local-tz midnight", async () => {
    const beforeMillis = Date.now();
    await getTodayInsightServer(USER_ID);
    const afterMillis = Date.now();

    const call = prismaMock.dailyInsight.findUnique.mock.calls[0]![0];
    const key = call.where.userId_date.date as Date;
    // Key is midnight of "today" in UTC. Assert it sits within the
    // expected UTC-midnight window for the current run.
    const beforeDay = new Date(beforeMillis);
    const afterDay = new Date(afterMillis);
    const expectedFloor = new Date(
      Date.UTC(beforeDay.getFullYear(), beforeDay.getMonth(), beforeDay.getDate())
    );
    const expectedCeil = new Date(
      Date.UTC(afterDay.getFullYear(), afterDay.getMonth(), afterDay.getDate() + 1)
    );
    expect(key.getTime()).toBeGreaterThanOrEqual(expectedFloor.getTime());
    expect(key.getTime()).toBeLessThan(expectedCeil.getTime());
    // Midnight: no sub-day offset leaked in.
    expect(key.getUTCHours()).toBe(0);
    expect(key.getUTCMinutes()).toBe(0);
    expect(key.getUTCSeconds()).toBe(0);
  });

  it("getTodayInsight returns null when there's no row for today", async () => {
    prismaMock.dailyInsight.findUnique.mockResolvedValue(null);

    const out = await getTodayInsightServer(USER_ID);

    expect(out).toBeNull();
  });
});
