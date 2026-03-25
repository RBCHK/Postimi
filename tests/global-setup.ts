// clerkSetup() runs in globalSetup (clerk-global-setup.ts) BEFORE the dev server starts.
// This setup project signs in via the Clerk UI and saves auth state
// so all other projects can reuse it via storageState.
import { setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect } from "@playwright/test";

const authFile = "tests/.auth/user.json";

setup("authenticate via clerk", async ({ page }) => {
  // Set up testing token route interception (bypasses captcha/bot protection)
  await setupClerkTestingToken({ page });

  // Navigate to sign-in page
  await page.goto("/sign-in");
  await page.waitForLoadState("domcontentloaded");

  // Fill in credentials via the Clerk UI form
  const emailInput = page.locator('input[name="identifier"], input[placeholder*="email"]');
  await emailInput.waitFor({ timeout: 10_000 });
  await emailInput.fill(process.env.E2E_CLERK_USER_USERNAME!);

  const passwordInput = page.locator('input[name="password"], input[type="password"]');
  await passwordInput.waitFor({ timeout: 5_000 });
  await passwordInput.fill(process.env.E2E_CLERK_USER_PASSWORD!);

  // Click Continue to submit credentials
  await page.getByRole("button", { name: "Continue", exact: true }).click();

  // Handle device verification (Clerk sends email code for new devices).
  // Test emails with +clerk_test use verification code 424242.
  // Wait for either redirect to home (no verification) or factor-two page
  await page.waitForURL(
    (url) => {
      const u = url.toString();
      return !u.includes("/sign-in") || u.includes("factor-two");
    },
    { timeout: 10_000 }
  );

  if (page.url().includes("factor-two")) {
    // Clerk OTP input: click the first visible input box and type all digits
    const otpInput = page.locator('input[name="codeInput"]').first();
    if (await otpInput.isVisible({ timeout: 3_000 }).catch(() => false)) {
      await otpInput.click();
      await page.keyboard.type("424242", { delay: 50 });
    } else {
      // Fallback: focus the OTP area and type via keyboard
      const otpArea = page.getByRole("textbox", { name: /verification/i });
      await otpArea.click();
      await page.keyboard.type("424242", { delay: 50 });
    }
    // Clerk auto-submits after all 6 digits are entered — no Continue click needed
  }

  // Wait for successful auth — should redirect away from sign-in
  await page.waitForURL((url) => !url.toString().includes("/sign-in"), { timeout: 15_000 });
  await expect(page.locator("body")).toBeVisible();

  // Persist auth state for all other projects
  await page.context().storageState({ path: authFile });
});
