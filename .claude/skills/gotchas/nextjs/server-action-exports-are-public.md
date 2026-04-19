# Every exported async function from a `"use server"` file is a public Server Action — "Internal" naming does not protect it

## Tried

Dual-export pattern to share logic between public Server Actions and cron routes:

```ts
// src/app/actions/x-token.ts
"use server";

export async function getXApiTokenForUser() {
  const userId = await requireUserId();
  return _getToken(userId);
}

export async function getXApiTokenForUserInternal(userId: string) {
  // called by cron, "internal" naming = don't call from client
  return _getToken(userId);
}
```

This pattern was previously codified in `CLAUDE.md` under "Auth (Clerk)" as the recommended way to share helpers between cron routes and public actions.

## Broke

Phase 1b security audit (2026-04-19, PR #65) surfaced this as a **critical cross-tenant vulnerability**:

- In Next.js 15 App Router, **every** `export async function` from a `"use server"` file is registered as a callable Server Action. The browser can POST to it with arbitrary arguments.
- `getXApiTokenForUserInternal(userId)` is not protected by anything — the word "Internal" is a naming convention, not enforcement. Any logged-in user could open DevTools, POST with a victim's `userId`, and receive the victim's **decrypted OAuth access token**.
- Same pattern existed across 15+ helpers: `saveXApiToken`, `getSocialAnalyticsSummaryInternal`, `savePlanProposalInternal`, `deleteResearchNoteInternal`, `saveFollowersSnapshotInternal`, etc. Every `*Internal(userId: string, ...)` export is a cross-tenant read/write primitive.
- Unit tests don't catch this — the functions work correctly when called correctly. The vulnerability is in _who can call them_, not in their logic.

## Fix

Split public entrypoints from private helpers by **file**, not by naming convention:

- `src/lib/server/*.ts` — plain module (NO `"use server"` directive at top). Exports helpers that accept `userId: string` as an argument and do the work. These are **not** Server Actions; the browser cannot call them.
- `src/app/actions/*.ts` — `"use server"` module. Every exported function starts with `const userId = await requireUserId()` and then calls into `@/lib/server/...`.
- Cron routes and webhooks import from `@/lib/server/*`, never from `@/app/actions/*`.

```ts
// src/lib/server/x-token.ts  (NO "use server")
export async function getXApiTokenForUser(userId: string): Promise<Credentials | null> {
  return _fetchAndDecrypt(userId);
}

// src/app/actions/x-token.ts
("use server");
import { getXApiTokenForUser as _getXApiTokenForUser } from "@/lib/server/x-token";
export async function getXApiTokenForUser(): Promise<Credentials | null> {
  const userId = await requireUserId();
  return _getXApiTokenForUser(userId);
}

// src/app/api/cron/*/route.ts
import { getXApiTokenForUser } from "@/lib/server/x-token";
// no "use server" exposure, cron passes userId directly
```

## Detection

Grep guard — any match is a security bug:

```bash
# Find every "Internal" helper in "use server" files
rg -l '^"use server"' src/app/actions/ | \
  xargs rg 'export async function \w+Internal\(' -n
```

Broader pattern to watch for:

```bash
# Any exported function taking raw userId from a "use server" file
rg -l '^"use server"' src/app/actions/ | \
  xargs rg 'export async function \w+\(\s*userId:\s*string' -n
```

Either match = the browser can call it with an attacker-controlled userId. Pre-commit hook or CI should fail on non-empty output.

## Watch out

- This is **not** caught by `tsc` or `eslint` or unit tests. Only architectural review catches it.
- "But cron needs to call this" is not a reason to export it as a Server Action — use `@/lib/server/*` imports for cron.
- If a helper genuinely needs the userId from the session and exists only for cron (no public equivalent), it still belongs in `@/lib/server/*` — cron passes the userId, the helper takes it as an argument. There is **never** a reason to export a `(userId: string) => ...` function from a `"use server"` file.
- Server Components can also call `@/lib/server/*` helpers directly (passing the session userId from `requireUserId()` or equivalent); they don't need to route through a Server Action.
