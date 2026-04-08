"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { encryptToken, decryptToken } from "@/lib/token-encryption";

export interface ThreadsApiCredentials {
  accessToken: string;
  threadsUserId: string;
  threadsUsername: string;
}

interface ThreadsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ThreadsUserProfile {
  id: string;
  username: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}

// ─── Internal helpers (no auth check — for cron routes) ─────

/**
 * Get valid Threads API credentials for a specific user.
 * Auto-refreshes if token is within 7 days of expiry (long-lived tokens last 60 days).
 * Returns null if user has no connected Threads account.
 */
export async function getThreadsApiTokenForUserInternal(
  userId: string
): Promise<ThreadsApiCredentials | null> {
  const token = await prisma.threadsApiToken.findUnique({ where: { userId } });
  if (!token) return null;

  const now = new Date();
  const sevenDaysFromNow = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);

  if (token.expiresAt > sevenDaysFromNow) {
    return {
      accessToken: decryptToken(token.accessToken),
      threadsUserId: token.threadsUserId,
      threadsUsername: token.threadsUsername,
    };
  }

  // Token expiring within 7 days — refresh
  return refreshThreadsToken(userId, token.accessToken, token.updatedAt);
}

/**
 * Refresh a long-lived Threads token.
 * Threads tokens are refreshed in-place (no separate refresh token).
 * Uses optimistic lock (updatedAt check) to prevent race conditions.
 */
async function refreshThreadsToken(
  userId: string,
  encryptedAccessToken: string,
  expectedUpdatedAt: Date
): Promise<ThreadsApiCredentials | null> {
  // Re-read to check if another process already refreshed
  const current = await prisma.threadsApiToken.findUnique({ where: { userId } });
  if (!current) return null;

  if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    const sevenDaysFromNow = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000);
    if (current.expiresAt > sevenDaysFromNow) {
      return {
        accessToken: decryptToken(current.accessToken),
        threadsUserId: current.threadsUserId,
        threadsUsername: current.threadsUsername,
      };
    }
  }

  const accessToken = decryptToken(encryptedAccessToken);

  let tokenData: ThreadsTokenResponse;
  try {
    tokenData = await exchangeForRefreshedToken(accessToken);
  } catch (err) {
    // One retry with 1s backoff for transient errors
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      tokenData = await exchangeForRefreshedToken(accessToken);
    } catch {
      console.error(`[threads-token] refresh failed for user ${userId}, deleting token:`, err);
      await prisma.threadsApiToken.delete({ where: { userId } }).catch(() => {});
      return null;
    }
  }

  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  await prisma.threadsApiToken.update({
    where: { userId },
    data: {
      accessToken: encryptToken(tokenData.access_token),
      expiresAt,
    },
  });

  return {
    accessToken: tokenData.access_token,
    threadsUserId: current.threadsUserId,
    threadsUsername: current.threadsUsername,
  };
}

async function exchangeForRefreshedToken(accessToken: string): Promise<ThreadsTokenResponse> {
  const params = new URLSearchParams({
    grant_type: "th_refresh_token",
    access_token: accessToken,
  });

  const res = await fetch(`https://graph.threads.net/refresh_access_token?${params.toString()}`);

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Threads token refresh failed ${res.status}: ${body}`);
  }

  return res.json() as Promise<ThreadsTokenResponse>;
}

// ─── Auth-checked actions (for UI / server actions) ──────

/** Save tokens after OAuth callback */
export async function saveThreadsApiToken(
  userId: string,
  tokenData: { access_token: string; expires_in: number },
  profile: ThreadsUserProfile
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  const profileData = {
    threadsUserId: profile.id,
    threadsUsername: profile.username,
    threadsProfilePictureUrl: profile.threads_profile_picture_url ?? null,
    threadsBiography: profile.threads_biography ?? null,
  };

  await prisma.threadsApiToken.upsert({
    where: { userId },
    create: {
      userId,
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      expiresAt,
      scopes: "threads_basic,threads_content_publish",
    },
    update: {
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      expiresAt,
      scopes: "threads_basic,threads_content_publish",
    },
  });
}

/** Get Threads connection status for current user */
export async function getThreadsConnectionStatus(): Promise<{
  connected: boolean;
  threadsUsername?: string;
  connectedAt?: Date;
}> {
  const userId = await requireUserId();
  const token = await prisma.threadsApiToken.findUnique({
    where: { userId },
    select: { threadsUsername: true, createdAt: true },
  });

  if (!token) return { connected: false };
  return { connected: true, threadsUsername: token.threadsUsername, connectedAt: token.createdAt };
}

/** Get Threads profile data for composer preview */
export async function getThreadsProfileForComposer(): Promise<{
  displayName: string;
  avatarUrl: string | null;
} | null> {
  const userId = await requireUserId();
  const token = await prisma.threadsApiToken.findUnique({
    where: { userId },
    select: {
      threadsUsername: true,
      threadsProfilePictureUrl: true,
    },
  });

  if (!token) return null;
  return {
    displayName: token.threadsUsername,
    avatarUrl: token.threadsProfilePictureUrl,
  };
}

/** Disconnect Threads account for current user */
export async function disconnectThreadsAccount(): Promise<void> {
  const userId = await requireUserId();
  await prisma.threadsApiToken.delete({ where: { userId } }).catch(() => {
    // Already disconnected — ignore
  });
}

/** Get credentials for current user (auth-checked) */
export async function getThreadsApiTokenForUser(): Promise<ThreadsApiCredentials | null> {
  const userId = await requireUserId();
  return getThreadsApiTokenForUserInternal(userId);
}
