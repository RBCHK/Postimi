import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect } from "@playwright/test";

// Known non-actionable warnings to ignore
const IGNORED_PATTERNS = [
  /hydrat/i, // React/Next.js hydration mismatches (Clerk UserButton, Radix aria-controls)
  /did not match.*server/i, // React SSR/client mismatch
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
