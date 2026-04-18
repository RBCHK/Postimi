import { afterEach, describe, expect, it, vi } from "vitest";
import type { Platform } from "@/lib/types";
import type { PlatformImporter, PlatformTokenClient } from "../types";

// Isolate the registry singleton between the two describe blocks —
// importing `./init` in the second block must not leak fake clients
// across suites.
afterEach(() => {
  vi.resetModules();
});

describe("registry — contract with fake clients", () => {
  it("register + get round-trips the entry", async () => {
    const { registerPlatform, getPlatform } = await import("../registry");

    const fakeToken: PlatformTokenClient<"X"> = {
      platform: "X",
      async getForUserInternal() {
        return null;
      },
      async disconnect() {},
    };
    registerPlatform({ token: fakeToken });

    const entry = getPlatform("X");
    expect(entry).toBeDefined();
    expect(entry?.token.platform).toBe("X");
    expect(entry?.importer).toBeUndefined();
  });

  it("listPlatforms includes every registered platform", async () => {
    const { registerPlatform, listPlatforms } = await import("../registry");

    const platforms: Platform[] = ["X", "LINKEDIN", "THREADS"];
    for (const p of platforms) {
      registerPlatform({
        token: {
          platform: p,
          async getForUserInternal() {
            return null;
          },
          async disconnect() {},
        } as PlatformTokenClient,
      });
    }

    const tags = listPlatforms().map((e) => e.token.platform);
    for (const p of platforms) expect(tags).toContain(p);
  });

  it("listImportablePlatforms excludes entries without importer", async () => {
    const { registerPlatform, listImportablePlatforms } = await import("../registry");

    const xImporter: PlatformImporter<"X"> = {
      platform: "X",
      async *fetchPosts() {},
      async fetchFollowers() {
        return {
          platform: "X",
          date: new Date(),
          followersCount: 0,
          followingCount: null,
        };
      },
    };

    registerPlatform({
      token: {
        platform: "X",
        async getForUserInternal() {
          return null;
        },
        async disconnect() {},
      },
      importer: xImporter,
    });
    registerPlatform({
      token: {
        platform: "LINKEDIN",
        async getForUserInternal() {
          return null;
        },
        async disconnect() {},
      },
      // no importer — LinkedIn is CSV-only
    });

    const importable = listImportablePlatforms().map((e) => e.token.platform);
    expect(importable).toContain("X");
    expect(importable).not.toContain("LINKEDIN");
  });

  it("register replaces a prior entry for the same platform", async () => {
    const { registerPlatform, getPlatform } = await import("../registry");

    const first: PlatformTokenClient<"X"> = {
      platform: "X",
      async getForUserInternal() {
        return null;
      },
      async disconnect() {},
    };
    const second: PlatformTokenClient<"X"> = {
      platform: "X",
      async getForUserInternal() {
        return { platform: "X", accessToken: "t", xUserId: "u", xUsername: "n" };
      },
      async disconnect() {},
    };
    registerPlatform({ token: first });
    registerPlatform({ token: second });

    const creds = await getPlatform("X")?.token.getForUserInternal("anyone");
    expect(creds?.accessToken).toBe("t");
  });

  it("getPlatform returns undefined for unregistered platform", async () => {
    const { getPlatform } = await import("../registry");
    expect(getPlatform("THREADS")).toBeUndefined();
  });
});

describe("registry — real wiring via init", () => {
  it("importing init registers all three platforms", async () => {
    // Mock every transitive server-action dependency so init.ts can load
    // without hitting Prisma.
    vi.doMock("@/lib/prisma", () => ({
      prisma: {
        xApiToken: { delete: vi.fn().mockResolvedValue(undefined) },
        linkedInApiToken: { delete: vi.fn().mockResolvedValue(undefined) },
        threadsApiToken: { delete: vi.fn().mockResolvedValue(undefined) },
      },
    }));
    vi.doMock("@/lib/auth", () => ({
      requireUserId: vi.fn().mockResolvedValue("user-1"),
    }));
    vi.doMock("@/lib/token-encryption", () => ({
      encryptToken: (s: string) => s,
      decryptToken: (s: string) => s,
    }));
    vi.doMock("@/app/actions/x-token", () => ({
      getXApiTokenForUserInternal: vi.fn().mockResolvedValue(null),
      disconnectXAccount: vi.fn().mockResolvedValue(undefined),
    }));
    vi.doMock("@/app/actions/linkedin-token", () => ({
      getLinkedInApiTokenForUserInternal: vi.fn().mockResolvedValue(null),
    }));
    vi.doMock("@/app/actions/threads-token", () => ({
      getThreadsApiTokenForUserInternal: vi.fn().mockResolvedValue(null),
    }));

    await import("../init");
    const { listPlatforms } = await import("../registry");

    const tags = listPlatforms().map((e) => e.token.platform);
    expect(tags).toContain("X");
    expect(tags).toContain("LINKEDIN");
    expect(tags).toContain("THREADS");
    expect(tags.length).toBe(3);
  });
});
