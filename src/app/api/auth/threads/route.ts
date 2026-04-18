import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { randomBytes } from "crypto";
import { cookies } from "next/headers";

const COOKIE_NAME = "threads_oauth_state";
const COOKIE_MAX_AGE = 300; // 5 minutes

/**
 * GET /api/auth/threads — Initiates Threads OAuth 2.0 flow.
 * Generates state for CSRF protection, stores in cookie, redirects to Threads authorize URL.
 * Note: Threads uses server-side flow (no PKCE).
 */
export async function GET() {
  const { userId: clerkId } = await auth();
  if (!clerkId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const clientId = process.env.THREADS_APP_ID;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL;
  if (!clientId || !appUrl) {
    return NextResponse.json(
      { error: "THREADS_APP_ID and NEXT_PUBLIC_APP_URL must be configured" },
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

  const redirectUri = `${appUrl}/api/auth/threads/callback`;
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    // ADR-008 Phase 2: include threads_manage_insights so the
    // social-import cron can fetch per-post and account-level metrics.
    // Users who decline it get publish-only (cron skips silently).
    scope: "threads_basic,threads_content_publish,threads_manage_insights",
    response_type: "code",
    state,
  });

  return NextResponse.redirect(`https://threads.net/oauth/authorize?${params.toString()}`);
}
