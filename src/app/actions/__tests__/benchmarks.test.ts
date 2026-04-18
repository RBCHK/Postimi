import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  platformBenchmark: {
    findMany: vi.fn(),
    upsert: vi.fn(),
    delete: vi.fn(),
  },
}));

const requireAdminMock = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ requireAdmin: requireAdminMock }));

beforeEach(() => {
  vi.resetAllMocks();
  requireAdminMock.mockResolvedValue("admin-user-id");
});

describe("getBenchmarks (public read)", () => {
  it("queries by (platform, audienceSize) and maps rows", async () => {
    prismaMock.platformBenchmark.findMany.mockResolvedValue([
      {
        platform: "X",
        audienceSize: "NANO",
        metric: "engagement_rate",
        strongThreshold: 2.5,
        avgThreshold: 1.0,
        weakThreshold: 0.3,
        source: "src",
        sourceUrl: "https://example",
      },
    ]);
    const { getBenchmarks } = await import("../benchmarks");
    const rows = await getBenchmarks("X", "NANO");
    expect(prismaMock.platformBenchmark.findMany).toHaveBeenCalledWith({
      where: { platform: "X", audienceSize: "NANO" },
      orderBy: { metric: "asc" },
    });
    expect(rows).toEqual([
      {
        platform: "X",
        audienceSize: "NANO",
        metric: "engagement_rate",
        thresholds: { strong: 2.5, avg: 1.0, weak: 0.3 },
        source: "src",
        sourceUrl: "https://example",
      },
    ]);
  });

  it("returns empty array when no rows match", async () => {
    prismaMock.platformBenchmark.findMany.mockResolvedValue([]);
    const { getBenchmarks } = await import("../benchmarks");
    const rows = await getBenchmarks("THREADS", "MACRO");
    expect(rows).toEqual([]);
  });
});

describe("getBenchmarksInternal (cron path)", () => {
  it("skips admin check", async () => {
    prismaMock.platformBenchmark.findMany.mockResolvedValue([]);
    const { getBenchmarksInternal } = await import("../benchmarks");
    await getBenchmarksInternal("LINKEDIN", "MID");
    expect(requireAdminMock).not.toHaveBeenCalled();
  });
});

describe("upsertBenchmark (admin-only write)", () => {
  const validInput = {
    platform: "X" as const,
    audienceSize: "NANO" as const,
    metric: "engagement_rate",
    strongThreshold: 2.5,
    avgThreshold: 1.0,
    weakThreshold: 0.3,
    source: "Rival IQ 2025",
    sourceUrl: "https://rivaliq.com/benchmarks",
  };

  it("calls requireAdmin before writing", async () => {
    prismaMock.platformBenchmark.upsert.mockResolvedValue({
      ...validInput,
    });
    const { upsertBenchmark } = await import("../benchmarks");
    await upsertBenchmark(validInput);
    expect(requireAdminMock).toHaveBeenCalledOnce();
    expect(prismaMock.platformBenchmark.upsert).toHaveBeenCalled();
  });

  it("blocks writes when requireAdmin rejects (non-admin user)", async () => {
    requireAdminMock.mockRejectedValue(new Error("redirected"));
    const { upsertBenchmark } = await import("../benchmarks");
    await expect(upsertBenchmark(validInput)).rejects.toThrow();
    expect(prismaMock.platformBenchmark.upsert).not.toHaveBeenCalled();
  });

  it("rejects inverted thresholds (strong < avg)", async () => {
    const { upsertBenchmark } = await import("../benchmarks");
    await expect(
      upsertBenchmark({ ...validInput, strongThreshold: 0.5, avgThreshold: 1.0 })
    ).rejects.toThrow(/threshold ordering/i);
  });

  it("rejects inverted thresholds (avg < weak)", async () => {
    const { upsertBenchmark } = await import("../benchmarks");
    await expect(
      upsertBenchmark({ ...validInput, avgThreshold: 0.1, weakThreshold: 0.3 })
    ).rejects.toThrow(/threshold ordering/i);
  });

  it("upserts with composite unique key", async () => {
    prismaMock.platformBenchmark.upsert.mockResolvedValue({ ...validInput });
    const { upsertBenchmark } = await import("../benchmarks");
    await upsertBenchmark(validInput);
    expect(prismaMock.platformBenchmark.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          platform_audienceSize_metric: {
            platform: "X",
            audienceSize: "NANO",
            metric: "engagement_rate",
          },
        },
      })
    );
  });
});

describe("deleteBenchmark (admin-only)", () => {
  it("requires admin", async () => {
    prismaMock.platformBenchmark.delete.mockResolvedValue({});
    const { deleteBenchmark } = await import("../benchmarks");
    await deleteBenchmark("row-id");
    expect(requireAdminMock).toHaveBeenCalledOnce();
    expect(prismaMock.platformBenchmark.delete).toHaveBeenCalledWith({
      where: { id: "row-id" },
    });
  });

  it("blocks non-admin", async () => {
    requireAdminMock.mockRejectedValue(new Error("redirected"));
    const { deleteBenchmark } = await import("../benchmarks");
    await expect(deleteBenchmark("x")).rejects.toThrow();
    expect(prismaMock.platformBenchmark.delete).not.toHaveBeenCalled();
  });
});
