import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect } from "@playwright/test";

// Known non-actionable warnings to ignore.
//
// The previous patterns (/hydrat/i and /did not match.*server/i) were
// too broad — ANY hydration error, including ones caused by OUR own
// code, slipped through. Narrow to third-party origins we can't fix:
// Clerk (UserButton) and Radix (aria-controls IDs generated client-side).
// The patterns require BOTH the "hydration/server-mismatch" substring
// AND a third-party marker so an in-app hydration bug still fails the
// smoke test.
//
// Known third-party markers as of 2026-04:
//   - "clerk"   — Clerk components / clerk.com URLs in stack traces
//   - "cl-"     — Clerk's generated class prefixes (cl-userButton-root, etc.)
//   - "radix"   — Radix UI component name or import path
//   - "@radix-ui" — same origin, scoped import form
const IGNORED_PATTERNS = [
  // Hydration warning/error originating in Clerk or Radix components.
  /hydrat.*(clerk|cl-|radix|@radix-ui)/i,
  /(clerk|cl-|radix|@radix-ui).*hydrat/i,
  // SSR/client mismatch originating in Clerk or Radix.
  /did not match.*server.*(clerk|cl-|radix|@radix-ui)/i,
  /(clerk|cl-|radix|@radix-ui).*did not match.*server/i,
];

// Collect console errors for every test
test.beforeEach(async ({ page }) => {
  // setupClerkTestingToken intercepts Clerk API requests to bypass bot protection.
  // Needed in CI alongside storageState to prevent auth redirects.
  await setupClerkTestingToken({ page });
  const errors: string[] = [];
  page.on("pageerror", (err) => errors.push(err.message));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      if (!IGNORED_PATTERNS.some((p) => p.test(text))) {
        errors.push(text);
      }
    }
  });

  // Store errors on page object for assertions
  (page as unknown as { __consoleErrors: string[] }).__consoleErrors = errors;
});

function getErrors(page: unknown): string[] {
  return (page as { __consoleErrors: string[] }).__consoleErrors ?? [];
}

const pages = [
  { name: "Home", path: "/" },
  { name: "Drafts", path: "/drafts" },
  { name: "Schedule", path: "/schedule" },
  { name: "Analytics", path: "/analytics" },
  { name: "Settings", path: "/settings" },
];

for (const { name, path } of pages) {
  test(`${name} page (${path}) loads without errors`, async ({ page }) => {
    const response = await page.goto(path);
    expect(response?.status()).toBe(200);
    await page.waitForLoadState("domcontentloaded");

    // Give time for any async errors to fire
    await page.waitForTimeout(500);

    const errors = getErrors(page);
    expect(errors, `Console errors on ${name} page`).toEqual([]);
  });
}

// Conversation pages are dynamic — the path includes a server-generated
// id — so we can't list them up-front. Instead we create a conversation
// via the home composer and verify /c/<id> renders without hydration
// or console errors. If SSR breaks for the conversation route, this
// catches it before the fuller conversation E2E does.
test("Conversation page (/c/<id>) loads without errors", async ({ page }) => {
  await page.goto("/");
  await page.waitForLoadState("domcontentloaded");

  // Reset any errors collected during the home-page load — we only want
  // to assert on errors fired by /c/<id> rendering.
  (page as unknown as { __consoleErrors: string[] }).__consoleErrors = [];

  // Use the same composer flow the real E2E uses so we exercise the
  // DB-backed creation path (ADR-002: DB is source of truth) instead
  // of fabricating a conversation id.
  const textarea = page.locator('textarea[placeholder*="Paste a tweet"]');
  await textarea.waitFor({ timeout: 10_000 });
  await textarea.fill("smoke: verify /c/<id> renders");
  await page.locator('button[aria-label="Send message"]').click();

  // /app routes rewrite to /c/<id> via middleware when on the app host.
  await page.waitForURL(/\/c\/[a-zA-Z0-9-]+/, { timeout: 15_000 });
  await page.waitForLoadState("domcontentloaded");

  // Give async errors a moment to fire (matches the other page tests).
  await page.waitForTimeout(500);

  const errors = getErrors(page);
  expect(errors, "Console errors on conversation page").toEqual([]);
});

test("unauthenticated user is redirected to sign-in", async ({ browser }) => {
  // Create a fresh context without stored auth and without Clerk testing cookies
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();

  // Go directly without any Clerk session — middleware should redirect
  const response = await page.goto("/");

  // Either redirected to sign-in, or the response came from sign-in
  const isOnSignIn = page.url().includes("/sign-in");
  const wasRedirected = response?.url().includes("/sign-in") ?? false;
  expect(isOnSignIn || wasRedirected).toBe(true);

  await context.close();
});
