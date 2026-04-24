import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// ─── Mocks ─────────────────────────────────────────────────
//
// Guards the Track G perf fix: `DELETE /api/media/[id]` previously
// queried the remaining rows and issued one UPDATE per row in parallel.
// The new implementation must collapse to exactly one transaction
// containing (a) `deleteMany` for the row and (b) one `$executeRaw`
// shifting positions of everything after it. A regression that
// reintroduces the findMany + per-row update loop is observable here.

const TEST_USER_ID = "user-1";

vi.mock("@/lib/auth", () => ({
  requireUserId: vi.fn().mockResolvedValue(TEST_USER_ID),
}));

// Supabase storage is a non-critical side effect — mock it out.
vi.mock("@/lib/supabase", () => ({
  getSupabase: () => ({
    storage: {
      from: () => ({
        remove: vi.fn().mockResolvedValue({ data: null, error: null }),
      }),
    },
  }),
  MEDIA_BUCKET: "media-test",
}));

const prismaMock = vi.hoisted(() => ({
  media: {
    findFirst: vi.fn(),
    // Kept on the mock so a regression that calls findMany/update makes
    // the test fail loudly (`toHaveBeenCalled` assertions catch it).
    findMany: vi.fn(),
    update: vi.fn(),
    deleteMany: vi.fn().mockResolvedValue({ count: 1 }),
  },
  $executeRaw: vi.fn().mockResolvedValue(0),
  $transaction: vi.fn(),
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.$transaction.mockImplementation(async (ops: unknown[]) => {
    // Simulate Prisma's behaviour: execute each operation in the array
    // in order and return the resolved results. We don't actually run
    // the raw SQL — our concern is that the caller shaped the
    // transaction correctly.
    const results: unknown[] = [];
    for (const op of ops) {
      results.push(await op);
    }
    return results;
  });
});

function req(id: string) {
  return new NextRequest(`https://app.postimi.com/api/media/${id}`, { method: "DELETE" });
}

function params(id: string) {
  return { params: Promise.resolve({ id }) };
}

describe("DELETE /api/media/[id] — position shift", () => {
  it("returns 404 when the media is not owned by the caller", async () => {
    prismaMock.media.findFirst.mockResolvedValueOnce(null);

    const { DELETE } = await import("../route");
    const res = await DELETE(req("m-foreign"), params("m-foreign"));

    expect(res.status).toBe(404);
    // Not-found path must never touch the write side of the DB.
    expect(prismaMock.$transaction).not.toHaveBeenCalled();
    expect(prismaMock.media.deleteMany).not.toHaveBeenCalled();
  });

  it("issues exactly one transaction with a deleteMany + one $executeRaw (no per-row updates)", async () => {
    prismaMock.media.findFirst.mockResolvedValueOnce({
      id: "m-2",
      userId: TEST_USER_ID,
      conversationId: "conv-1",
      storageKey: "uploads/foo.png",
      thumbnailUrl: null,
      position: 1, // delete the middle of a 4-row run (positions 0..3)
    });

    const { DELETE } = await import("../route");
    const res = await DELETE(req("m-2"), params("m-2"));

    expect(res.status).toBe(200);
    // Exactly one transaction — no fan-out of per-row updates.
    expect(prismaMock.$transaction).toHaveBeenCalledTimes(1);
    const txOps = prismaMock.$transaction.mock.calls[0]![0];
    expect(Array.isArray(txOps)).toBe(true);
    expect(txOps.length).toBe(2);

    // The deleteMany was invoked with userId defense-in-depth.
    expect(prismaMock.media.deleteMany).toHaveBeenCalledWith({
      where: { id: "m-2", userId: TEST_USER_ID },
    });

    // The raw UPDATE was invoked once (not once per row).
    expect(prismaMock.$executeRaw).toHaveBeenCalledTimes(1);

    // Regression guards: the old implementation used findMany + per-row
    // update. Both should be untouched.
    expect(prismaMock.media.findMany).not.toHaveBeenCalled();
    expect(prismaMock.media.update).not.toHaveBeenCalled();
  });

  it("passes the deleted row's position, conversationId, and userId into $executeRaw for scoping", async () => {
    prismaMock.media.findFirst.mockResolvedValueOnce({
      id: "m-delete",
      userId: TEST_USER_ID,
      conversationId: "conv-9",
      storageKey: "uploads/bar.png",
      thumbnailUrl: null,
      position: 2,
    });

    const { DELETE } = await import("../route");
    await DELETE(req("m-delete"), params("m-delete"));

    // $executeRaw receives a template strings array followed by the
    // interpolated values. The order we care about: conversationId,
    // userId, position. Prisma treats the tagged template verbatim.
    const call = prismaMock.$executeRaw.mock.calls[0]!;
    // First arg is the TemplateStringsArray (Prisma's Sql template).
    // Remaining args are the substitutions, preserving order.
    const substitutions = call.slice(1);
    expect(substitutions).toEqual(["conv-9", TEST_USER_ID, 2]);
  });
});
