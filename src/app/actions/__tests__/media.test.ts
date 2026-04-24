import { describe, it, expect, vi, beforeEach } from "vitest";

// Media actions are a cross-tenant leak risk — storage paths embed userId
// and Prisma rows carry userId. Every read/write must scope by userId, and
// reorder validation must refuse IDs that aren't owned by the caller.

vi.mock("@/lib/auth", () => ({ requireUserId: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  media: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
    updateMany: vi.fn(),
  },
  // `$transaction` simply awaits the array of operations in our use —
  // return all resolved values so the server action completes.
  $transaction: vi.fn().mockImplementation(async (ops: Promise<unknown>[]) => Promise.all(ops)),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

const serverMediaMock = vi.hoisted(() => ({
  getMediaForConversation: vi.fn(),
}));
vi.mock("@/lib/server/media", () => serverMediaMock);

import { requireUserId } from "@/lib/auth";
import { getMediaForConversation, reorderMedia, updateMediaAlt } from "../media";

const USER_ID = "user-media-1";

beforeEach(() => {
  vi.clearAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
  prismaMock.media.findMany.mockResolvedValue([]);
  prismaMock.media.findFirst.mockResolvedValue(null);
  prismaMock.media.updateMany.mockResolvedValue({ count: 1 });
  serverMediaMock.getMediaForConversation.mockResolvedValue([]);
});

describe("getMediaForConversation", () => {
  it("passes the authenticated userId to the shared server helper", async () => {
    await getMediaForConversation("conv-1");

    expect(requireUserId).toHaveBeenCalledTimes(1);
    expect(serverMediaMock.getMediaForConversation).toHaveBeenCalledWith("conv-1", USER_ID);
  });
});

describe("reorderMedia — userId scoping & validation", () => {
  it("reads existing media filtered by (conversationId, userId)", async () => {
    prismaMock.media.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);

    await reorderMedia("conv-1", ["m2", "m1"]);

    expect(prismaMock.media.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { conversationId: "conv-1", userId: USER_ID },
      })
    );
  });

  it("rejects an orderedIds array containing an ID the caller does not own", async () => {
    // Only m1/m2 exist for this user; attacker sends victim's mX.
    prismaMock.media.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);

    await expect(reorderMedia("conv-1", ["m1", "mX"])).rejects.toThrow(
      "Invalid media IDs for reorder"
    );

    // Critical: no update should have fired after the validation failure.
    expect(prismaMock.media.updateMany).not.toHaveBeenCalled();
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("rejects a length mismatch (partial reorder)", async () => {
    prismaMock.media.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);

    await expect(reorderMedia("conv-1", ["m1"])).rejects.toThrow("Invalid media IDs for reorder");

    expect(prismaMock.$transaction).not.toHaveBeenCalled();
  });

  it("updates every media row scoped by (id, userId) inside a transaction", async () => {
    prismaMock.media.findMany.mockResolvedValue([{ id: "m1" }, { id: "m2" }]);

    await reorderMedia("conv-1", ["m2", "m1"]);

    // Defense-in-depth: even after precheck, each updateMany must carry
    // userId so a compromised precheck can't open a cross-tenant write.
    expect(prismaMock.media.updateMany).toHaveBeenCalledTimes(2);
    expect(prismaMock.media.updateMany).toHaveBeenNthCalledWith(1, {
      where: { id: "m2", userId: USER_ID },
      data: { position: 0 },
    });
    expect(prismaMock.media.updateMany).toHaveBeenNthCalledWith(2, {
      where: { id: "m1", userId: USER_ID },
      data: { position: 1 },
    });
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
  });
});

describe("updateMediaAlt — userId scoping & precheck", () => {
  it("throws when the media row is not owned by the caller", async () => {
    prismaMock.media.findFirst.mockResolvedValue(null);

    await expect(updateMediaAlt("m1", "new alt")).rejects.toThrow("Media not found");

    // Critical: must abort before touching updateMany.
    expect(prismaMock.media.updateMany).not.toHaveBeenCalled();
  });

  it("precheck filters by (id, userId)", async () => {
    prismaMock.media.findFirst.mockResolvedValue({ id: "m1" });

    await updateMediaAlt("m1", "alt");

    expect(prismaMock.media.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ where: { id: "m1", userId: USER_ID } })
    );
  });

  it("updateMany is scoped by (id, userId) — defense-in-depth", async () => {
    prismaMock.media.findFirst.mockResolvedValue({ id: "m1" });

    await updateMediaAlt("m1", "alt");

    expect(prismaMock.media.updateMany).toHaveBeenCalledWith({
      where: { id: "m1", userId: USER_ID },
      data: { alt: "alt" },
    });
  });
});
