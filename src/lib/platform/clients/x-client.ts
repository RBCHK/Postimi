import { getXApiTokenForUserInternal, disconnectXAccount } from "@/app/actions/x-token";
import { prisma } from "@/lib/prisma";
import { registerPlatform } from "../registry";
import type { PlatformTokenClient } from "../types";

// Wraps the existing x-token server actions in the unified
// `PlatformTokenClient` shape (ADR-008). Adds the `platform: "X"` tag
// that the type system needs to rule out cross-platform misuse, and
// exposes `disconnect` that bypasses `requireUserId()` so cron code can
// clean up revoked tokens.

export const xTokenClient: PlatformTokenClient<"X"> = {
  platform: "X",
  async getForUserInternal(userId) {
    const creds = await getXApiTokenForUserInternal(userId);
    if (!creds) return null;
    return { platform: "X", ...creds };
  },
  async disconnect(userId) {
    // `disconnectXAccount` in the server-action file requires an
    // authenticated Clerk session; cron jobs have none. Delete directly.
    await prisma.xApiToken.delete({ where: { userId } }).catch(() => {});
  },
};

// Keep `disconnectXAccount` in the import graph so tree-shakers don't
// flag it as unused — it's the UI entry point.
void disconnectXAccount;

registerPlatform({ token: xTokenClient });
