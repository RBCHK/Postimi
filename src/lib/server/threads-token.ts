import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "@/lib/token-encryption";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

export interface ThreadsApiCredentials {
  accessToken: string;
  threadsUserId: string;
  threadsUsername: string;
}

export interface ThreadsTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

export interface ThreadsUserProfile {
  id: string;
  username: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}

// ADR-008 Phase 2: OAuth scopes requested in the authorize redirect.
// Kept in sync with `src/app/api/auth/threads/route.ts`. The user may
// deselect individual scopes during consent — we can't detect silent
// downgrades at token-exchange time, so the cron verifies presence in
// `grantedScopes` before attempting insight calls and removes missing
// scopes from the array on 400/403 from the insight endpoints.
export const THREADS_REQUESTED_SCOPES = [
  "threads_basic",
  "threads_content_publish",
  "threads_manage_insights",
] as const;

export async function getThreadsApiTokenForUser(
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

  return refreshThreadsToken(userId, token.accessToken, token.updatedAt);
}

async function refreshThreadsToken(
  userId: string,
  encryptedAccessToken: string,
  expectedUpdatedAt: Date
): Promise<ThreadsApiCredentials | null> {
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
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      tokenData = await exchangeForRefreshedToken(accessToken);
    } catch (retryErr) {
      // Terminal failure: silently dropping the token here means the
      // user is disconnected from Threads without any UI signal.
      Sentry.captureException(retryErr, {
        tags: { area: "threads-token", step: "refresh-retry", userId },
        extra: { firstError: err instanceof Error ? err.message : String(err) },
      });
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

  const res = await fetchWithTimeout(
    `https://graph.threads.net/refresh_access_token?${params.toString()}`
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Threads token refresh failed ${res.status}: ${body}`);
  }

  return res.json() as Promise<ThreadsTokenResponse>;
}

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

  const scopesJoined = THREADS_REQUESTED_SCOPES.join(",");

  await prisma.threadsApiToken.upsert({
    where: { userId },
    create: {
      userId,
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      expiresAt,
      scopes: scopesJoined,
      grantedScopes: [...THREADS_REQUESTED_SCOPES],
    },
    update: {
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      expiresAt,
      scopes: scopesJoined,
      grantedScopes: [...THREADS_REQUESTED_SCOPES],
    },
  });
}

export async function getThreadsConnectionStatus(userId: string): Promise<{
  connected: boolean;
  threadsUsername?: string;
  connectedAt?: Date;
}> {
  const token = await prisma.threadsApiToken.findUnique({
    where: { userId },
    select: { threadsUsername: true, createdAt: true },
  });

  if (!token) return { connected: false };
  return { connected: true, threadsUsername: token.threadsUsername, connectedAt: token.createdAt };
}

export async function getThreadsProfileForComposer(userId: string): Promise<{
  displayName: string;
  avatarUrl: string | null;
} | null> {
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

export async function disconnectThreadsAccount(userId: string): Promise<void> {
  await prisma.threadsApiToken.delete({ where: { userId } }).catch(() => {});
}
