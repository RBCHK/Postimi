# Clerk + Playwright E2E Testing

## Use ticket-based sign-in, not the UI form

The UI flow (page.goto("/sign-in") → fill email → fill password → maybe OTP →
wait for redirect) is flaky in CI. Two reasons:

1. Under `next dev`, /sign-in cold-compiles on first request — 20–30s on
   GitHub Actions, blowing the 30s test timeout.
2. Each full UI round-trip hits the Clerk dev FAPI several times for the
   client config / sign-in / verification endpoints. Latency + throttling
   cause sporadic `net::ERR_ABORTED` and timeout failures.

The recommended pattern (https://clerk.com/docs/testing/playwright/test-authenticated-flows)
is `clerk.signIn({ emailAddress, page })` from `@clerk/testing/playwright`.
Under the hood it:

1. Mints a 5-minute sign-in token via Clerk Backend SDK (requires
   `CLERK_SECRET_KEY` in env).
2. Calls `window.Clerk.client.signIn.create({ strategy: "ticket", ticket })`
   inside the page, which sets `__session` + `clerk_db_jwt` cookies.
3. Waits for `window.Clerk.user` to populate.

It still requires:

- `clerkSetup()` in a Playwright `globalSetup` function (NOT a project) before
  the dev server starts, so the testing publishable key is wired into env.
- A page navigation to a Clerk-loaded route BEFORE calling `clerk.signIn()` —
  the helper needs `window.Clerk` to exist. `/sign-in` is the natural choice
  on Postimi (it's public per src/proxy.ts and mounts <SignIn />). We do NOT
  fill the form — `clerk.signIn()` hijacks `window.Clerk` directly.
- `setupClerkTestingToken({ page })` for bot/captcha bypass on FAPI calls.

After `clerk.signIn()`, save `storageState` for downstream projects.

## All three Clerk testing layers are still required

`setupClerkTestingToken()` alone does NOT authenticate. All three needed:

1. `clerkSetup()` in `globalSetup` — wires Clerk testing publishable key into env.
2. `clerk.signIn({ emailAddress, page })` in setup project — produces
   `storageState` (was: UI form fill + storageState).
3. `setupClerkTestingToken({ page })` in every test's `beforeEach` — bypasses
   bot protection on FAPI calls during the test run itself.

`clerk.signIn({ strategy: "password" })` uses `page.evaluate()` to call
`window.Clerk.client.signIn.create()` — this silently fails if
`window.Clerk.client` is null (returns early without error). The
`emailAddress` variant is more reliable because it gates on a server-side
token before touching `window.Clerk`.

## CI: use `next start`, not `next dev`

Local dev keeps `npm run dev` for fast iteration. CI runs against a
production build (`npm run build && npm run start`) — eliminates on-demand
compilation, makes routing deterministic, and matches how users hit the app.
Pay a one-time ~60s build; webServer timeout should be ≥180s in CI to
absorb cold runner latency.

```ts
webServer: [
  {
    command: process.env.CI ? "npm run build && npm run start" : "npm run dev",
    url: baseURL,
    reuseExistingServer: !process.env.CI,
    timeout: process.env.CI ? 180_000 : 60_000,
    env: { ...process.env, ANTHROPIC_BASE_URL: "http://localhost:4567/v1" },
  },
],
```

## Test user setup

Create via Clerk Backend API with `skip_password_checks: true` — note the
`+clerk_test` suffix isn't strictly required when using ticket-based sign-in
(no OTP path), but it's still useful for any UI-flow tests that remain:

```bash
curl -X POST "https://api.clerk.com/v1/users" \
  -H "Authorization: Bearer $CLERK_SECRET_KEY" \
  -d '{"email_address":["e2e+clerk_test@postimi.com"],"password":"unique-pass","skip_password_checks":true}'
```

## Other gotchas

- `clerkSetup()` must run in Playwright `globalSetup` (function, not project)
  BEFORE the dev server starts.
- `storageState` paths can be relative (e.g., `"tests/.auth/user.json"`).
- Radix hydration warnings (`aria-controls` ID mismatch) are false positives —
  filter them out.
- If you ever need to fall back to the UI form, button selector is
  `{ name: "Continue", exact: true }` — "Continue with Google" also matches
  `/continue/i`. The factor-two OTP input takes
  `page.keyboard.type("424242", { delay: 50 })`; `fill()` doesn't fire React
  onChange.
