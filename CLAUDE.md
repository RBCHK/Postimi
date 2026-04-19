# Postimi — Project Guide for Claude

## Stack

- **Next.js 15** (App Router), **TypeScript**, **Prisma** (PostgreSQL on Supabase)
- **Auth**: Clerk (`@clerk/nextjs`) — email + Google OAuth
- AI: `@ai-sdk/react` + `@ai-sdk/anthropic`, streaming via `/api/chat`
- Prisma client: import from `src/generated/prisma/`, NOT `@prisma/client`
- Prisma uses a driver adapter (`@prisma/adapter-pg`) — `new PrismaClient()` alone will fail. Always initialize with the adapter, same as `src/lib/prisma.ts`.

## Key Directories

- `src/app/app/` — product routes (home, conversation, schedule, analytics, etc.)
- `src/app/` — marketing routes (landing, waitlist, legal, sign-in)
- `src/proxy.ts` — host-aware middleware: app.postimi.com → rewrite to /app/\*, marketing → static pages
- `src/app/actions/` — Server Actions (DB layer)
- `src/app/api/chat/` — streaming AI endpoint
- `src/app/api/webhooks/clerk/` — Clerk webhook for user sync
- `src/contexts/conversation-context.tsx` — conversation state + AI chat
- `src/prompts/` — system prompts (analyst-reply.ts, analyst-post.ts)
- `src/lib/auth.ts` — `requireUserId()` helper (Clerk → Prisma User)
- `src/lib/types.ts` — shared types

## Architecture Decisions

See `docs/adr/` for full reasoning. Rules:

- **DB is the source of truth for messages** — save to DB before sending to AI. No URL params. ([ADR-002](docs/adr/002-db-source-of-truth.md))
- **ConversationProvider owns all AI state** — auto-start, sending, saving. ([ADR-003](docs/adr/003-conversation-provider.md))
- **Language settings in localStorage, not DB** — per-device preference, not per-conversation.

## Timezone Rules

IMPORTANT: xREBA is multi-user on Vercel (UTC). Never assume server TZ = user TZ.

- **Client → Server**: pass `Intl.DateTimeFormat().resolvedOptions().timeZone` with server actions
- **Server-side "today"**: `now.toLocaleDateString("en-CA", { timeZone })` → `new Date(\`${str}T00:00:00.000Z\`)`
- **Calendar dates**: extract with `calendarDateStr()` — never `toLocaleDateString(tz)` ([ADR-001](docs/adr/001-calendar-date-convention.md))
- **Cron routes**: `setUTCDate` / `setUTCHours` — never bare `setDate` / `setHours`

## Auth (Clerk)

- **All server actions** must call `const userId = await requireUserId()` as their first line and include `userId` in every Prisma where/create.
- **API routes** use `const { userId: clerkId } = await auth()` from `@clerk/nextjs/server`.
- **Cron routes** use Bearer token only (`CRON_SECRET`), loop over all users via `prisma.user.findMany()`.
- **Cron-compatible logic**: split by **file**, not by naming convention.
  - Private helpers live in `src/lib/server/*.ts` (NO `"use server"` directive). They accept `userId: string` and do the work. The browser cannot call them.
  - Public Server Actions in `src/app/actions/*.ts` (with `"use server"`) start with `const userId = await requireUserId()` and then call into `@/lib/server/*`.
  - Cron routes and webhooks import from `@/lib/server/*`, never from `@/app/actions/*`.
  - **ANTI-PATTERN (forbidden)**: exporting `functionInternal(userId: string, ...)` from a `"use server"` file. In Next.js 15 App Router every exported async function from such a file is a callable Server Action — the browser can POST with an attacker-controlled `userId` and read/write another user's data. "Internal" is a naming convention, not enforcement. See `.claude/skills/gotchas/nextjs/server-action-exports-are-public.md`.
  - **Grep guard** (any match = security bug): `rg -l '^"use server"' src/app/actions/ | xargs rg 'export async function \w+\(\s*userId:\s*string' -n` — pre-commit or CI should fail on non-empty output.
- **User sync**: Clerk webhook at `/api/webhooks/clerk` upserts Prisma `User` via `svix` signature verification.
- **Social network OAuth** (X, LinkedIn, Threads) is separate from auth — per-user tokens stored in DB.

## Conventions

**Prisma enums are UPPER_CASE; app types are PascalCase** — use mapping records, never cast directly.

**Adding a new ContentType**: use `/add-content-type` skill.

**Page layout standard**: all new `*-view.tsx` files must use `<PageContainer>` from `@/components/page-container` as the root element. Add extra classes via `className` prop (e.g. `className="space-y-4"`).

**Server pages must be dynamic**: any `page.tsx` that calls Server Actions or Prisma at the top level must have `export const dynamic = "force-dynamic"`. Without it, Next.js tries to statically prerender at build time and fails without a real DB.

## Design System

**Typography scale** (строго — не изобретай новые размеры):

- Page title: `text-xl font-semibold` → используй `<PageHeader>` из `@/components/page-header`
- Section label: `text-xs font-medium uppercase tracking-wider text-muted-foreground` → используй `<SectionLabel>` из `@/components/section-label`
- Card title: `text-sm font-medium`
- Body: `text-sm`
- Caption: `text-xs`

**Shared UI components** (используй вместо inline-стилей):

- `<PageHeader title icon? subtitle?>` — заголовок любой страницы, с children для action buttons
- `<SectionLabel icon?>` — заголовок секции/группы
- `<EmptyState message description? icon? size?>` — пустое состояние (compact/default/large)
- `<ChartTooltip>` — tooltip для Recharts графиков (UTC date parsing)

**Spacing**: кратно 4px. Предпочитай: `4 8 12 16 24 32 48 64` (Tailwind: 1 2 3 4 6 8 12 16).

**Border-radius**: `rounded-lg` для карточек/контейнеров, `rounded-md` для кнопок/инпутов, `rounded-xl` только для shadcn `<Card>`.

**Карточки**: не дублируй стили — используй shadcn `<Card>` или `rounded-lg border p-4`.

**Кнопки**: только shadcn `<Button>` с существующими size variants. Не используй кастомные `h-7`, `h-10` или raw `<button>`.

## Mobile / PWA Rules

IMPORTANT: PWA on iPhone — apply when touching layout or UI.

- **Safe areas**: `pt-[env(safe-area-inset-top)]` on `<header>`, `pb-[env(safe-area-inset-bottom)]` on bottom nav
- **Touch targets**: min 44×44px
- **Input zoom**: font ≥ 16px on inputs/textareas (iOS auto-zoom)
- **Hover**: `[@media(hover:hover)]:hover:` — never bare `hover:` (sticks on touch)
- **Overriding shadcn variant styles**: `cn()` (Tailwind Merge) resolves conflicts only when modifier format matches exactly (e.g. `hover:bg-X` vs `hover:bg-Y`). Non-standard modifiers like `[@media(hover:hover)]:hover:` won't override the variant's `hover:` — use `!` (important) suffix in such cases.
- **Test**: Safari → iPhone 15 Pro (Dynamic Island)

## Quality

- **No hacks or workarounds**: always implement the architecturally correct solution. Separate concerns properly (e.g. build vs deploy, CI vs production). If a quick fix "works", ask whether it's the right fix.
- **TypeScript**: no `any`, no suppressed errors
- **Error handling**: try/catch on all external boundaries (HTTP, Prisma, fs, JSON.parse, cron jobs). If user input is cleared optimistically before async operations, wrap in try/catch and restore the input on failure. When refactoring shared async calls out of individual try/catch blocks (e.g. hoisting a DB query above per-platform logic), the hoisted call **must** get its own try/catch — otherwise one failure kills the entire function.
- **Non-critical side effects** (cleanup, analytics, cache invalidation) must never abort the critical path — use `.catch(() => {})` or `Promise.allSettled`, not `Promise.all`.
- **Critical path ≠ non-critical side effect.** Code that touches money, auth, access control, quotas, usage tracking, or billing is the critical path, no matter how it "looks like" a side effect. Never swallow errors with `console.error` — use `Sentry.captureException` at minimum, and consider whether the operation should roll back instead. Before writing such code, do a threat model: race conditions, aborted requests, concurrent access, silent failures. Plans that describe billing/auth as "non-critical" are wrong — push back before implementing.
- **Accessibility**: semantic HTML, ARIA labels, keyboard navigable
- **External API integration**: before writing types or mapping logic, always inspect the real raw response first. API docs lie — fields appear/disappear, names differ, extra fields exist. Use a debug route or log the raw response before defining TypeScript interfaces.

## Testing

- **Unit tests**: Vitest (`npm test` / `npm run test:watch`), files in `src/**/*.test.ts`
- **E2E tests**: Playwright (`npx playwright test`), files in `tests/`
- IMPORTANT: Always check `package.json` and `src/**/*.test.ts` before concluding "no tests exist"
- When fixing a bug in a utility function, check if a test file exists for it and add a regression test
- **After implementing a feature**: write unit tests for all non-UI logic before committing — server actions, cron routes, utilities. Cron routes and anything calling external APIs always require tests: failures are silent and run without user present. Tests go in `__tests__/` next to the source file.
- **Clerk E2E auth requires three layers** — `setupClerkTestingToken()` alone does NOT authenticate (it only intercepts Clerk API requests for bot/captcha bypass). All three are needed: (1) `clerkSetup()` in `globalSetup`, (2) UI sign-in in setup project → `storageState`, (3) `setupClerkTestingToken({ page })` in every test's `beforeEach`. See `tests/global-setup.ts` and gotcha `playwright/clerk-testing.md`.

## Git Workflow

IMPORTANT: Never commit directly to `main`. Branch protection is enabled.

**Before writing any code**, check `git branch`. If on `main`:

1. Create a branch: `git checkout -b feat/<short-name>` (or `fix/`, `chore/`)
2. Name branches by task intent, e.g. `feat/husky-setup`, `fix/eslint-errors`

**Before creating a new branch**: run `git branch --no-merged main`. If unmerged branches exist — merge them first (or confirm they're abandoned), then branch from fresh `main`. Never start new work on top of unmerged changes.

**After task is done**: verify CI passes + Vercel preview deploy succeeds + feature works in preview URL — only then create PR via `gh pr create` and report PR URL to user.

**Before merging any PR**: run `gh pr view <n> --json statusCheckRollup` and verify **every** check is green (ci, e2e, Vercel — not a subset). One red check blocks merge even if others are green. "Ready to merge" requires ALL checks passing, not just the ones you remembered to look at. If a check is red but you believe it's a flake, rerun it and wait — never merge red.

**After PR merge**: `git checkout main && git pull --rebase` to sync local main before starting next task.

## Workflow Rules

IMPORTANT: Before executing any task, check `.claude/skills/` for a relevant skill and use it.
IMPORTANT: Before implementing — read relevant category in `.claude/skills/gotchas/` (react, nextjs, eslint, prisma, ai-sdk). After solving a problem — immediately write/update the gotcha entry.
IMPORTANT: If a task is multi-step and repeatable — create a skill for it using `/create-skill`.
IMPORTANT: After completing a task that touched 3+ files with the same pattern — suggest creating a skill (propose, don't auto-create).
IMPORTANT: Use Plan Mode (Shift+Tab) for any change touching 3+ files.
IMPORTANT: Start a fresh session (`/clear`) for each new task.
IMPORTANT: After implementing, verify with **both** `npx tsc --noEmit` AND `npm run lint` before committing. Running only tsc is not enough — ESLint catches a different class of errors (unused vars, setState in effects, component-in-render, etc.) that accumulate silently across PRs.
IMPORTANT: If your changes touch **behavior** (conversation flow, AI auto-start, auth, server actions used by e2e tests) — also run `npx playwright test` before pushing. Type-checking and lint cannot detect behavioral regressions like "AI now responds to a message it didn't before". Skipping this wastes 30+ min debugging CI failures on the PR.
IMPORTANT: Do not defer work. If something can be done in this session — do it now. No "we'll fix it later", no "follow-up PR for cleanup", no "ship and polish afterwards". Claude is fast and cheap; deferring creates drift, dead code, and TODOs that rot. The only valid reason to defer is a dependency that genuinely blocks (waiting on a user decision, a merge, a deploy). "I could fix this but I'll leave it for another PR" is not deferral — it's incomplete work.
