"use server";

import { requireUserId } from "@/lib/auth";
import {
  getLinkedInApiTokenForUser as _getLinkedInApiTokenForUser,
  getLinkedInConnectionStatus as _getLinkedInConnectionStatus,
  getLinkedInProfileForComposer as _getLinkedInProfileForComposer,
  disconnectLinkedInAccount as _disconnectLinkedInAccount,
  type LinkedInApiCredentials,
} from "@/lib/server/linkedin-token";

// ADR-008 Phase 1b-security: all public Server Actions in this file go
// through `requireUserId()` first. Private helpers (userId-taking) live
// in `@/lib/server/linkedin-token` and are NOT exported from a "use server"
// file. Cron routes and webhooks import from `@/lib/server/linkedin-token`.
// Types are NOT re-exported — Next.js 15 RSC compiler rejects non-runtime
// exports from "use server" files. Consumers import from @/lib/server/*.

export async function getLinkedInApiTokenForUser(): Promise<LinkedInApiCredentials | null> {
  const userId = await requireUserId();
  return _getLinkedInApiTokenForUser(userId);
}

export async function getLinkedInConnectionStatus(): Promise<{
  connected: boolean;
  linkedinName?: string;
  connectedAt?: Date;
}> {
  const userId = await requireUserId();
  return _getLinkedInConnectionStatus(userId);
}

export async function getLinkedInProfileForComposer(): Promise<{
  displayName: string;
  headline: string | null;
  avatarUrl: string | null;
} | null> {
  const userId = await requireUserId();
  return _getLinkedInProfileForComposer(userId);
}

export async function disconnectLinkedInAccount(): Promise<void> {
  const userId = await requireUserId();
  await _disconnectLinkedInAccount(userId);
}
