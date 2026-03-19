"use server";

import { prisma } from "@/lib/prisma";
import { requireUserId } from "@/lib/auth";
import { encryptToken, decryptToken } from "@/lib/token-encryption";

export interface XApiCredentials {
  accessToken: string;
  xUserId: string;
  xUsername: string;
}

interface OAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

interface XUserProfile {
  id: string;
  username: string;
}

// ─── Internal helpers (no auth check — for cron routes) ─────

/**
 * Get valid X API credentials for a specific user.
 * Auto-refreshes if token is expired or about to expire (within 5 min).
 * Returns null if user has no connected X account.
 */
export async function getXApiTokenForUserInternal(userId: string): Promise<XApiCredentials | null> {
  const token = await prisma.xApiToken.findUnique({ where: { userId } });
  if (!token) return null;

  const now = new Date();
  const fiveMinFromNow = new Date(now.getTime() + 5 * 60 * 1000);

  if (token.expiresAt > fiveMinFromNow) {
    return {
      accessToken: decryptToken(token.accessToken),
      xUserId: token.xUserId,
      xUsername: token.xUsername,
    };
  }

  // Token expired or expiring soon — refresh
  return refreshXApiToken(userId, token.refreshToken, token.updatedAt);
}

/**
 * Refresh an expired access token.
 * Uses optimistic lock (updatedAt check) to prevent race conditions
 * when multiple cron jobs try to refresh simultaneously.
 */
async function refreshXApiToken(
  userId: string,
  encryptedRefreshToken: string,
  expectedUpdatedAt: Date
): Promise<XApiCredentials | null> {
  // Re-read to check if another process already refreshed
  const current = await prisma.xApiToken.findUnique({ where: { userId } });
  if (!current) return null;

  // Another process already refreshed — use the fresh token
  if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
    const fiveMinFromNow = new Date(Date.now() + 5 * 60 * 1000);
    if (current.expiresAt > fiveMinFromNow) {
      return {
        accessToken: decryptToken(current.accessToken),
        xUserId: current.xUserId,
        xUsername: current.xUsername,
      };
    }
  }

  const refreshToken = decryptToken(encryptedRefreshToken);

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    throw new Error("X_CLIENT_ID and X_CLIENT_SECRET must be set");
  }

  let tokenData: OAuthTokenResponse;
  try {
    tokenData = await exchangeRefreshToken(refreshToken, clientId, clientSecret);
  } catch (err) {
    // One retry with 1s backoff for transient errors
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      tokenData = await exchangeRefreshToken(refreshToken, clientId, clientSecret);
    } catch {
      // Token is likely revoked — delete it
      console.error(`[x-token] refresh failed for user ${userId}, deleting token:`, err);
      await prisma.xApiToken.delete({ where: { userId } }).catch(() => {});
      return null;
    }
  }

  // Save new tokens immediately
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
  await prisma.xApiToken.update({
    where: { userId },
    data: {
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: encryptToken(tokenData.refresh_token),
      expiresAt,
      scopes: tokenData.scope,
    },
  });

  return {
    accessToken: tokenData.access_token,
    xUserId: current.xUserId,
    xUsername: current.xUsername,
  };
}

async function exchangeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<OAuthTokenResponse> {
  const res = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
    },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`X token refresh failed ${res.status}: ${body}`);
  }

  return res.json() as Promise<OAuthTokenResponse>;
}

/**
 * Get any valid X API token (for global endpoints like trends).
 * Prefers the first user with a valid token.
 */
export async function getAnyValidXApiToken(): Promise<XApiCredentials | null> {
  const tokens = await prisma.xApiToken.findMany({
    orderBy: { createdAt: "asc" },
    take: 5,
  });

  for (const token of tokens) {
    const credentials = await getXApiTokenForUserInternal(token.userId);
    if (credentials) return credentials;
  }

  return null;
}

// ─── Auth-checked actions (for UI / server actions) ──────

/** Save tokens after OAuth callback */
export async function saveXApiToken(
  userId: string,
  tokenData: OAuthTokenResponse,
  profile: XUserProfile
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  await prisma.xApiToken.upsert({
    where: { userId },
    create: {
      userId,
      xUserId: profile.id,
      xUsername: profile.username,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: encryptToken(tokenData.refresh_token),
      expiresAt,
      scopes: tokenData.scope,
    },
    update: {
      xUserId: profile.id,
      xUsername: profile.username,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: encryptToken(tokenData.refresh_token),
      expiresAt,
      scopes: tokenData.scope,
    },
  });
}

/** Get X connection status for current user */
export async function getXConnectionStatus(): Promise<{
  connected: boolean;
  xUsername?: string;
  connectedAt?: Date;
}> {
  const userId = await requireUserId();
  const token = await prisma.xApiToken.findUnique({
    where: { userId },
    select: { xUsername: true, createdAt: true },
  });

  if (!token) return { connected: false };
  return { connected: true, xUsername: token.xUsername, connectedAt: token.createdAt };
}

/** Disconnect X account for current user */
export async function disconnectXAccount(): Promise<void> {
  const userId = await requireUserId();
  await prisma.xApiToken.delete({ where: { userId } }).catch(() => {
    // Already disconnected — ignore
  });
}

/** Get credentials for current user (auth-checked) */
export async function getXApiTokenForUser(): Promise<XApiCredentials | null> {
  const userId = await requireUserId();
  return getXApiTokenForUserInternal(userId);
}
