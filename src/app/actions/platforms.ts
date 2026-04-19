"use server";

import { requireUserId } from "@/lib/auth";
import {
  getConnectedPlatforms as _getConnectedPlatforms,
  type ConnectedPlatforms,
} from "@/lib/server/platforms";

export type { ConnectedPlatforms };

export async function getConnectedPlatforms(): Promise<ConnectedPlatforms> {
  const userId = await requireUserId();
  return _getConnectedPlatforms(userId);
}
