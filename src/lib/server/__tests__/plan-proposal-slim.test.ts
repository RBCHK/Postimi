import { describe, it, expect, vi, beforeEach } from "vitest";

// Guards Track G Fix 5: `getAcceptedProposalsList` must omit the heavy
// `changes` JSON and `metricsSnapshot` columns, and
// `getAcceptedProposalDetails` must always filter by userId + ACCEPTED
// status so a foreign id never leaks a row.

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

const prismaMock = vi.hoisted(() => ({
  planProposal: {
    findMany: vi.fn(),
    findFirst: vi.fn(),
  },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));

beforeEach(() => {
  vi.clearAllMocks();
  prismaMock.planProposal.findMany.mockResolvedValue([]);
  prismaMock.planProposal.findFirst.mockResolvedValue(null);
});

describe("getAcceptedProposalsList — slim projection", () => {
  it("selects only list-view fields and omits `changes` / `metricsSnapshot`", async () => {
    const { getAcceptedProposalsList } = await import("../plan-proposal");
    await getAcceptedProposalsList("user-1", 30);

    const args = prismaMock.planProposal.findMany.mock.calls[0]![0];
    expect(args.select).toEqual({
      id: true,
      platform: true,
      status: true,
      proposalType: true,
      summary: true,
      analysisId: true,
      createdAt: true,
      reviewedAt: true,
    });
    expect(args.select).not.toHaveProperty("changes");
    expect(args.select).not.toHaveProperty("metricsSnapshot");
  });

  it("filters by userId, ACCEPTED status, and the last N days", async () => {
    const { getAcceptedProposalsList } = await import("../plan-proposal");
    await getAcceptedProposalsList("user-1", 7);

    const args = prismaMock.planProposal.findMany.mock.calls[0]![0];
    expect(args.where.userId).toBe("user-1");
    expect(args.where.status).toBe("ACCEPTED");
    expect(args.where.reviewedAt.gte).toBeInstanceOf(Date);
    // ~7 days ago, within a generous tolerance (seconds of drift are
    // fine; the test runs in <1s but clock skew is real on CI).
    const sinceMs = (args.where.reviewedAt.gte as Date).getTime();
    const diffDays = (Date.now() - sinceMs) / (24 * 60 * 60 * 1000);
    expect(diffDays).toBeGreaterThan(6.99);
    expect(diffDays).toBeLessThan(7.01);
  });

  it("passes through the optional platform filter when provided", async () => {
    const { getAcceptedProposalsList } = await import("../plan-proposal");
    await getAcceptedProposalsList("user-1", 30, "LINKEDIN");

    const args = prismaMock.planProposal.findMany.mock.calls[0]![0];
    expect(args.where.platform).toBe("LINKEDIN");
  });

  it("maps rows to the PlanProposalListItem shape", async () => {
    const created = new Date("2026-04-01");
    const reviewed = new Date("2026-04-02");
    prismaMock.planProposal.findMany.mockResolvedValueOnce([
      {
        id: "p-1",
        platform: "X",
        status: "ACCEPTED",
        proposalType: "config",
        summary: "Try Tuesdays at 9:00",
        analysisId: null,
        createdAt: created,
        reviewedAt: reviewed,
      },
    ]);

    const { getAcceptedProposalsList } = await import("../plan-proposal");
    const result = await getAcceptedProposalsList("user-1", 30);

    expect(result).toEqual([
      {
        id: "p-1",
        platform: "X",
        status: "accepted",
        proposalType: "config",
        summary: "Try Tuesdays at 9:00",
        analysisId: undefined,
        createdAt: created,
        reviewedAt: reviewed,
      },
    ]);
  });
});

describe("getAcceptedProposalDetails — scoped detail fetch", () => {
  it("filters by id + userId + ACCEPTED status so a foreign id returns null", async () => {
    const { getAcceptedProposalDetails } = await import("../plan-proposal");
    await getAcceptedProposalDetails("user-1", "p-cross-tenant");

    const args = prismaMock.planProposal.findFirst.mock.calls[0]![0];
    expect(args.where).toEqual({
      id: "p-cross-tenant",
      userId: "user-1",
      status: "ACCEPTED",
    });
  });

  it("returns null when the row is missing (cross-tenant or deleted)", async () => {
    prismaMock.planProposal.findFirst.mockResolvedValueOnce(null);

    const { getAcceptedProposalDetails } = await import("../plan-proposal");
    const result = await getAcceptedProposalDetails("user-1", "p-missing");

    expect(result).toBeNull();
  });

  it("returns the full PlanProposalItem shape (including `changes` + `metricsSnapshot`) when found", async () => {
    const created = new Date("2026-04-01");
    prismaMock.planProposal.findFirst.mockResolvedValueOnce({
      id: "p-1",
      platform: "X",
      status: "ACCEPTED",
      proposalType: "config",
      changes: [{ action: "add", section: "posts", time: "09:00", days: { Mon: true } }],
      summary: "Move morning post",
      analysisId: "sa-9",
      metricsSnapshot: { avgImpressions: 500, newFollowersPerWeek: 3, engagementRate: 1.2 },
      createdAt: created,
    });

    const { getAcceptedProposalDetails } = await import("../plan-proposal");
    const result = await getAcceptedProposalDetails("user-1", "p-1");

    expect(result).not.toBeNull();
    expect(result!.id).toBe("p-1");
    expect(result!.changes).toHaveLength(1);
    expect(result!.metricsSnapshot).toBeDefined();
    expect(result!.analysisId).toBe("sa-9");
  });
});
