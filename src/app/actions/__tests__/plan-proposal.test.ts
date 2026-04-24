import { describe, it, expect, vi, beforeEach } from "vitest";

// Plan proposals bridge the strategist (who proposes config / schedule
// changes) and the scheduler (which applies them). `acceptProposal` is
// the critical-path action — it can write ScheduleConfig OR
// ScheduledSlot rows and then flips the proposal to ACCEPTED. Every
// Prisma call must carry `userId`; the precheck guards the accept path.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-plan-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
  requireUser: vi.fn().mockResolvedValue({ id: USER_ID, timezone: "UTC" }),
}));

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

// `SlotType` is imported as a value from @/generated/prisma — the mock
// must carry the enum members the action reads.
vi.mock("@/generated/prisma", () => ({
  SlotType: { POST: "POST", REPLY: "REPLY", THREAD: "THREAD", ARTICLE: "ARTICLE" },
}));

const prismaMock = vi.hoisted(() => ({
  planProposal: {
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  scheduledSlot: {
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
  // saveScheduleConfig (imported from @/app/actions/schedule) calls these,
  // but since we mock the schedule action module below we don't need them.
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const serverPlanProposalMock = vi.hoisted(() => ({
  savePlanProposal: vi.fn(),
  getAcceptedProposals: vi.fn(),
  getAcceptedProposalsList: vi.fn(),
  getAcceptedProposalDetails: vi.fn(),
  mapProposalRow: vi.fn((row: { id: string }) => ({ id: row.id, changes: [] })),
}));
vi.mock("@/lib/server/plan-proposal", () => serverPlanProposalMock);

const scheduleActionMock = vi.hoisted(() => ({
  getScheduleConfig: vi.fn(),
  saveScheduleConfig: vi.fn(),
}));
vi.mock("@/app/actions/schedule", () => scheduleActionMock);

import { revalidatePath } from "next/cache";
import {
  savePlanProposal,
  getPendingProposal,
  getAcceptedProposals,
  getAcceptedProposalsList,
  getAcceptedProposalDetails,
  acceptProposal,
  rejectProposal,
} from "../plan-proposal";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.planProposal.findFirst.mockResolvedValue(null);
  prismaMock.planProposal.updateMany.mockResolvedValue({ count: 1 });
  prismaMock.scheduledSlot.findFirst.mockResolvedValue(null);
  prismaMock.scheduledSlot.create.mockResolvedValue({ id: "slot-1" });
  prismaMock.scheduledSlot.deleteMany.mockResolvedValue({ count: 0 });
  serverPlanProposalMock.savePlanProposal.mockResolvedValue({
    id: "p1",
    changes: [],
  });
  serverPlanProposalMock.getAcceptedProposals.mockResolvedValue([]);
  serverPlanProposalMock.getAcceptedProposalsList.mockResolvedValue([]);
  serverPlanProposalMock.getAcceptedProposalDetails.mockResolvedValue(null);
  scheduleActionMock.getScheduleConfig.mockResolvedValue(null);
  scheduleActionMock.saveScheduleConfig.mockResolvedValue(undefined);
});

describe("savePlanProposal / read wrappers — forward userId", () => {
  it("savePlanProposal forwards (userId, data)", async () => {
    const data = { changes: [], summary: "s" };
    await savePlanProposal(data);
    expect(serverPlanProposalMock.savePlanProposal).toHaveBeenCalledWith(USER_ID, data);
  });

  it("getAcceptedProposals forwards (userId, days, platform?)", async () => {
    await getAcceptedProposals(7);
    expect(serverPlanProposalMock.getAcceptedProposals).toHaveBeenCalledWith(USER_ID, 7, undefined);

    await getAcceptedProposals(30, "X" as never);
    expect(serverPlanProposalMock.getAcceptedProposals).toHaveBeenCalledWith(USER_ID, 30, "X");
  });

  it("getAcceptedProposalsList forwards (userId, days, platform?)", async () => {
    await getAcceptedProposalsList(14);
    expect(serverPlanProposalMock.getAcceptedProposalsList).toHaveBeenCalledWith(
      USER_ID,
      14,
      undefined
    );
  });

  it("getAcceptedProposalDetails forwards (userId, id) — ownership enforced downstream", async () => {
    await getAcceptedProposalDetails("p-victim");
    expect(serverPlanProposalMock.getAcceptedProposalDetails).toHaveBeenCalledWith(
      USER_ID,
      "p-victim"
    );
  });
});

describe("getPendingProposal — userId scoping", () => {
  it("filters by userId + status:PENDING", async () => {
    await getPendingProposal();

    expect(prismaMock.planProposal.findFirst).toHaveBeenCalledWith({
      where: { userId: USER_ID, status: "PENDING" },
      orderBy: { createdAt: "desc" },
    });
  });

  it("returns null when no pending proposal exists", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue(null);
    const result = await getPendingProposal();
    expect(result).toBeNull();
  });

  it("maps the row via mapProposalRow when present", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
      changes: [],
    });
    const result = await getPendingProposal();
    expect(serverPlanProposalMock.mapProposalRow).toHaveBeenCalled();
    expect(result).toEqual({ id: "p-1", changes: [] });
  });
});

describe("acceptProposal — precheck + branch + state transition", () => {
  it("throws when no proposal matches (id, userId)", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue(null);

    await expect(acceptProposal("p-victim")).rejects.toThrow(
      "Proposal not found or already reviewed"
    );

    expect(prismaMock.planProposal.updateMany).not.toHaveBeenCalled();
    expect(scheduleActionMock.saveScheduleConfig).not.toHaveBeenCalled();
  });

  it("throws when proposal exists but status is not PENDING (already reviewed)", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "ACCEPTED",
      proposalType: "config",
      changes: [],
    });

    await expect(acceptProposal("p-1")).rejects.toThrow("Proposal not found or already reviewed");
  });

  it("precheck is scoped by (id, userId)", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
      proposalType: "config",
      changes: [],
    });

    await acceptProposal("p-1");

    expect(prismaMock.planProposal.findFirst).toHaveBeenCalledWith({
      where: { id: "p-1", userId: USER_ID },
    });
  });

  it("config branch: calls saveScheduleConfig and marks proposal ACCEPTED with userId+status guard", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
      proposalType: "config",
      changes: [],
    });
    scheduleActionMock.getScheduleConfig.mockResolvedValue(null);

    await acceptProposal("p-1");

    expect(scheduleActionMock.saveScheduleConfig).toHaveBeenCalledTimes(1);

    // Defense-in-depth: updateMany restates (userId, status:PENDING) in
    // the WHERE so a re-ordering regression can't lose either guard.
    expect(prismaMock.planProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "p-1", userId: USER_ID, status: "PENDING" },
      data: expect.objectContaining({ status: "ACCEPTED" }),
    });
  });

  it("schedule branch: creates ScheduledSlot rows scoped by userId", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
      proposalType: "schedule",
      changes: [
        {
          action: "add",
          date: "2026-04-20",
          timeSlot: "09:00",
          slotType: "Post",
        },
      ],
    });
    prismaMock.scheduledSlot.findFirst.mockResolvedValue(null);

    await acceptProposal("p-1");

    expect(prismaMock.scheduledSlot.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ userId: USER_ID, slotType: "POST" }),
      })
    );
    expect(prismaMock.scheduledSlot.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ userId: USER_ID, slotType: "POST", status: "EMPTY" }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/schedule");
  });

  it("schedule branch remove action: deleteMany scoped by userId", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
      proposalType: "schedule",
      changes: [
        {
          action: "remove",
          date: "2026-04-20",
          timeSlot: "09:00",
          slotType: "Post",
        },
      ],
    });

    await acceptProposal("p-1");

    expect(prismaMock.scheduledSlot.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        userId: USER_ID,
        slotType: "POST",
        status: "EMPTY",
      }),
    });
  });

  it("selectedIndices filters which changes apply", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
      proposalType: "schedule",
      changes: [
        { action: "add", date: "2026-04-20", timeSlot: "09:00", slotType: "Post" },
        { action: "add", date: "2026-04-21", timeSlot: "10:00", slotType: "Post" },
      ],
    });

    await acceptProposal("p-1", [1]);

    // Only index 1 is applied.
    expect(prismaMock.scheduledSlot.create).toHaveBeenCalledTimes(1);
  });

  it("ignores out-of-range indices in selectedIndices", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
      proposalType: "schedule",
      changes: [{ action: "add", date: "2026-04-20", timeSlot: "09:00", slotType: "Post" }],
    });

    // indices 1, 2, -1 are all out of range — should silently skip, not crash.
    await acceptProposal("p-1", [1, 2, -1]);

    expect(prismaMock.scheduledSlot.create).not.toHaveBeenCalled();
  });
});

describe("rejectProposal — precheck + scoped update", () => {
  it("throws when no proposal matches (id, userId)", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue(null);

    await expect(rejectProposal("p-victim")).rejects.toThrow("Proposal not found");

    expect(prismaMock.planProposal.updateMany).not.toHaveBeenCalled();
  });

  it("updateMany scopes by (id, userId) and revalidates /", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValue({
      id: "p-1",
      status: "PENDING",
    });

    await rejectProposal("p-1");

    expect(prismaMock.planProposal.updateMany).toHaveBeenCalledWith({
      where: { id: "p-1", userId: USER_ID },
      data: expect.objectContaining({ status: "REJECTED" }),
    });
    expect(revalidatePath).toHaveBeenCalledWith("/");
  });
});
