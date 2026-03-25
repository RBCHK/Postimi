# src/proxy.ts — NOT a dead file

## The trap

`src/proxy.ts` is not imported anywhere — `grep` finds zero imports.
It looks like dead code. **It is not.**

## Why it exists

Next.js 16 renamed the `middleware.ts` convention to `proxy.ts`.
The framework auto-detects `proxy.ts` (or `src/proxy.ts`) at the file-system level — no imports needed.

- `middleware.ts` → Edge Runtime (Next.js ≤15)
- `proxy.ts` → Node.js Runtime (Next.js 16+)

## What it does

Runs Clerk `auth.protect()` at the request boundary — before any page renders.
Public routes (sign-in, sign-up, cron, webhooks) are excluded.

## Git history

- `7fc61a7` — created as `src/middleware.ts`
- `cf2707f0` — renamed to `src/proxy.ts` for Next.js 16

## Rule

Never delete or rename `src/proxy.ts`. It is the auth boundary for the entire app.
