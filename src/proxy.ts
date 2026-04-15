// Next.js 16 proxy (replaces middleware.ts). Auto-detected by the framework.
//
// Three jobs:
//   1. Split routing by host — marketing (postimi.com) serves the landing, app
//      (app.postimi.com) serves the dashboard via rewrite into /app/*.
//   2. Gate app-only APIs so they 404 on the marketing host.
//   3. Protect dashboard routes via Clerk (auth.protect()).
//
// The rewrite means the browser URL bar stays clean: app.postimi.com/schedule
// actually renders src/app/app/schedule/page.tsx, but the URL never changes.

import { clerkMiddleware, createRouteMatcher } from "@clerk/nextjs/server";
import { NextResponse, type NextRequest } from "next/server";

const APP_HOSTS = new Set(["app.postimi.com", "app.lvh.me"]);
const MARKETING_HOSTS = new Set(["postimi.com", "www.postimi.com", "lvh.me"]);

// APIs that only exist on the app host. Marketing must 404 these to avoid
// leaking internal surfaces (OAuth callbacks, cron, AI streaming, webhooks, debug).
const isAppOnlyApi = createRouteMatcher([
  "/api/auth/(.*)",
  "/api/cron/(.*)",
  "/api/chat(.*)",
  "/api/strategist(.*)",
  "/api/media(.*)",
  "/api/webhooks/clerk(.*)",
  "/api/webhooks/stripe(.*)",
  "/api/billing/(.*)",
  "/api/debug(.*)",
]);

// Paths allowed on the app host without authentication.
// Everything else on the app host requires Clerk auth.
// (API routes return early above — no need to include them here.)
const isPublicAppPath = createRouteMatcher(["/sign-in(.*)", "/sign-up(.*)"]);

export default clerkMiddleware(async (auth, req: NextRequest) => {
  const rawHost = (req.headers.get("host") ?? "").split(":")[0].toLowerCase();
  const url = req.nextUrl.clone();

  // www → apex (308 permanent, only in production)
  if (rawHost === "www.postimi.com") {
    url.host = "postimi.com";
    return NextResponse.redirect(url, 308);
  }

  // Preview/dev fallback: *.vercel.app URLs and bare localhost behave as the
  // app host so the existing preview + local dev workflow keeps working
  // during the migration (PR 3 → PR 4). lvh.me / app.lvh.me are the way to
  // actually exercise host-split logic locally.
  const isApp =
    APP_HOSTS.has(rawHost) ||
    rawHost.endsWith(".vercel.app") ||
    rawHost === "localhost" ||
    rawHost === "127.0.0.1";
  const isMarketing = MARKETING_HOSTS.has(rawHost);

  // API host gating — protect app-only APIs from being called on the marketing host.
  if (url.pathname.startsWith("/api/")) {
    if (isAppOnlyApi(req) && isMarketing && !isApp) {
      return new NextResponse("Not Found", { status: 404 });
    }
    return NextResponse.next();
  }

  // Marketing host must never serve /app/* directly (defense in depth against
  // crawlers and URL manipulation — regular users can't reach these URLs).
  if (isMarketing && url.pathname.startsWith("/app")) {
    const stripped = url.pathname.replace(/^\/app/, "") || "/";
    return NextResponse.redirect(new URL(stripped, "https://app.postimi.com"), 307);
  }

  // On the app host, everything except /sign-in requires auth. Check BEFORE
  // rewrite so Clerk's sign-in redirect uses the pre-rewrite URL (e.g. /schedule).
  if (isApp && !isPublicAppPath(req)) {
    await auth.protect();
  }

  // Host rewrite: app-host /schedule → /app/schedule (physical path under src/app/app/*).
  // URL bar stays clean because rewrite (unlike redirect) does not change the address.
  // /sign-in stays at the root segment and serves from src/app/sign-in/*.
  if (isApp && !url.pathname.startsWith("/app") && !url.pathname.startsWith("/sign-in")) {
    url.pathname = url.pathname === "/" ? "/app" : `/app${url.pathname}`;
    const res = NextResponse.rewrite(url);
    res.headers.set("X-Robots-Tag", "noindex, nofollow");
    // Expose the public pathname to RSC layouts (PR 7 billing gate reads this).
    res.headers.set("x-pathname", req.nextUrl.pathname);
    return res;
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    // Skip Next.js internals and static assets unless referenced via search params
    "/((?!_next/static|_next/image|favicon.ico|manifest.json|icons/|.*\\.(?:png|jpg|jpeg|gif|webp|svg|ico|css|js|txt|xml|woff2?)).*)",
    // Always run for API routes
    "/(api|trpc)(.*)",
  ],
};
