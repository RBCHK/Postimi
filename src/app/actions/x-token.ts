"use server";

import { requireUserId } from "@/lib/auth";
import {
  getXApiTokenForUser as _getXApiTokenForUser,
  getXConnectionStatus as _getXConnectionStatus,
  getXProfileForComposer as _getXProfileForComposer,
  disconnectXAccount as _disconnectXAccount,
  hasMediaWriteScope as _hasMediaWriteScope,
  type XApiCredentials,
} from "@/lib/server/x-token";

// ADR-008 Phase 1b-security: all public Server Actions in this file go
// through `requireUserId()` first. Private helpers (userId-taking) live
// in `@/lib/server/x-token` and are NOT exported from a "use server"
// file. Cron routes and webhooks import from `@/lib/server/x-token`.
// Types are NOT re-exported — Next.js 15 RSC compiler rejects non-runtime
// exports from "use server" files. Consumers import from @/lib/server/*.

export async function getXApiTokenForUser(): Promise<XApiCredentials | null> {
  const userId = await requireUserId();
  return _getXApiTokenForUser(userId);
}

export async function getXConnectionStatus(): Promise<{
  connected: boolean;
  xUsername?: string;
  connectedAt?: Date;
}> {
  const userId = await requireUserId();
  return _getXConnectionStatus(userId);
}

export async function getXProfileForComposer(): Promise<{
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  verified: boolean;
} | null> {
  const userId = await requireUserId();
  return _getXProfileForComposer(userId);
}

export async function disconnectXAccount(): Promise<void> {
  const userId = await requireUserId();
  await _disconnectXAccount(userId);
}

export async function hasMediaWriteScope(): Promise<boolean> {
  const userId = await requireUserId();
  return _hasMediaWriteScope(userId);
}
