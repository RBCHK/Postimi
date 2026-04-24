import { describe, it, expect, vi, beforeEach } from "vitest";

// Schedule is the scheduling pipeline for all posts — every CRUD path
// must be scoped by userId. `toggleSlotPosted` in particular guards
// against the PR #66 regression where an attacker could flip a victim's
// slot state via a forged slot id; it must precheck ownership before any
// write, and every subsequent write must carry `userId` in the WHERE.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-schedule-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
  requireUser: vi.fn().mockResolvedValue({ id: USER_ID, timezone: "UTC" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

vi.mock("@/generated/prisma", () => ({
  SlotType: { REPLY: "REPLY", POST: "POST", THREAD: "THREAD", ARTICLE: "ARTICLE", QUOTE: "QUOTE" },
  SlotStatus: { EMPTY: "EMPTY", SCHEDULED: "SCHEDULED", POSTED: "POSTED" },
}));

vi.mock("@/lib/date-utils", () => ({
  calendarDateStr: vi.fn().mockReturnValue("2099-01-01"),
  nowInTimezone: vi
    .fn()
    .mockReturnValue({ dateStr: "2099-01-01", timeSlot: "12:00 AM", date: new Date() }),
  time24to12: vi.fn().mockImplementation((t: string) => t),
  isSlotFuture: vi.fn().mockReturnValue(true),
  addUTCDays: vi.fn().mockImplementation((d: Date, n: number) => {
    const r = new Date(d);
    r.setUTCDate(r.getUTCDate() + n);
    return r;
  }),
  slotToUtcDate: vi.fn().mockImplementation((d: Date) => d),
}));

const prismaMock = vi.hoisted(() => ({
  strategyConfig: {
    findFirst: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
  },
  scheduledSlot: {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
  conversation: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const serverScheduleMock = vi.hoisted(() => ({
  getScheduleConfig: vi.fn(),
}));
vi.mock("@/lib/server/schedule", () => serverScheduleMock);

import { revalidatePath } from "next/cache";
import {
  getScheduleConfig,
  saveScheduleConfig,
  toggleSlotPosted,
  deleteSlot,
  unscheduleSlot,
  updateScheduledContent,
  checkExistingSchedule,
  hasEmptySlots,
} from "../schedule";

const EMPTY_CONFIG = {
  posts: { slots: [] },
  replies: { slots: [] },
  threads: { slots: [] },
  articles: { slots: [] },
  quotes: { slots: [] },
};

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.strategyConfig.findFirst.mockResolvedValue(null);
  prismaMock.strategyConfig.create.mockResolvedValue({ id: "sc-1" });
  prismaMock.strategyConfig.update.mockResolvedValue({ id: "sc-1" });
  prismaMock.scheduledSlot.findFirst.mockResolvedValue(null);
  prismaMock.scheduledSlot.findMany.mockResolvedValue([]);
  prismaMock.scheduledSlot.create.mockResolvedValue({ id: "sl-1" });
  prismaMock.scheduledSlot.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.scheduledSlot.deleteMany.mockResolvedValue({ count: 1 });
  prismaMock.conversation.findFirst.mockResolvedValue(null);
  prismaMock.conversation.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.conversation.deleteMany.mockResolvedValue({ count: 1 });
  serverScheduleMock.getScheduleConfig.mockResolvedValue(null);
});

describe("getScheduleConfig", () => {
  it("delegates to the server helper with the authenticated userId", async () => {
    await getScheduleConfig();
    expect(serverScheduleMock.getScheduleConfig).toHaveBeenCalledWith(USER_ID);
  });
});

describe("saveScheduleConfig", () => {
  it("creates a new row scoped by userId when none exists", async () => {
    prismaMock.strategyConfig.findFirst.mockResolvedValue(null);

    await saveScheduleConfig(EMPTY_CONFIG);

    expect(prismaMock.strategyConfig.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID },
    });
    expect(prismaMock.strategyConfig.create).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({ userId: USER_ID }) })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
  });

  it("updates the existing row in place (update uses id, not userId write)", async () => {
    prismaMock.strategyConfig.findFirst.mockResolvedValue({ id: "sc-1" });

    await saveScheduleConfig(EMPTY_CONFIG);

    // Per source: uses `{where: {id}}` after the precheck — the precheck
    // above is the guard that keeps the update tenant-scoped.
    expect(prismaMock.strategyConfig.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "sc-1" } })
    );
    expect(prismaMock.strategyConfig.create).not.toHaveBeenCalled();
  });
});

describe("toggleSlotPosted — PR #66 precheck + userId scoping", () => {
  it("rejects when no slot matches (id, userId) — precheck is the tenant guard", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue(null);

    await expect(toggleSlotPosted("slot-victim")).rejects.toThrow("Slot not found");

    // No write may fire — the attacker must not be able to flip victim state.
    expect(prismaMock.scheduledSlot.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.scheduledSlot.deleteMany).not.toHaveBeenCalled();
  });

  it("precheck is scoped by (id, userId)", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue({
      id: "s1",
      status: "SCHEDULED",
      conversationId: null,
    });

    await toggleSlotPosted("s1");

    expect(prismaMock.scheduledSlot.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", userId: USER_ID },
    });
  });

  it("SCHEDULED → POSTED also scopes the conversation.updateMany by userId", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue({
      id: "s1",
      status: "SCHEDULED",
      conversationId: "c1",
    });

    await toggleSlotPosted("s1");

    expect(prismaMock.scheduledSlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "s1", userId: USER_ID },
        data: expect.objectContaining({ status: "POSTED" }),
      })
    );
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "c1", userId: USER_ID },
        data: { status: "POSTED" },
      })
    );
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
  });

  it("POSTED → SCHEDULED reverts both tables scoped by userId when conversationId present", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue({
      id: "s1",
      status: "POSTED",
      conversationId: "c1",
    });

    const result = await toggleSlotPosted("s1");

    expect(prismaMock.scheduledSlot.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", userId: USER_ID },
      data: { status: "SCHEDULED", postedAt: null },
    });
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", userId: USER_ID },
      data: { status: "SCHEDULED" },
    });
    expect(result).toEqual({ status: "SCHEDULED" });
  });

  it("POSTED with no conversation deletes the slot scoped by userId", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue({
      id: "s1",
      status: "POSTED",
      conversationId: null,
    });

    const result = await toggleSlotPosted("s1");

    expect(prismaMock.scheduledSlot.deleteMany).toHaveBeenCalledWith({
      where: { id: "s1", userId: USER_ID },
    });
    expect(result).toEqual({ status: "EMPTY" });
  });
});

describe("deleteSlot — cascade is userId-scoped", () => {
  it("is a no-op when no slot matches the caller", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue(null);

    await deleteSlot("slot-victim");

    expect(prismaMock.scheduledSlot.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.conversation.deleteMany).not.toHaveBeenCalled();
  });

  it("scopes the delete + conversation cleanup by userId", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue({
      id: "s1",
      conversationId: "c1",
    });

    await deleteSlot("s1");

    expect(prismaMock.scheduledSlot.findFirst).toHaveBeenCalledWith({
      where: { id: "s1", userId: USER_ID },
    });
    expect(prismaMock.scheduledSlot.deleteMany).toHaveBeenCalledWith({
      where: { id: "s1", userId: USER_ID },
    });
    expect(prismaMock.conversation.deleteMany).toHaveBeenCalledWith({
      where: { id: "c1", userId: USER_ID },
    });
  });
});

describe("unscheduleSlot — cascade is userId-scoped", () => {
  it("is a no-op when precheck returns nothing", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue(null);

    await unscheduleSlot("slot-victim");

    expect(prismaMock.scheduledSlot.deleteMany).not.toHaveBeenCalled();
    expect(prismaMock.conversation.updateMany).not.toHaveBeenCalled();
  });

  it("transitions conversation back to DRAFT, scoped by userId", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValue({
      id: "s1",
      conversationId: "c1",
    });

    await unscheduleSlot("s1");

    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith({
      where: { id: "c1", userId: USER_ID },
      data: { status: "DRAFT" },
    });
    expect(prismaMock.scheduledSlot.deleteMany).toHaveBeenCalledWith({
      where: { id: "s1", userId: USER_ID },
    });
  });
});

describe("updateScheduledContent & checkExistingSchedule — userId scoping", () => {
  it("updateScheduledContent scopes the write by userId", async () => {
    await updateScheduledContent("s1", "new body");

    expect(prismaMock.scheduledSlot.updateMany).toHaveBeenCalledWith({
      where: { id: "s1", userId: USER_ID },
      data: { content: "new body" },
    });
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
  });

  it("checkExistingSchedule reads only rows the caller owns", async () => {
    await checkExistingSchedule("c1");

    expect(prismaMock.scheduledSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID, conversationId: "c1" }),
      })
    );
  });
});

describe("hasEmptySlots — filters scheduledSlot reads by userId", () => {
  it("returns false when no config exists", async () => {
    serverScheduleMock.getScheduleConfig.mockResolvedValue(null);

    const out = await hasEmptySlots("POST");

    expect(out).toBe(false);
    expect(prismaMock.scheduledSlot.findMany).not.toHaveBeenCalled();
  });

  it("scopes the occupancy lookup by userId + slotType", async () => {
    serverScheduleMock.getScheduleConfig.mockResolvedValue({
      posts: {
        slots: [
          {
            id: "s1",
            time: "09:00",
            days: { Mon: true, Tue: true, Wed: true, Thu: true, Fri: true, Sat: true, Sun: true },
          },
        ],
      },
      replies: { slots: [] },
      threads: { slots: [] },
      articles: { slots: [] },
      quotes: { slots: [] },
    });

    await hasEmptySlots("POST");

    expect(prismaMock.scheduledSlot.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          userId: USER_ID,
          status: "SCHEDULED",
          slotType: "POST",
        }),
      })
    );
  });
});
