import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test, expect } from "@playwright/test";

// setupClerkTestingToken adds route interception for Clerk API requests.
// Needed in CI alongside storageState to prevent Clerk bot protection redirects.
test.beforeEach(async ({ page }) => {
  await setupClerkTestingToken({ page });
});

test.describe("Conversation flow", () => {
  test("create conversation and get AI response", async ({ page }) => {
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");

    // Type a message on the home page
    const textarea = page.locator('textarea[placeholder*="Paste a tweet"]');
    await textarea.waitFor({ timeout: 10_000 });
    await textarea.fill("What's a good reply to a tweet about TypeScript?");

    // Send — creates conversation and navigates to /c/[id]
    await page.locator('button[aria-label="Send message"]').click();
    await page.waitForURL(/\/c\/[a-zA-Z0-9-]+/, { timeout: 15_000 });
    expect(page.url()).toMatch(/\/c\/[a-zA-Z0-9-]+/);

    // User message from home should be visible
    const userMessage = page.locator('[data-role="user"]');
    await userMessage.waitFor({ timeout: 10_000 });
    await expect(userMessage).toContainText("TypeScript");

    // Send a follow-up to trigger AI response
    const conversationTextarea = page.locator('textarea[placeholder*="Paste a tweet"]');
    await conversationTextarea.fill("Give me 3 options");
    await page.locator('button[aria-label="Send message"]').click();

    // AI response should appear (from mock or real API)
    const assistantMessage = page.locator('[data-role="assistant"]').first();
    await assistantMessage.waitFor({ timeout: 30_000 });
    await expect(assistantMessage).not.toBeEmpty();
  });

  test("multiple messages in a conversation", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator('textarea[placeholder*="Paste a tweet"]');
    await textarea.waitFor({ timeout: 10_000 });
    await textarea.fill("Help me write a post about React hooks");
    await page.locator('button[aria-label="Send message"]').click();
    await page.waitForURL(/\/c\/[a-zA-Z0-9-]+/, { timeout: 15_000 });

    // Send first follow-up to trigger AI
    const input = page.locator('textarea[placeholder*="Paste a tweet"]');
    await input.fill("Draft a punchy opening line");
    await page.locator('button[aria-label="Send message"]').click();

    // Wait for AI response
    const firstAssistant = page.locator('[data-role="assistant"]').first();
    await firstAssistant.waitFor({ timeout: 30_000 });

    // Send second follow-up
    await input.fill("Make it more concise");
    await page.locator('button[aria-label="Send message"]').click();

    // Should have 3 user messages and 2 assistant messages
    await expect(page.locator('[data-role="user"]')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(2, { timeout: 30_000 });
  });
});
