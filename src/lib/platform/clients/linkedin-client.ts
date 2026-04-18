import { getLinkedInApiTokenForUserInternal } from "@/app/actions/linkedin-token";
import { prisma } from "@/lib/prisma";
import { registerPlatform } from "../registry";
import type { PlatformTokenClient } from "../types";

// LinkedIn has no `PlatformImporter` — analytics come from CSV upload,
// not the API (see ADR-008 for the `r_member_social` scope rationale).

export const linkedinTokenClient: PlatformTokenClient<"LINKEDIN"> = {
  platform: "LINKEDIN",
  async getForUserInternal(userId) {
    const creds = await getLinkedInApiTokenForUserInternal(userId);
    if (!creds) return null;
    return { platform: "LINKEDIN", ...creds };
  },
  async disconnect(userId) {
    await prisma.linkedInApiToken.delete({ where: { userId } }).catch(() => {});
  },
};

registerPlatform({ token: linkedinTokenClient });
