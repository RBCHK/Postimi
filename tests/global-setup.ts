// clerkSetup() runs in globalSetup (clerk-global-setup.ts) BEFORE the dev server starts.
// This setup project authenticates programmatically via Clerk's ticket-based
// sign-in (no UI navigation) and saves auth state so all other projects can
// reuse it via storageState.
//
// Why ticket-based and not UI:
//   The previous UI flow (page.goto("/sign-in") → fill email/password →
//   maybe OTP → wait for redirect) was flaky in CI. Two problems:
//     1. Cold-compile of /sign-in under `next dev` ate the test timeout.
//     2. Each setup round-trip went through the Clerk dev API multiple
//        times, hitting throttling and adding latency.
//
//   `clerk.signIn({ emailAddress, page })` from @clerk/testing/playwright
//   uses Clerk Backend SDK to mint a sign-in token, then evaluates a
//   ticket-strategy sign-in inside the page. No /sign-in render, no
//   email/password form, no OTP — just `__session` cookie injection.
//   This is the pattern recommended in
//   https://clerk.com/docs/testing/playwright/test-authenticated-flows.
//
//   We still navigate to /sign-in (an unprotected, Clerk-loaded route) so
//   `window.Clerk` exists before calling clerk.signIn — the helper requires
//   it. We do NOT interact with the form.
import { clerk, setupClerkTestingToken } from "@clerk/testing/playwright";
import { test as setup, expect } from "@playwright/test";

setup("authenticate via clerk", async ({ page }, testInfo) => {
  const authFile =
    testInfo.project.name === "setup-mobile"
      ? "tests/.auth/mobile-user.json"
      : "tests/.auth/user.json";

  // Set up testing token route interception (bypasses captcha/bot protection).
  // Required even for ticket-based sign-in — Clerk's bot detection still
  // applies to the /v1/client and related FAPI calls the helper triggers.
  await setupClerkTestingToken({ page });

  // Navigate to /sign-in: a public route (per src/proxy.ts) that mounts
  // Clerk's <SignIn /> and therefore loads window.Clerk. We do not interact
  // with the form — clerk.signIn() will hijack window.Clerk directly.
  await page.goto("/sign-in");
  await page.waitForLoadState("domcontentloaded");

  // Programmatic ticket-based sign-in. Under the hood:
  //   1. Backend SDK looks up user by email (CLERK_SECRET_KEY required).
  //   2. Backend SDK creates a 5-minute sign-in token.
  //   3. page.evaluate() drives window.Clerk.client.signIn.create({
  //        strategy: 'ticket', ticket
  //      }) which sets __session and clerk_db_jwt cookies.
  //   4. Helper waits for window.Clerk.user to be populated.
  await clerk.signIn({
    page,
    emailAddress: process.env.E2E_CLERK_USER_USERNAME!,
  });

  // Sanity check: navigate to a protected route and confirm we land there
  // instead of bouncing back to /sign-in. Without this the storageState
  // could be saved with no usable cookies and downstream projects would
  // silently run unauthenticated.
  await page.goto("/");
  await page.waitForURL((url) => !url.toString().includes("/sign-in"), {
    timeout: 15_000,
  });
  await expect(page.locator("body")).toBeVisible();

  // Grant an active subscription so AI endpoints aren't blocked by
  // requireActiveSubscription. Endpoint is gated by ALLOW_TEST_SEED.
  const grantRes = await page.request.post("/api/test/grant-subscription");
  if (!grantRes.ok()) {
    throw new Error(
      `Failed to seed test subscription: ${grantRes.status()} ${await grantRes.text()}`
    );
  }

  // Persist auth state for all other projects.
  await page.context().storageState({ path: authFile });
});
