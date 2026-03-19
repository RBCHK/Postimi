import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUserId } from "@/lib/auth";
import { saveXApiToken } from "@/app/actions/x-token";

const COOKIE_NAME = "x_oauth_state";

interface XTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  scope: string;
  token_type: string;
}

/**
 * GET /api/auth/x/callback — Handles X OAuth 2.0 PKCE callback.
 * Verifies state, exchanges code for tokens, fetches user profile,
 * saves tokens to DB, and redirects to settings.
 */
export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  const { searchParams } = req.nextUrl;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Check for error from X (user denied access)
  const error = searchParams.get("error");
  if (error) {
    const description = searchParams.get("error_description") ?? "Unknown error";
    return NextResponse.redirect(`${appUrl}/settings?x_error=${encodeURIComponent(description)}`);
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?x_error=Missing+code+or+state`);
  }

  // Verify state matches cookie
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.redirect(`${appUrl}/settings?x_error=OAuth+session+expired`);
  }

  let storedState: string;
  let codeVerifier: string;
  try {
    const parsed = JSON.parse(cookieValue);
    storedState = parsed.state;
    codeVerifier = parsed.codeVerifier;
  } catch {
    return NextResponse.redirect(`${appUrl}/settings?x_error=Invalid+OAuth+session`);
  }

  if (state !== storedState) {
    return NextResponse.redirect(`${appUrl}/settings?x_error=State+mismatch+(CSRF+protection)`);
  }

  // Clear the cookie immediately
  cookieStore.delete(COOKIE_NAME);

  const clientId = process.env.X_CLIENT_ID;
  const clientSecret = process.env.X_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/settings?x_error=Server+misconfigured`);
  }

  // Exchange code for tokens
  const redirectUri = `${appUrl}/api/auth/x/callback`;
  let tokenData: XTokenResponse;
  try {
    const tokenRes = await fetch("https://api.twitter.com/2/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`,
      },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: redirectUri,
        code_verifier: codeVerifier,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("[x-oauth-callback] Token exchange failed:", body);
      return NextResponse.redirect(
        `${appUrl}/settings?x_error=${encodeURIComponent(`Token exchange failed: ${tokenRes.status}`)}`
      );
    }

    tokenData = (await tokenRes.json()) as XTokenResponse;
  } catch (err) {
    console.error("[x-oauth-callback] Token exchange error:", err);
    return NextResponse.redirect(`${appUrl}/settings?x_error=Token+exchange+error`);
  }

  // Fetch user profile with the new access token
  let profile: { id: string; username: string };
  try {
    const profileRes = await fetch("https://api.twitter.com/2/users/me?user.fields=username", {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    if (!profileRes.ok) {
      const body = await profileRes.text();
      console.error("[x-oauth-callback] Profile fetch failed:", body);
      return NextResponse.redirect(`${appUrl}/settings?x_error=Failed+to+fetch+X+profile`);
    }

    const profileData = (await profileRes.json()) as { data: { id: string; username: string } };
    profile = profileData.data;
  } catch (err) {
    console.error("[x-oauth-callback] Profile fetch error:", err);
    return NextResponse.redirect(`${appUrl}/settings?x_error=Profile+fetch+error`);
  }

  // Save tokens to DB (encrypted)
  try {
    await saveXApiToken(userId, tokenData, profile);
  } catch (err) {
    console.error("[x-oauth-callback] Token save error:", err);
    return NextResponse.redirect(`${appUrl}/settings?x_error=Failed+to+save+tokens`);
  }

  return NextResponse.redirect(`${appUrl}/settings?x_connected=true`);
}
