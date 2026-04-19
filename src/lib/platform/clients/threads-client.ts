import { getThreadsApiTokenForUser } from "@/lib/server/threads-token";
import { prisma } from "@/lib/prisma";
import { threadsImporter } from "@/lib/threads-importer";
import { registerPlatform } from "../registry";
import type { PlatformTokenClient } from "../types";

// ADR-008 Phase 2: Threads now has both a token client and an importer.
// The cron wires them together via `listImportablePlatforms()`.
// Imports from `@/lib/server/threads-token` — never from the action file.

export const threadsTokenClient: PlatformTokenClient<"THREADS"> = {
  platform: "THREADS",
  async getForUser(userId) {
    const creds = await getThreadsApiTokenForUser(userId);
    if (!creds) return null;
    return { platform: "THREADS", ...creds };
  },
  async disconnect(userId) {
    await prisma.threadsApiToken.delete({ where: { userId } }).catch(() => {});
  },
};

registerPlatform({ token: threadsTokenClient, importer: threadsImporter });
