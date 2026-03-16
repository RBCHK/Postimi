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

## Conventions

**Prisma enums are UPPER_CASE; app types are PascalCase** — use mapping records, never cast directly.

**Adding a new ContentType**: use `/add-content-type` skill.

**Page layout standard**: all new `*-view.tsx` files must use `<PageContainer>` from `@/components/page-container` as the root element. Add extra classes via `className` prop (e.g. `className="space-y-4"`).

**Server pages must be dynamic**: any `page.tsx` that calls Server Actions or Prisma at the top level must have `export const dynamic = "force-dynamic"`. Without it, Next.js tries to statically prerender at build time and fails without a real DB.

## Mobile / PWA Rules

IMPORTANT: PWA on iPhone — apply when touching layout or UI.

- **Safe areas**: `pt-[env(safe-area-inset-top)]` on `<header>`, `pb-[env(safe-area-inset-bottom)]` on bottom nav
- **Touch targets**: min 44×44px
- **Input zoom**: font ≥ 16px on inputs/textareas (iOS auto-zoom)
- **Hover**: `[@media(hover:hover)]:hover:` — never bare `hover:` (sticks on touch)
- **Test**: Safari → iPhone 15 Pro (Dynamic Island)

## Quality

- **TypeScript**: no `any`, no suppressed errors
- **Error handling**: try/catch on all external boundaries (HTTP, Prisma, fs, JSON.parse, cron jobs)
- **Accessibility**: semantic HTML, ARIA labels, keyboard navigable
- **External API integration**: before writing types or mapping logic, always inspect the real raw response first. API docs lie — fields appear/disappear, names differ, extra fields exist. Use a debug route or log the raw response before defining TypeScript interfaces.

## Testing

- **Framework**: Vitest (`npm test` / `npm run test:watch`)
- **Test files location**: `src/**/*.test.ts` — currently `src/lib/__tests__/` and `src/app/actions/__tests__/`
- IMPORTANT: Always check `package.json` and `src/**/*.test.ts` before concluding "no tests exist"
- When fixing a bug in a utility function, check if a test file exists for it and add a regression test

## Git Workflow

IMPORTANT: Never commit directly to `main`. Branch protection is enabled.

**Before writing any code**, check `git branch`. If on `main`:

1. Create a branch: `git checkout -b feat/<short-name>` (or `fix/`, `chore/`)
2. Name branches by task intent, e.g. `feat/husky-setup`, `fix/eslint-errors`

**After task is done**: commit, push, create PR via `gh pr create`, report PR URL to user.

**After PR merge**: `git checkout main && git pull --rebase` to sync local main before starting next task.

## Workflow Rules

IMPORTANT: Before executing any task, check `.claude/skills/` for a relevant skill and use it.
IMPORTANT: If a task is multi-step and repeatable — create a skill for it using `/create-skill`.
IMPORTANT: After completing a task that touched 3+ files with the same pattern — suggest creating a skill (propose, don't auto-create).
IMPORTANT: Use Plan Mode (Shift+Tab) for any change touching 3+ files.
IMPORTANT: Start a fresh session (`/clear`) for each new task.
IMPORTANT: After implementing, verify with `npx tsc --noEmit` (also runs automatically via hook after every file edit).
