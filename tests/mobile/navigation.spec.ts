import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect } from "@playwright/test";

// setupClerkTestingToken adds route interception for Clerk API requests.
// WebKit on Linux (CI) needs this in addition to storageState — without it,
// Clerk's bot protection redirects to sign-in on subsequent navigations.
test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

// These tests only run in the mobile-safari project (iPhone 15 Pro viewport)
test.describe("Mobile navigation", () => {
  test("bottom nav is visible on mobile viewport", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const bottomNav = page.locator("nav.fixed.bottom-0");
    await expect(bottomNav).toBeVisible();

    // Verify all nav items are present
    await expect(bottomNav.getByText("Home")).toBeVisible();
    await expect(bottomNav.getByText("Drafts")).toBeVisible();
    await expect(bottomNav.getByText("Schedule")).toBeVisible();
    await expect(bottomNav.getByText("Analytics")).toBeVisible();
  });

  test("navigate between pages via bottom nav", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const bottomNav = page.locator("nav.fixed.bottom-0");

    // Navigate to Drafts
    await bottomNav.getByText("Drafts").click();
    await page.waitForURL("**/drafts");
    expect(page.url()).toContain("/drafts");

    // Navigate to Schedule
    await bottomNav.getByText("Schedule").click();
    await page.waitForURL("**/schedule");
    expect(page.url()).toContain("/schedule");

    // Navigate back to Home
    await bottomNav.getByText("Home").click();
    await page.waitForURL(/\/$/);
  });

  test("header and bottom nav apply safe-area-inset utility classes", async ({ page }) => {
    // CLAUDE.md: on iPhone PWA the header must use pt-[env(safe-area-inset-top)]
    // to clear the Dynamic Island, and the bottom nav must use
    // pb-[env(safe-area-inset-bottom)] to clear the home indicator.
    //
    // We assert the class is present rather than the computed style —
    // Playwright's WebKit emulation does not render env() the same way
    // Safari-on-device does, so getComputedStyle().paddingBottom reports
    // 0px and becomes a flaky signal. The class presence is what ships.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const header = page.locator("header").first();
    await expect(header).toHaveClass(/pt-\[env\(safe-area-inset-top\)\]/);

    const bottomNav = page.locator("nav.fixed.bottom-0");
    await expect(bottomNav).toHaveClass(/pb-\[env\(safe-area-inset-bottom\)\]/);
  });

  test("chat input has font size >= 16px (prevents iOS auto-zoom)", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const textarea = page.locator('textarea[placeholder*="Paste a tweet"]');
    await textarea.waitFor({ timeout: 10_000 });

    const fontSize = await textarea.evaluate((el) => {
      return parseFloat(window.getComputedStyle(el).fontSize);
    });

    expect(fontSize).toBeGreaterThanOrEqual(16);
  });

  test("conversation flow works on mobile", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    const textarea = page.locator('textarea[placeholder*="Paste a tweet"]');
    await textarea.waitFor({ timeout: 10_000 });
    await textarea.click();
    // Use pressSequentially for WebKit — fill() may not trigger React onChange
    await textarea.pressSequentially("Quick mobile test", { delay: 20 });

    // Wait for send button to become enabled
    const sendButton = page.locator('button[aria-label="Send message"]:not([disabled])');
    await sendButton.waitFor({ timeout: 5_000 });
    await sendButton.click();

    // Should navigate to conversation
    await page.waitForURL(/\/c\/[a-zA-Z0-9-]+/, { timeout: 15_000 });

    // User message visible
    const userMessage = page.locator('[data-role="user"]');
    await userMessage.waitFor({ timeout: 10_000 });
    await expect(userMessage).toContainText("Quick mobile test");

    // Send follow-up to trigger AI
    const input = page.locator('textarea[placeholder*="Paste a tweet"]');
    await input.click();
    await input.pressSequentially("Give me ideas", { delay: 20 });
    const sendBtn = page.locator('button[aria-label="Send message"]:not([disabled])');
    await sendBtn.waitFor({ timeout: 5_000 });
    await sendBtn.click();

    // AI response arrives
    const assistantMessage = page.locator('[data-role="assistant"]').first();
    await assistantMessage.waitFor({ timeout: 30_000 });
  });
});
