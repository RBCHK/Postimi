# Clerk + Playwright E2E Testing

## Problem: `setupClerkTestingToken()` alone doesn't authenticate

`setupClerkTestingToken` only sets up route interception (appends `__clerk_testing_token` to Clerk API requests for captcha bypass). It does NOT sign the user in.

`clerk.signIn({ strategy: "password" })` uses `page.evaluate()` to call `window.Clerk.client.signIn.create()` — this silently fails if `window.Clerk.client` is null (returns early without error).

## Solution: UI-based sign-in + setupClerkTestingToken

1. Call `setupClerkTestingToken({ page })` — enables testing mode route interception
2. Navigate to `/sign-in` and fill email/password through the Clerk UI form
3. Handle device verification (factor-two) when it appears
4. Save `storageState` for other test projects to reuse

## Device verification (factor-two) handling

- Test emails with `+clerk_test` suffix use verification code `424242`
- Clerk OTP input: `page.keyboard.type("424242", { delay: 50 })` after focusing the input
- Clerk auto-submits after all 6 digits — no Continue click needed
- The hidden textbox has role `"Enter verification code"` but `fill()` doesn't work — use `keyboard.type()`

## Test user setup

Create via Clerk Backend API with `skip_password_checks: true`:

```bash
curl -X POST "https://api.clerk.com/v1/users" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -d '{"email_address":["e2e+clerk_test@postimi.com"],"password":"unique-pass","skip_password_checks":true}'
```

## Key gotchas

- `clerkSetup()` must run in Playwright `globalSetup` (function, not project) BEFORE dev server starts
- `setupClerkTestingToken` must still be called — it bypasses Clerk's bot protection
- Button selector: use `{ name: "Continue", exact: true }` — "Continue with Google" also matches `/continue/i`
- `storageState` paths can be relative (e.g., `"tests/.auth/user.json"`) — no need for `path.join(__dirname, ...)`
- Radix hydration warnings (`aria-controls` ID mismatch) are false positives — filter them out
