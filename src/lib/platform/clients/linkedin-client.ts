import { getLinkedInApiTokenForUser } from "@/lib/server/linkedin-token";
import { prisma } from "@/lib/prisma";
import { registerPlatform } from "../registry";
import type { PlatformTokenClient } from "../types";

// LinkedIn has no `PlatformImporter` — analytics come from CSV upload,
// not the API (see ADR-008 for the `r_member_social` scope rationale).
// Imports from `@/lib/server/linkedin-token` so this file can be loaded
// by cron/webhook code without tripping the Server Action boundary.

export const linkedinTokenClient: PlatformTokenClient<"LINKEDIN"> = {
  platform: "LINKEDIN",
  async getForUser(userId) {
    const creds = await getLinkedInApiTokenForUser(userId);
    if (!creds) return null;
    return { platform: "LINKEDIN", ...creds };
  },
  async disconnect(userId) {
    await prisma.linkedInApiToken.delete({ where: { userId } }).catch(() => {});
  },
};

registerPlatform({ token: linkedinTokenClient });
