import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUserId } from "@/lib/auth";
import { saveLinkedInApiToken } from "@/lib/server/linkedin-token";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const COOKIE_NAME = "linkedin_oauth_state";

interface LinkedInTokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
  scope: string;
}

interface LinkedInUserInfoResponse {
  sub: string;
  name?: string;
  email?: string;
  picture?: string;
}

/**
 * GET /api/auth/linkedin/callback — Handles LinkedIn OAuth callback.
 * Verifies state, exchanges code for tokens, fetches user profile,
 * saves to DB, and redirects to settings.
 */
export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  const { searchParams } = req.nextUrl;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Check for error from LinkedIn
  const error = searchParams.get("error");
  if (error) {
    const description = searchParams.get("error_description") ?? "Unknown error";
    return NextResponse.redirect(
      `${appUrl}/settings?linkedin_error=${encodeURIComponent(description)}`
    );
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?linkedin_error=Missing+code+or+state`);
  }

  // Verify state matches cookie
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.redirect(`${appUrl}/settings?linkedin_error=OAuth+session+expired`);
  }

  let storedState: string;
  try {
    const parsed = JSON.parse(cookieValue);
    storedState = parsed.state;
  } catch {
    return NextResponse.redirect(`${appUrl}/settings?linkedin_error=Invalid+OAuth+session`);
  }

  if (state !== storedState) {
    return NextResponse.redirect(
      `${appUrl}/settings?linkedin_error=State+mismatch+(CSRF+protection)`
    );
  }

  cookieStore.delete(COOKIE_NAME);

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const clientSecret = process.env.LINKEDIN_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/settings?linkedin_error=Server+misconfigured`);
  }

  const redirectUri = `${appUrl}/api/auth/linkedin/callback`;

  // Step 1: Exchange code for tokens
  let tokenData: LinkedInTokenResponse;
  try {
    const tokenRes = await fetchWithTimeout("https://www.linkedin.com/oauth/v2/accessToken", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("[linkedin-oauth-callback] Token exchange failed:", body);
      return NextResponse.redirect(
        `${appUrl}/settings?linkedin_error=${encodeURIComponent(`Token exchange failed: ${tokenRes.status}`)}`
      );
    }

    tokenData = (await tokenRes.json()) as LinkedInTokenResponse;
  } catch (err) {
    console.error("[linkedin-oauth-callback] Token exchange error:", err);
    return NextResponse.redirect(`${appUrl}/settings?linkedin_error=Token+exchange+error`);
  }

  // Step 2: Fetch user profile (OpenID Connect userinfo)
  let profile: LinkedInUserInfoResponse;
  try {
    const profileRes = await fetchWithTimeout("https://api.linkedin.com/v2/userinfo", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      const body = await profileRes.text();
      console.error("[linkedin-oauth-callback] Profile fetch failed:", body);
      return NextResponse.redirect(
        `${appUrl}/settings?linkedin_error=Failed+to+fetch+LinkedIn+profile`
      );
    }

    profile = (await profileRes.json()) as LinkedInUserInfoResponse;
  } catch (err) {
    console.error("[linkedin-oauth-callback] Profile fetch error:", err);
    return NextResponse.redirect(`${appUrl}/settings?linkedin_error=Profile+fetch+error`);
  }

  // Step 3: Save tokens to DB
  try {
    await saveLinkedInApiToken(userId, tokenData, profile);
  } catch (err) {
    console.error("[linkedin-oauth-callback] Token save error:", err);
    return NextResponse.redirect(`${appUrl}/settings?linkedin_error=Failed+to+save+tokens`);
  }

  return NextResponse.redirect(`${appUrl}/settings?linkedin_connected=true`);
}
