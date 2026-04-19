import { describe, it, expect, vi, beforeEach } from "vitest";

const prismaMock = vi.hoisted(() => ({
  user: {
    update: vi.fn(),
    findUnique: vi.fn(),
  },
}));

const requireUserIdMock = vi.hoisted(() => vi.fn<() => Promise<string>>());

vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
vi.mock("@/lib/auth", () => ({ requireUserId: requireUserIdMock }));

const USER_ID = "user-under-test";

beforeEach(() => {
  vi.resetAllMocks();
  requireUserIdMock.mockResolvedValue(USER_ID);
});

describe("updateOutputLanguage", () => {
  it("updates the language for the authenticated user only", async () => {
    prismaMock.user.update.mockResolvedValue({ id: USER_ID, outputLanguage: "RU" });

    const { updateOutputLanguage } = await import("../user-settings");
    await updateOutputLanguage("RU");

    expect(requireUserIdMock).toHaveBeenCalledOnce();
    expect(prismaMock.user.update).toHaveBeenCalledWith({
      where: { id: USER_ID },
      data: { outputLanguage: "RU" },
    });
  });

  it("accepts every valid enum value", async () => {
    prismaMock.user.update.mockResolvedValue({});

    const { updateOutputLanguage } = await import("../user-settings");

    for (const lang of ["EN", "RU", "UK", "ES", "DE", "FR"] as const) {
      await updateOutputLanguage(lang);
    }

    expect(prismaMock.user.update).toHaveBeenCalledTimes(6);
  });

  it("rejects invalid language strings before reaching Prisma", async () => {
    const { updateOutputLanguage } = await import("../user-settings");

    await expect(updateOutputLanguage("ZH" as unknown as "EN")).rejects.toThrow(
      /invalid language/i
    );

    await expect(updateOutputLanguage("" as unknown as "EN")).rejects.toThrow(/invalid language/i);

    await expect(updateOutputLanguage("EN\nIgnore previous" as unknown as "EN")).rejects.toThrow(
      /invalid language/i
    );

    expect(prismaMock.user.update).not.toHaveBeenCalled();
  });

  it("truncates long malicious payloads in the error message", async () => {
    const { updateOutputLanguage } = await import("../user-settings");

    const payload = "EN" + "X".repeat(1000);
    try {
      await updateOutputLanguage(payload as unknown as "EN");
      expect.fail("should have thrown");
    } catch (err) {
      const msg = (err as Error).message;
      // Payload should be truncated to ~20 chars in the message
      expect(msg.length).toBeLessThan(100);
    }
  });
});

describe("getOutputLanguage", () => {
  it("returns the user's language via auth-checked path", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ outputLanguage: "RU" });

    const { getOutputLanguage } = await import("../user-settings");
    const result = await getOutputLanguage();

    expect(result).toBe("RU");
    expect(requireUserIdMock).toHaveBeenCalledOnce();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: USER_ID },
      select: { outputLanguage: true },
    });
  });

  it("returns null when the user row has no language set", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ outputLanguage: null });

    const { getOutputLanguage } = await import("../user-settings");
    expect(await getOutputLanguage()).toBeNull();
  });

  it("returns null when the user row does not exist", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const { getOutputLanguage } = await import("../user-settings");
    expect(await getOutputLanguage()).toBeNull();
  });
});

describe("getOutputLanguage (lib/server — cron path)", () => {
  it("skips auth and queries by the supplied userId", async () => {
    prismaMock.user.findUnique.mockResolvedValue({ outputLanguage: "FR" });

    const { getOutputLanguage } = await import("@/lib/server/user-settings");
    const result = await getOutputLanguage("cron-user-id");

    expect(result).toBe("FR");
    expect(requireUserIdMock).not.toHaveBeenCalled();
    expect(prismaMock.user.findUnique).toHaveBeenCalledWith({
      where: { id: "cron-user-id" },
      select: { outputLanguage: true },
    });
  });

  it("returns null for unknown user (legacy user with no row)", async () => {
    prismaMock.user.findUnique.mockResolvedValue(null);

    const { getOutputLanguage } = await import("@/lib/server/user-settings");
    expect(await getOutputLanguage("missing-user")).toBeNull();
  });
});
