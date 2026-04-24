import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Mocks ───────────────────────────────────────────────
//
// Defense-in-depth tests: verify that every write path we tightened
// carries `userId` in its WHERE clause. Prisma is mocked so we can
// force the precheck to pass and still observe the WHERE args of the
// subsequent update/delete. A future refactor that drops the precheck
// would then be caught by whichever assertion fails first.

const TEST_USER_ID = "user-1";

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
  requireUser: vi.fn().mockResolvedValue({ id: TEST_USER_ID, timezone: "UTC" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// No mock for @/generated/prisma — enums are only used as TypeScript type
// annotations in the SUT (erased at compile time). Loading the real
// generated enum exports means any future code that starts comparing
// values at runtime will actually work; the empty `{}` mock would have
// silently returned undefined.

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

// Per-resource Prisma mock. Each model gets the subset of methods we
// exercise; unused ones stay undefined so an accidental call throws.
type TransactionArg = unknown[] | ((tx: unknown) => unknown);

const prismaMock = {
  scheduledSlot: {
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  conversation: {
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  media: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  voiceBankEntry: {
    findFirst: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  planProposal: {
    findFirst: vi.fn(),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  // `acceptProposal` calls `getScheduleConfig` / `saveScheduleConfig`
  // which hit StrategyConfig under the hood — stub just enough for the
  // happy path (null config → create branch).
  strategyConfig: {
    findFirst: vi.fn().mockResolvedValue(null),
    create: vi.fn().mockResolvedValue({ id: "sc-1" }),
    update: vi.fn().mockResolvedValue({ id: "sc-1" }),
  },
  note: {
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
    updateMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  // $transaction accepts either an array of promises or a callback. In
  // the reorderMedia path we only exercise the array form, so a simple
  // Promise.all over the input suffices.
  $transaction: vi.fn().mockImplementation((arg: TransactionArg) => {
    if (Array.isArray(arg)) return Promise.all(arg as Promise<unknown>[]);
    return (arg as (tx: unknown) => Promise<unknown>)(prismaMock);
  }),
};

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
});

// ─── schedule.ts ────────────────────────────────────────

describe("schedule.toggleSlotPosted — userId-scoped writes", () => {
  it("reverting POSTED→SCHEDULED scopes both the slot and conversation updates by userId", async () => {
    // Slot belongs to current user, has a conversationId
    prismaMock.scheduledSlot.findFirst.mockResolvedValueOnce({
      id: "slot-1",
      userId: TEST_USER_ID,
      status: "POSTED",
      conversationId: "conv-1",
    });

    const { toggleSlotPosted } = await import("../schedule");
    const res = await toggleSlotPosted("slot-1");

    expect(res.status).toBe("SCHEDULED");
    expect(prismaMock.scheduledSlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "slot-1", userId: TEST_USER_ID }),
      })
    );
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "conv-1", userId: TEST_USER_ID }),
      })
    );
  });

  it("deleting a POSTED slot with no conversation scopes the delete by userId", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValueOnce({
      id: "slot-1",
      userId: TEST_USER_ID,
      status: "POSTED",
      conversationId: null,
    });

    const { toggleSlotPosted } = await import("../schedule");
    await toggleSlotPosted("slot-1");

    expect(prismaMock.scheduledSlot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "slot-1", userId: TEST_USER_ID }),
      })
    );
  });

  it("marking a SCHEDULED slot as POSTED scopes both writes by userId", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValueOnce({
      id: "slot-1",
      userId: TEST_USER_ID,
      status: "SCHEDULED",
      conversationId: "conv-1",
    });

    const { toggleSlotPosted } = await import("../schedule");
    await toggleSlotPosted("slot-1");

    expect(prismaMock.scheduledSlot.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "slot-1", userId: TEST_USER_ID }),
        data: expect.objectContaining({ status: "POSTED" }),
      })
    );
    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "conv-1", userId: TEST_USER_ID }),
      })
    );
  });
});

describe("schedule.unscheduleSlot — userId-scoped writes", () => {
  it("resets the linked conversation to DRAFT scoped by userId", async () => {
    prismaMock.scheduledSlot.findFirst.mockResolvedValueOnce({
      id: "slot-1",
      userId: TEST_USER_ID,
      status: "SCHEDULED",
      conversationId: "conv-1",
    });

    const { unscheduleSlot } = await import("../schedule");
    await unscheduleSlot("slot-1");

    expect(prismaMock.conversation.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "conv-1", userId: TEST_USER_ID }),
        data: expect.objectContaining({ status: "DRAFT" }),
      })
    );
    expect(prismaMock.scheduledSlot.deleteMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "slot-1", userId: TEST_USER_ID }),
      })
    );
  });
});

// ─── media.ts ────────────────────────────────────────────

describe("media.reorderMedia — atomic + userId-scoped", () => {
  it("batches all position updates inside a single $transaction, each scoped by userId", async () => {
    prismaMock.media.findMany.mockResolvedValueOnce([{ id: "m1" }, { id: "m2" }, { id: "m3" }]);

    const { reorderMedia } = await import("../media");
    await reorderMedia("conv-1", ["m3", "m1", "m2"]);

    // Exactly one $transaction call, not N Promise.all writes
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    // Each updateMany carries userId in WHERE
    expect(prismaMock.media.updateMany).toHaveBeenCalledTimes(3);
    for (const call of prismaMock.media.updateMany.mock.calls) {
      expect(call[0].where).toEqual(expect.objectContaining({ userId: TEST_USER_ID }));
    }
    // Positions reflect the requested order
    const positionsById: Record<string, number> = {};
    for (const call of prismaMock.media.updateMany.mock.calls) {
      const id = (call[0].where as { id: string }).id;
      positionsById[id] = (call[0].data as { position: number }).position;
    }
    expect(positionsById).toEqual({ m3: 0, m1: 1, m2: 2 });
  });

  it("rejects an id set the current user does not fully own (no writes issued)", async () => {
    // Only 2 of the 3 requested ids are owned → precheck throws.
    prismaMock.media.findMany.mockResolvedValueOnce([{ id: "m1" }, { id: "m2" }]);

    const { reorderMedia } = await import("../media");
    await expect(reorderMedia("conv-1", ["m1", "m2", "m3-foreign"])).rejects.toThrow();

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.media.updateMany).not.toHaveBeenCalled();
  });
});

describe("media.updateMediaAlt — userId-scoped", () => {
  it("scopes the alt-text update by userId", async () => {
    prismaMock.media.findFirst.mockResolvedValueOnce({ id: "m1" });

    const { updateMediaAlt } = await import("../media");
    await updateMediaAlt("m1", "new alt");

    expect(prismaMock.media.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "m1", userId: TEST_USER_ID }),
        data: { alt: "new alt" },
      })
    );
  });
});

// ─── voice-bank.ts ───────────────────────────────────────

describe("voice-bank.removeVoiceBankEntry — userId-scoped", () => {
  it("scopes the delete by userId", async () => {
    prismaMock.voiceBankEntry.findFirst.mockResolvedValueOnce({ id: "vb-1" });

    const { removeVoiceBankEntry } = await import("../voice-bank");
    await removeVoiceBankEntry("vb-1");

    expect(prismaMock.voiceBankEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: "vb-1", userId: TEST_USER_ID },
    });
  });
});

// ─── plan-proposal.ts ────────────────────────────────────

describe("plan-proposal — userId-scoped state transitions", () => {
  it("acceptProposal updates scoped by userId AND status=PENDING", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValueOnce({
      id: "p-1",
      status: "PENDING",
      proposalType: "config",
      changes: [],
    });

    const { acceptProposal } = await import("../plan-proposal");
    await acceptProposal("p-1");

    expect(prismaMock.planProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          id: "p-1",
          userId: TEST_USER_ID,
          status: "PENDING",
        }),
        data: expect.objectContaining({ status: "ACCEPTED" }),
      })
    );
  });

  it("rejectProposal updates scoped by userId", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValueOnce({
      id: "p-1",
      status: "PENDING",
    });

    const { rejectProposal } = await import("../plan-proposal");
    await rejectProposal("p-1");

    expect(prismaMock.planProposal.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ id: "p-1", userId: TEST_USER_ID }),
        data: expect.objectContaining({ status: "REJECTED" }),
      })
    );
  });
});

// ─── notes.ts ────────────────────────────────────────────

describe("notes — writes constrained via conversation ownership filter", () => {
  beforeEach(() => {
    prismaMock.conversation.findFirst.mockResolvedValue({ id: "conv-1" });
  });

  it("removeNote uses a relational where that pins conversation.userId", async () => {
    const { removeNote } = await import("../notes");
    await removeNote("note-1", "conv-1");

    expect(prismaMock.note.deleteMany).toHaveBeenCalledWith({
      where: {
        id: "note-1",
        conversation: { id: "conv-1", userId: TEST_USER_ID },
      },
    });
  });

  it("updateNote uses a relational where that pins conversation.userId", async () => {
    const { updateNote } = await import("../notes");
    await updateNote("note-1", "new content", "conv-1");

    expect(prismaMock.note.updateMany).toHaveBeenCalledWith({
      where: {
        id: "note-1",
        conversation: { id: "conv-1", userId: TEST_USER_ID },
      },
      data: { content: "new content" },
    });
  });

  it("clearNotes uses a relational where that pins conversation.userId", async () => {
    const { clearNotes } = await import("../notes");
    await clearNotes("conv-1");

    expect(prismaMock.note.deleteMany).toHaveBeenCalledWith({
      where: {
        conversation: { id: "conv-1", userId: TEST_USER_ID },
      },
    });
  });
});
