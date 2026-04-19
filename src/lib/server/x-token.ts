import { prisma } from "@/lib/prisma";
import { encryptToken, decryptToken } from "@/lib/token-encryption";

export interface XApiCredentials {
  accessToken: string;
  xUserId: string;
  xUsername: string;
}

export interface XOAuthTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
}

export interface XUserProfile {
  id: string;
  username: string;
  name?: string;
  description?: string;
  profile_image_url?: string;
  location?: string;
  url?: string;
  verified?: boolean;
  verified_type?: string;
  created_at?: string;
}

export async function getXApiTokenForUser(userId: string): Promise<XApiCredentials | null> {
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

  return refreshXApiToken(userId, token.refreshToken, token.updatedAt);
}

async function refreshXApiToken(
  userId: string,
  encryptedRefreshToken: string,
  expectedUpdatedAt: Date
): Promise<XApiCredentials | null> {
  const current = await prisma.xApiToken.findUnique({ where: { userId } });
  if (!current) return null;

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

  let tokenData: XOAuthTokenResponse;
  try {
    tokenData = await exchangeRefreshToken(refreshToken, clientId, clientSecret);
  } catch (err) {
    await new Promise((resolve) => setTimeout(resolve, 1000));
    try {
      tokenData = await exchangeRefreshToken(refreshToken, clientId, clientSecret);
    } catch {
      console.error(`[x-token] refresh failed for user ${userId}, deleting token:`, err);
      await prisma.xApiToken.delete({ where: { userId } }).catch(() => {});
      return null;
    }
  }

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
): Promise<XOAuthTokenResponse> {
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

  return res.json() as Promise<XOAuthTokenResponse>;
}

export async function saveXApiToken(
  userId: string,
  tokenData: XOAuthTokenResponse,
  profile: XUserProfile
): Promise<void> {
  const expiresAt = new Date(Date.now() + tokenData.expires_in * 1000);

  const profileData = {
    xUserId: profile.id,
    xUsername: profile.username,
    xDisplayName: profile.name ?? null,
    xProfileImageUrl: profile.profile_image_url ?? null,
    xDescription: profile.description ?? null,
    xLocation: profile.location ?? null,
    xUrl: profile.url ?? null,
    xVerified: profile.verified ?? false,
    xVerifiedType: profile.verified_type ?? null,
    xAccountCreatedAt: profile.created_at ? new Date(profile.created_at) : null,
  };

  await prisma.xApiToken.upsert({
    where: { userId },
    create: {
      userId,
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: encryptToken(tokenData.refresh_token),
      expiresAt,
      scopes: tokenData.scope,
    },
    update: {
      ...profileData,
      accessToken: encryptToken(tokenData.access_token),
      refreshToken: encryptToken(tokenData.refresh_token),
      expiresAt,
      scopes: tokenData.scope,
    },
  });
}

export async function getXConnectionStatus(userId: string): Promise<{
  connected: boolean;
  xUsername?: string;
  connectedAt?: Date;
}> {
  const token = await prisma.xApiToken.findUnique({
    where: { userId },
    select: { xUsername: true, createdAt: true },
  });

  if (!token) return { connected: false };
  return { connected: true, xUsername: token.xUsername, connectedAt: token.createdAt };
}

export async function getXProfileForComposer(userId: string): Promise<{
  displayName: string;
  handle: string;
  avatarUrl: string | null;
  verified: boolean;
} | null> {
  const token = await prisma.xApiToken.findUnique({
    where: { userId },
    select: {
      xUsername: true,
      xDisplayName: true,
      xProfileImageUrl: true,
      xVerified: true,
    },
  });

  if (!token) return null;
  return {
    displayName: token.xDisplayName ?? token.xUsername,
    handle: `@${token.xUsername}`,
    avatarUrl: token.xProfileImageUrl,
    verified: token.xVerified,
  };
}

export async function disconnectXAccount(userId: string): Promise<void> {
  await prisma.xApiToken.delete({ where: { userId } }).catch(() => {});
}

export async function hasMediaWriteScope(userId: string): Promise<boolean> {
  const token = await prisma.xApiToken.findUnique({
    where: { userId },
    select: { scopes: true },
  });
  if (!token) return false;
  return token.scopes.includes("media.write");
}
