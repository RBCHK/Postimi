# xREBA — Project Guide for Claude

## Stack
- **Next.js 15** (App Router), **TypeScript**, **Prisma** (PostgreSQL)
- AI: `@ai-sdk/react` + `@ai-sdk/anthropic`, streaming via `/api/chat`
- Prisma client: import from `src/generated/prisma/`, NOT `@prisma/client`

## Key Directories
- `src/app/(app)/` — routes: home (`/`), conversation (`/c/[id]`)
- `src/app/actions/` — Server Actions (DB layer)
- `src/app/api/chat/` — streaming AI endpoint
- `src/contexts/conversation-context.tsx` — conversation state + AI chat
- `src/prompts/` — system prompts (analyst-reply.ts, analyst-post.ts)
- `src/lib/types.ts` — shared types

## Architecture Decisions

**DB is the source of truth for messages** — save to DB before sending to AI.
No URL params for passing content — save to DB first, then redirect to `/c/{id}`.

**ConversationProvider owns all AI state** — auto-start, sending, saving.
See JSDoc in `conversation-context.tsx` for the contract.

**Language settings in localStorage, not DB** — per-device preference, not per-conversation.

## Conventions

**Prisma enums are UPPER_CASE; app types are PascalCase** — use mapping records, never cast directly.

**Adding a new ContentType**: use `/add-content-type` skill.

**Page layout standard**: all new `*-view.tsx` files must use `<PageContainer>` from `@/components/page-container` as the root element. Add extra classes via `className` prop (e.g. `className="space-y-4"`).

## Mobile / PWA Rules

IMPORTANT: This app runs as a PWA on iPhone — always apply these rules when touching layout or UI.

- **Safe area top**: Header must wrap content in inner `div` and use `pt-[env(safe-area-inset-top)]` on the `<header>` — never use fixed height alone
- **Safe area bottom**: Bottom nav must use `pb-[env(safe-area-inset-bottom)]` (already in `MobileBottomNav`)
- **Touch targets**: Minimum 44×44px for all tappable elements
- **Input zoom**: Font size ≥ 16px on `<input>` and `<textarea>` — smaller sizes trigger iOS auto-zoom
- **Hover states**: Wrap `hover:` utilities with `[@media(hover:hover)]:hover:` — bare `hover:` sticks on touch
- **Test**: Safari DevTools → Responsive → iPhone 15 Pro (Dynamic Island) before considering mobile done

## Web Quality Standards

- **Core Web Vitals**: LCP < 2.5s, FID < 100ms, CLS < 0.1
- **Lighthouse**: Performance and Accessibility scores > 90
- **Zero console errors** in production
- **Accessibility**: semantic HTML, ARIA labels on interactive elements, keyboard navigable
- **TypeScript**: no `any`, no suppressed errors

## Error Handling Rules

IMPORTANT: Always wrap in try/catch when there is a network, disk, or external process between your code and execution:

- **External HTTP / SDK calls** — fetch, X API, Anthropic, Tavily, any third-party SDK
- **Database** — all Prisma calls (connection drop, constraint violation, timeout)
- **File system** — `fs.readFile`, `fs.writeFile` (file missing, no permissions)
- **JSON.parse** — any data from external sources is never guaranteed valid
- **Background tasks without a caller** — cron jobs, webhooks, queue workers (no one catches above)

Pattern for API routes and cron handlers:
```ts
try {
  // ... main logic
  return NextResponse.json({ ok: true, ... });
} catch (err) {
  console.error("[route-name]", err);
  return NextResponse.json(
    { ok: false, error: err instanceof Error ? err.message : String(err) },
    { status: 500 }
  );
}
```

## Code Review Priorities

When reviewing or fixing code, classify issues by severity:
- 🔴 **Blocker**: XSS, SQL injection, auth bypass, data loss, race conditions — fix immediately
- 🟡 **Should fix**: N+1 queries, missing input validation, no error handling for critical paths
- 💭 **Nice to have**: naming, docs, alternative patterns

## Testing

- **Framework**: Vitest (`npm test` / `npm run test:watch`)
- **Test files location**: `src/**/*.test.ts` — currently `src/lib/__tests__/` and `src/app/actions/__tests__/`
- IMPORTANT: Always check `package.json` and `src/**/*.test.ts` before concluding "no tests exist"
- When fixing a bug in a utility function, check if a test file exists for it and add a regression test

## Workflow Rules

IMPORTANT: Before executing any task, check `.claude/skills/` for a relevant skill and use it.
IMPORTANT: If a task is multi-step and repeatable — create a skill for it using `/create-skill`.
IMPORTANT: After completing a task that touched 3+ files with the same pattern — suggest creating a skill (propose, don't auto-create).
IMPORTANT: Use Plan Mode (Shift+Tab) for any change touching 3+ files.
IMPORTANT: Start a fresh session (`/clear`) for each new task.
IMPORTANT: After implementing, verify with `npx tsc --noEmit` (also runs automatically via hook after every file edit).
