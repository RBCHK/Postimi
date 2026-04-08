import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "linkedin_oauth_state";
const COOKIE_MAX_AGE = 300; // 5 minutes

/**
 * GET /api/auth/linkedin — Initiates LinkedIn OAuth 2.0 flow.
 * Generates state for CSRF protection, stores in cookie, redirects to LinkedIn authorize URL.
 * Note: LinkedIn uses server-side flow (no PKCE).
 */
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.LINKEDIN_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !appUrl) {
    return NextResponse.json(
      { error: "LINKEDIN_CLIENT_ID and NEXT_PUBLIC_APP_URL must be configured" },
      { status: 500 }
    );
  }

  // Rate limit: reject if an OAuth flow is already in progress
  const cookieStore = await cookies();
  if (cookieStore.get(COOKIE_NAME)) {
    return NextResponse.json(
      { error: "OAuth flow already in progress. Please wait and try again." },
      { status: 429 }
    );
  }

  const state = randomBytes(16).toString("hex");

  cookieStore.set(COOKIE_NAME, JSON.stringify({ state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  const redirectUri = `${appUrl}/api/auth/linkedin/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "openid profile w_member_social",
    state,
  });

  return NextResponse.redirect(
    `https://www.linkedin.com/oauth/v2/authorization?${params.toString()}`
  );
}
