import { getThreadsApiTokenForUserInternal } from "@/app/actions/threads-token";
import { prisma } from "@/lib/prisma";
import { registerPlatform } from "../registry";
import type { PlatformTokenClient } from "../types";

// Threads gets a `PlatformImporter` in Phase 2 (Threads Insights API).
// Phase 0 registers the token client only.

export const threadsTokenClient: PlatformTokenClient<"THREADS"> = {
  platform: "THREADS",
  async getForUserInternal(userId) {
    const creds = await getThreadsApiTokenForUserInternal(userId);
    if (!creds) return null;
    return { platform: "THREADS", ...creds };
  },
  async disconnect(userId) {
    await prisma.threadsApiToken.delete({ where: { userId } }).catch(() => {});
  },
};

registerPlatform({ token: threadsTokenClient });
