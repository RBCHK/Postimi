import { getXApiTokenForUser } from "@/lib/server/x-token";
import { prisma } from "@/lib/prisma";
import { registerPlatform } from "../registry";
import type { PlatformTokenClient } from "../types";

// Wraps the private x-token helpers in the unified `PlatformTokenClient`
// shape (ADR-008). Imports from `@/lib/server/x-token` — never from
// `@/app/actions/x-token`, because every export from a "use server" file
// becomes a public Server Action.

export const xTokenClient: PlatformTokenClient<"X"> = {
  platform: "X",
  async getForUser(userId) {
    const creds = await getXApiTokenForUser(userId);
    if (!creds) return null;
    return { platform: "X", ...creds };
  },
  async disconnect(userId) {
    await prisma.xApiToken.delete({ where: { userId } }).catch(() => {});
  },
};

registerPlatform({ token: xTokenClient });
