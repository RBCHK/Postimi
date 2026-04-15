# E2E: seed subscription when gating AI/billing endpoints

Adding `requireActiveSubscription` (or any paywall gate) to an endpoint used by Playwright tests will silently break e2e: the test user signs in fine, but `POST /api/chat` returns 402 → AI response never arrives → `waitFor` on `[data-role="assistant"]` times out. Network trace shows `402 POST /api/chat`, no assistant message.

## Symptom

- Desktop conversation tests time out at assistant-message locator.
- e2e artifact trace network log: `402 POST http://localhost:3000/api/chat`.
- Unit tests + typecheck + lint all green — only e2e catches it.

## Fix

1. Test-only endpoint `/api/test/grant-subscription` gated by `ALLOW_TEST_SEED === "true"` (404 otherwise). Upserts an ACTIVE Subscription for the authenticated user.
2. `tests/global-setup.ts` after sign-in: `await page.request.post("/api/test/grant-subscription")` before saving storageState.
3. CI workflow env: `ALLOW_TEST_SEED: "true"` in the e2e job (never in production).

## Rule

When adding a new DB-gate (subscription, quota, feature flag) to any endpoint an e2e test hits, also seed the DB state in `global-setup.ts`. Type-checking cannot catch "test user lacks row X".
