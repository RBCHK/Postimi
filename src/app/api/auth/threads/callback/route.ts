import { NextRequest, NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireUserId } from "@/lib/auth";
import { saveThreadsApiToken } from "@/lib/server/threads-token";
import { fetchWithTimeout } from "@/lib/fetch-with-timeout";

const COOKIE_NAME = "threads_oauth_state";

interface ThreadsShortLivedTokenResponse {
  access_token: string;
  token_type: string;
  user_id: number;
}

interface ThreadsLongLivedTokenResponse {
  access_token: string;
  token_type: string;
  expires_in: number;
}

interface ThreadsProfileResponse {
  id: string;
  username: string;
  threads_profile_picture_url?: string;
  threads_biography?: string;
}

/**
 * GET /api/auth/threads/callback — Handles Threads OAuth callback.
 * Verifies state, exchanges code for short-lived token, exchanges for long-lived token,
 * fetches user profile, saves to DB, and redirects to settings.
 */
export async function GET(req: NextRequest) {
  const userId = await requireUserId();
  const { searchParams } = req.nextUrl;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";

  // Check for error from Threads
  const error = searchParams.get("error");
  if (error) {
    const description = searchParams.get("error_description") ?? "Unknown error";
    return NextResponse.redirect(
      `${appUrl}/settings?threads_error=${encodeURIComponent(description)}`
    );
  }

  const code = searchParams.get("code");
  const state = searchParams.get("state");
  if (!code || !state) {
    return NextResponse.redirect(`${appUrl}/settings?threads_error=Missing+code+or+state`);
  }

  // Verify state matches cookie
  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(COOKIE_NAME)?.value;
  if (!cookieValue) {
    return NextResponse.redirect(`${appUrl}/settings?threads_error=OAuth+session+expired`);
  }

  let storedState: string;
  try {
    const parsed = JSON.parse(cookieValue);
    storedState = parsed.state;
  } catch {
    return NextResponse.redirect(`${appUrl}/settings?threads_error=Invalid+OAuth+session`);
  }

  if (state !== storedState) {
    return NextResponse.redirect(
      `${appUrl}/settings?threads_error=State+mismatch+(CSRF+protection)`
    );
  }

  cookieStore.delete(COOKIE_NAME);

  const clientId = process.env.THREADS_APP_ID;
  const clientSecret = process.env.THREADS_APP_SECRET;
  if (!clientId || !clientSecret) {
    return NextResponse.redirect(`${appUrl}/settings?threads_error=Server+misconfigured`);
  }

  const redirectUri = `${appUrl}/api/auth/threads/callback`;

  // Step 1: Exchange code for short-lived token
  let shortLivedToken: ThreadsShortLivedTokenResponse;
  try {
    const tokenRes = await fetchWithTimeout("https://graph.threads.net/oauth/access_token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code,
      }),
    });

    if (!tokenRes.ok) {
      const body = await tokenRes.text();
      console.error("[threads-oauth-callback] Short-lived token exchange failed:", body);
      return NextResponse.redirect(
        `${appUrl}/settings?threads_error=${encodeURIComponent(`Token exchange failed: ${tokenRes.status}`)}`
      );
    }

    shortLivedToken = (await tokenRes.json()) as ThreadsShortLivedTokenResponse;
  } catch (err) {
    console.error("[threads-oauth-callback] Short-lived token exchange error:", err);
    return NextResponse.redirect(`${appUrl}/settings?threads_error=Token+exchange+error`);
  }

  // Step 2: Exchange short-lived token for long-lived token (60 days)
  let longLivedToken: ThreadsLongLivedTokenResponse;
  try {
    const params = new URLSearchParams({
      grant_type: "th_exchange_token",
      client_secret: clientSecret,
      access_token: shortLivedToken.access_token,
    });

    const longRes = await fetchWithTimeout(
      `https://graph.threads.net/access_token?${params.toString()}`
    );

    if (!longRes.ok) {
      const body = await longRes.text();
      console.error("[threads-oauth-callback] Long-lived token exchange failed:", body);
      return NextResponse.redirect(
        `${appUrl}/settings?threads_error=Long-lived+token+exchange+failed`
      );
    }

    longLivedToken = (await longRes.json()) as ThreadsLongLivedTokenResponse;
  } catch (err) {
    console.error("[threads-oauth-callback] Long-lived token exchange error:", err);
    return NextResponse.redirect(`${appUrl}/settings?threads_error=Token+exchange+error`);
  }

  // Step 3: Fetch user profile
  let profile: ThreadsProfileResponse;
  try {
    const fields = "id,username,threads_profile_picture_url,threads_biography";
    const profileRes = await fetchWithTimeout(
      `https://graph.threads.net/v1.0/me?fields=${fields}&access_token=${longLivedToken.access_token}`
    );

    if (!profileRes.ok) {
      const body = await profileRes.text();
      console.error("[threads-oauth-callback] Profile fetch failed:", body);
      return NextResponse.redirect(
        `${appUrl}/settings?threads_error=Failed+to+fetch+Threads+profile`
      );
    }

    profile = (await profileRes.json()) as ThreadsProfileResponse;
  } catch (err) {
    console.error("[threads-oauth-callback] Profile fetch error:", err);
    return NextResponse.redirect(`${appUrl}/settings?threads_error=Profile+fetch+error`);
  }

  // Step 4: Save tokens to DB
  try {
    await saveThreadsApiToken(
      userId,
      { access_token: longLivedToken.access_token, expires_in: longLivedToken.expires_in },
      profile
    );
  } catch (err) {
    console.error("[threads-oauth-callback] Token save error:", err);
    return NextResponse.redirect(`${appUrl}/settings?threads_error=Failed+to+save+tokens`);
  }

  return NextResponse.redirect(`${appUrl}/settings?threads_connected=true`);
}
