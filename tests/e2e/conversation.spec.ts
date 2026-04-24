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

  test("/api/chat failure surfaces error banner and preserves the user's message", async ({
    page,
  }) => {
    // CLAUDE.md: "If user input is cleared optimistically before async
    // operations, wrap in try/catch and restore the input on failure."
    //
    // For /api/chat specifically, the user message is persisted to the DB
    // BEFORE the chat call, so clearing the textarea is correct — the
    // message is not lost. What the user needs is:
    //   (a) a visible error banner telling them the AI response failed
    //   (b) their original user message still rendered in the conversation
    //       so they can retry (e.g. with a follow-up) without re-typing
    //
    // This test locks both.

    // First, get into an existing conversation so we bypass the home
    // flow's fetchTweetFullTextAction path.
    await page.goto("/");
    await page.waitForLoadState("domcontentloaded");
    const homeTextarea = page.locator('textarea[placeholder*="Paste a tweet"]');
    await homeTextarea.waitFor({ timeout: 10_000 });
    await homeTextarea.fill("Seed message to enter a conversation");
    await page.locator('button[aria-label="Send message"]').click();
    await page.waitForURL(/\/c\/[a-zA-Z0-9-]+/, { timeout: 15_000 });

    // Wait for the first AI response (unblocked) so we're in the steady
    // state before we break /api/chat.
    await page.locator('[data-role="assistant"]').first().waitFor({ timeout: 30_000 });

    // Now break /api/chat — every subsequent request returns 500.
    await page.route("**/api/chat", (route) =>
      route.fulfill({
        status: 500,
        contentType: "application/json",
        body: JSON.stringify({ error: "internal_server_error" }),
      })
    );

    // Send a follow-up that will trip the stubbed 500.
    const input = page.locator('textarea[placeholder*="Paste a tweet"]');
    await input.fill("This will fail to get an AI response");
    await page.locator('button[aria-label="Send message"]').click();

    // (a) The user message is preserved in the conversation — not lost.
    //     Two user messages total (seed + retry); both must be visible.
    await expect(page.locator('[data-role="user"]')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.locator('[data-role="user"]').last()).toContainText(
      "This will fail to get an AI response"
    );

    // (b) An error banner appears — the AI SDK surfaces the 500 via its
    //     `error` state, which the ConversationView renders as AiErrorBanner.
    //     AiErrorBanner falls through to the generic banner (tone="error")
    //     when the body isn't one of the known error kinds, so we assert
    //     on a visible role="alert"-like banner containing any text.
    const banner = page.locator("p.text-red-400, p.text-amber-300").first();
    await expect(banner).toBeVisible({ timeout: 10_000 });
  });

  test("multiple messages in a conversation", async ({ page }) => {
    await page.goto("/");
    const textarea = page.locator('textarea[placeholder*="Paste a tweet"]');
    await textarea.waitFor({ timeout: 10_000 });
    await textarea.fill("Help me write a post about React hooks");
    await page.locator('button[aria-label="Send message"]').click();
    await page.waitForURL(/\/c\/[a-zA-Z0-9-]+/, { timeout: 15_000 });

    // AI auto-starts on the first message — wait for it before sending follow-ups
    const firstAssistant = page.locator('[data-role="assistant"]').first();
    await firstAssistant.waitFor({ timeout: 30_000 });

    // Send first follow-up
    const input = page.locator('textarea[placeholder*="Paste a tweet"]');
    await input.fill("Draft a punchy opening line");
    await page.locator('button[aria-label="Send message"]').click();

    await expect(page.locator('[data-role="assistant"]')).toHaveCount(2, { timeout: 30_000 });

    // Send second follow-up
    await input.fill("Make it more concise");
    await page.locator('button[aria-label="Send message"]').click();

    // 3 user messages, 3 assistant messages (AI responds to every message)
    await expect(page.locator('[data-role="user"]')).toHaveCount(3, { timeout: 15_000 });
    await expect(page.locator('[data-role="assistant"]')).toHaveCount(3, { timeout: 30_000 });
  });
});
