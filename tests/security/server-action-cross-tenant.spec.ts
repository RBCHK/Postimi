import { test } from "@playwright/test";

// Cross-tenant Server Action hardening — design notes.
//
// PR #66 removed every `userId: string` argument from Server Action
// signatures in src/app/actions/*.ts. Each action now calls
// `requireUserId()` as its first line and scopes Prisma queries by the
// authenticated id. Because the browser cannot inject an attacker
// `userId` into a signature that does not accept one, there is no
// runtime payload for a Playwright test to forge here.
//
// The guard that keeps it this way is STATIC, not runtime:
//   scripts/check-server-actions.sh         — grep-based pre-commit hook
//   scripts/__tests__/check-server-actions.test.sh — seeds each known
//     variant (positional, destructured, typed-bag, arrow-function)
//     and asserts the guard fails on each one.
//
// That static guard runs on every commit (.husky/pre-commit) and in
// CI, which is strictly stronger than a runtime test that could only
// ever prove "on the happy path, no leak was observed today".
//
// This file stays as a placeholder so the security/ directory is
// discoverable and future cross-tenant integration tests (e.g.
// multi-user DB-level assertions with a real Postgres) have an
// obvious home.
test.skip("cross-tenant Server Action guard — enforced at commit time by scripts/check-server-actions.sh", () => {
  // intentionally empty; see comment above
});
