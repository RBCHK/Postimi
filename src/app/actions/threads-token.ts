"use server";

import { requireUserId } from "@/lib/auth";
import {
  getThreadsApiTokenForUser as _getThreadsApiTokenForUser,
  getThreadsConnectionStatus as _getThreadsConnectionStatus,
  getThreadsProfileForComposer as _getThreadsProfileForComposer,
  disconnectThreadsAccount as _disconnectThreadsAccount,
  type ThreadsApiCredentials,
} from "@/lib/server/threads-token";

// ADR-008 Phase 1b-security: all public Server Actions in this file go
// through `requireUserId()` first. Private helpers (userId-taking) live
// in `@/lib/server/threads-token` and are NOT exported from a "use server"
// file. Cron routes and webhooks import from `@/lib/server/threads-token`.

export type { ThreadsApiCredentials };

export async function getThreadsApiTokenForUser(): Promise<ThreadsApiCredentials | null> {
  const userId = await requireUserId();
  return _getThreadsApiTokenForUser(userId);
}

export async function getThreadsConnectionStatus(): Promise<{
  connected: boolean;
  threadsUsername?: string;
  connectedAt?: Date;
}> {
  const userId = await requireUserId();
  return _getThreadsConnectionStatus(userId);
}

export async function getThreadsProfileForComposer(): Promise<{
  displayName: string;
  avatarUrl: string | null;
} | null> {
  const userId = await requireUserId();
  return _getThreadsProfileForComposer(userId);
}

export async function disconnectThreadsAccount(): Promise<void> {
  const userId = await requireUserId();
  await _disconnectThreadsAccount(userId);
}
