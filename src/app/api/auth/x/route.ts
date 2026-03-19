import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomBytes, createHash } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "x_oauth_state";
const COOKIE_MAX_AGE = 300; // 5 minutes

/**
 * GET /api/auth/x — Initiates X OAuth 2.0 PKCE flow.
 * Generates code_verifier, code_challenge, and state.
 * Stores them in a short-lived httpOnly cookie, then redirects to X authorize URL.
 */
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.X_CLIENT_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !appUrl) {
    return NextResponse.json(
      { error: "X_CLIENT_ID and NEXT_PUBLIC_APP_URL must be configured" },
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

  // Generate PKCE values
  const codeVerifier = randomBytes(32).toString("base64url");
  const codeChallenge = createHash("sha256").update(codeVerifier).digest("base64url");
  const state = randomBytes(16).toString("hex");

  // Store in httpOnly cookie
  const cookieValue = JSON.stringify({ codeVerifier, state });
  cookieStore.set(COOKIE_NAME, cookieValue, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    maxAge: COOKIE_MAX_AGE,
    path: "/",
  });

  // Build X authorize URL
  const redirectUri = `${appUrl}/api/auth/x/callback`;
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "tweet.read users.read offline.access",
    state,
    code_challenge: codeChallenge,
    code_challenge_method: "S256",
  });

  return NextResponse.redirect(`https://twitter.com/i/oauth2/authorize?${params.toString()}`);
}
