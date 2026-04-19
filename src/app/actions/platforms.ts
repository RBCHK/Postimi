"use server";

import { requireUserId } from "@/lib/auth";
import {
  getConnectedPlatforms as _getConnectedPlatforms,
  type ConnectedPlatforms,
} from "@/lib/server/platforms";

// Types are NOT re-exported — Next.js 15 RSC compiler rejects non-runtime
// exports from "use server" files. Consumers import from @/lib/server/platforms.

export async function getConnectedPlatforms(): Promise<ConnectedPlatforms> {
  const userId = await requireUserId();
  return _getConnectedPlatforms(userId);
}
