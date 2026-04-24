import * as Sentry from "@sentry/nextjs";
import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "@/lib/token-encryption";
import { fetchWithRetry } from "@/lib/fetch-with-retry";
import { withTokenRefreshLock } from "@/lib/server/token-refresh-lock";
import {
  runTokenRefreshWithRetry,
  classifyRefreshError,
  reportTransientRefreshFailure,
} from "@/lib/server/token-refresh-retry";

export interface LinkedInApiCredentials {
  accessToken: string;
  linkedinUserId: string;
  linkedinName: string | null;
}

export interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
}

export interface LinkedInUserProfile {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

export async function getLinkedInApiTokenForUser(
  userId: string
): Promise<LinkedInApiCredentials | null> {
  const token = await prisma.linkedInApiToken.findUnique({ where: { userId } });
  if (!token) return null;

  const now = new Date();
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  if (token.expiresAt > fiveDaysFromNow) {
    return {
      accessToken: decryptToken(token.accessToken),
      linkedinUserId: token.linkedinUserId,
      linkedinName: token.linkedinName,
    };
  }

  return refreshLinkedInToken(userId, token.refreshToken, token.updatedAt);
}

async function refreshLinkedInToken(
  userId: string,
  encryptedRefreshToken: string,
  expectedUpdatedAt: Date
): Promise<LinkedInApiCredentials | null> {
  return withTokenRefreshLock(userId, "linkedin", async () => {
    const current = await prisma.linkedInApiToken.findUnique({ where: { userId } });
    if (!current) return null;

    const fiveDaysFromNow = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    if (current.updatedAt.getTime() !== expectedUpdatedAt.getTime()) {
      if (current.expiresAt > fiveDaysFromNow) {
        return {
          accessToken: decryptToken(current.accessToken),
          linkedinUserId: current.linkedinUserId,
          linkedinName: current.linkedinName,
        };
      }
    }

    const refreshToken = decryptToken(encryptedRefreshToken);

    const clientId = process.env.LINKEDIN_CLIENT_ID;
    const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
    if (!clientId || !clientSecret) {
      throw new Error("LINKEDIN_CLIENT_ID and LINKEDIN_CLIENT_SECRET must be set");
    }

    let tokenData: LinkedInTokenResponse;
    try {
      // Outer retry (2s / 8s + jitter) on top of `fetchWithRetry`. See
      // x-token for the full rationale; LinkedIn's refresh endpoint has
      // similar transient-flap characteristics.
      tokenData = await runTokenRefreshWithRetry(() =>
        exchangeRefreshToken(refreshToken, clientId, clientSecret)
      );
    } catch (err) {
      // Only delete on explicit `invalid_grant` — any other terminal
      // failure keeps the token row and returns null so the next caller
      // retries fresh.
      const classification = classifyRefreshError(err);
      if (!classification.invalidGrant) {
        return reportTransientRefreshFailure(err, "linkedin", userId, classification);
      }
      Sentry.captureException(err, {
        tags: { area: "linkedin-token", step: "refresh-retry", userId },
      });
      console.error(`[linkedin-token] refresh failed for user ${userId}, deleting token:`, err);
      await prisma.linkedInApiToken.delete({ where: { userId } }).catch(() => {});
      return null;
    }

    const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);
    // Protected by `withTokenRefreshLock` — read + exchange + update
    // are serialized per user.
    await prisma.linkedInApiToken.update({
      where: { userId },
      data: {
        accessToken: encryptToken(tokenData.access_token),
        refreshToken: tokenData.refresh_token
          ? encryptToken(tokenData.refresh_token)
          : current.refreshToken,
        expiresAt,
        scopes: tokenData.scope,
      },
    });

    return {
      accessToken: tokenData.access_token,
      linkedinUserId: current.linkedinUserId,
      linkedinName: current.linkedinName,
    };
  });
}

async function exchangeRefreshToken(
  refreshToken: string,
  clientId: string,
  clientSecret: string
): Promise<LinkedInTokenResponse> {
  const res = await fetchWithRetry("https://www.linkedin.com/oauth/v2/accessToken", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clientId,
      client_secret: clientSecret,
    }),
    maxAttempts: 2,
    retryContext: "linkedin-token:refresh",
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`LinkedIn token refresh failed ${res.status}: ${body}`);
  }

  return res.json() as Promise<LinkedInTokenResponse>;
}

export async function saveLinkedInApiToken(
  userId: string,
  tokenData: LinkedInTokenResponse,
  profile: LinkedInUserProfile
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  const profileData = {
    linkedinUserId: profile.sub,
    linkedinName: profile.name ?? null,
    linkedinEmail: profile.email ?? null,
    linkedinPictureUrl: profile.picture ?? null,
  };

  await prisma.linkedInApiToken.upsert({
    where: { userId },
    create: {
      userId,
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: encryptToken(tokenData.refresh_token ?? ""),
      expiresAt,
      scopes: tokenData.scope,
    },
    update: {
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: tokenData.refresh_token ? encryptToken(tokenData.refresh_token) : undefined,
      expiresAt,
      scopes: tokenData.scope,
    },
  });
}

export async function getLinkedInConnectionStatus(userId: string): Promise<{
  connected: boolean;
  linkedinName?: string;
  connectedAt?: Date;
}> {
  const token = await prisma.linkedInApiToken.findUnique({
    where: { userId },
    select: { linkedinName: true, createdAt: true },
  });

  if (!token) return { connected: false };
  return {
    connected: true,
    linkedinName: token.linkedinName ?? undefined,
    connectedAt: token.createdAt,
  };
}

export async function getLinkedInProfileForComposer(userId: string): Promise<{
  displayName: string;
  headline: string | null;
  avatarUrl: string | null;
} | null> {
  const token = await prisma.linkedInApiToken.findUnique({
    where: { userId },
    select: {
      linkedinName: true,
      linkedinHeadline: true,
      linkedinPictureUrl: true,
    },
  });

  if (!token) return null;
  return {
    displayName: token.linkedinName ?? "LinkedIn User",
    headline: token.linkedinHeadline,
    avatarUrl: token.linkedinPictureUrl,
  };
}

export async function disconnectLinkedInAccount(userId: string): Promise<void> {
  await prisma.linkedInApiToken.delete({ where: { userId } }).catch(() => {});
}
