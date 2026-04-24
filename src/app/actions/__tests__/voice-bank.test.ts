import { describe, it, expect, vi, beforeEach } from "vitest";

// Voice bank entries carry a user's authored content — must stay scoped
// to the owning tenant. `removeVoiceBankEntry` also has a precheck that
// must fire before any write so a forged entry id can't delete another
// user's row.

const { USER_ID } = vi.hoisted(() => ({ USER_ID: "user-voice-1" }));

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(USER_ID),
}));

vi.mock("@/generated/prisma", () => ({
  VoiceBankType: { REPLY: "REPLY", POST: "POST" },
}));

const prismaMock = vi.hoisted(() => ({
  voiceBankEntry: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    create: vi.fn(),
    deleteMany: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

import { getVoiceBankEntries, addVoiceBankEntry, removeVoiceBankEntry } from "../voice-bank";

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.voiceBankEntry.findMany.mockResolvedValue([]);
  prismaMock.voiceBankEntry.findFirst.mockResolvedValue(null);
  prismaMock.voiceBankEntry.create.mockResolvedValue({ id: "v1" });
  prismaMock.voiceBankEntry.deleteMany.mockResolvedValue({ count: 1 });
});

describe("getVoiceBankEntries — userId scoping", () => {
  it("filters findMany by userId when no type is given", async () => {
    await getVoiceBankEntries();

    expect(prismaMock.voiceBankEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID } })
    );
  });

  it("adds the Prisma type filter to the userId scope", async () => {
    await getVoiceBankEntries("POST", 5);

    expect(prismaMock.voiceBankEntry.findMany).toHaveBeenCalledWith(
      expect.objectContaining({ where: { userId: USER_ID, type: "POST" } })
    );
  });

  it("applies the `limit` argument as Prisma `take`", async () => {
    await getVoiceBankEntries("REPLY", 3);

    const call = prismaMock.voiceBankEntry.findMany.mock.calls[0]![0];
    expect(call.take).toBe(3);
  });

  it("maps Prisma rows to app-shape types (REPLY → Reply, POST → Post)", async () => {
    prismaMock.voiceBankEntry.findMany.mockResolvedValue([
      {
        id: "v1",
        content: "body A",
        type: "REPLY",
        topic: "t1",
        createdAt: new Date("2026-04-01"),
      },
      {
        id: "v2",
        content: "body B",
        type: "POST",
        topic: null,
        createdAt: new Date("2026-04-02"),
      },
    ]);

    const rows = await getVoiceBankEntries();

    expect(rows).toEqual([
      {
        id: "v1",
        content: "body A",
        type: "Reply",
        topic: "t1",
        createdAt: new Date("2026-04-01"),
      },
      {
        id: "v2",
        content: "body B",
        type: "Post",
        topic: null,
        createdAt: new Date("2026-04-02"),
      },
    ]);
  });
});

describe("addVoiceBankEntry — userId on create", () => {
  it("creates a row with userId and the mapped Prisma type", async () => {
    await addVoiceBankEntry("my content", "POST", "topic-x");

    expect(prismaMock.voiceBankEntry.create).toHaveBeenCalledWith({
      data: {
        content: "my content",
        type: "POST",
        topic: "topic-x",
        userId: USER_ID,
      },
    });
  });

  it("propagates topic=undefined when omitted", async () => {
    await addVoiceBankEntry("c", "REPLY");

    expect(prismaMock.voiceBankEntry.create).toHaveBeenCalledWith({
      data: {
        content: "c",
        type: "REPLY",
        topic: undefined,
        userId: USER_ID,
      },
    });
  });
});

describe("removeVoiceBankEntry — precheck then scoped delete", () => {
  it("throws and does NOT delete when the id is not owned by the caller", async () => {
    prismaMock.voiceBankEntry.findFirst.mockResolvedValue(null);

    await expect(removeVoiceBankEntry("victim-entry")).rejects.toThrow("Entry not found");

    expect(prismaMock.voiceBankEntry.deleteMany).not.toHaveBeenCalled();
  });

  it("precheck is scoped by (id, userId)", async () => {
    prismaMock.voiceBankEntry.findFirst.mockResolvedValue({ id: "v1" });

    await removeVoiceBankEntry("v1");

    expect(prismaMock.voiceBankEntry.findFirst).toHaveBeenCalledWith({
      where: { id: "v1", userId: USER_ID },
    });
  });

  it("deleteMany is scoped by (id, userId) — defense-in-depth", async () => {
    prismaMock.voiceBankEntry.findFirst.mockResolvedValue({ id: "v1" });

    await removeVoiceBankEntry("v1");

    expect(prismaMock.voiceBankEntry.deleteMany).toHaveBeenCalledWith({
      where: { id: "v1", userId: USER_ID },
    });
  });
});
