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

## Workflow Rules

IMPORTANT: Use Plan Mode (Shift+Tab) for any change touching 3+ files.
IMPORTANT: Start a fresh session (`/clear`) for each new task.
IMPORTANT: After implementing, verify with `npx tsc --noEmit` (also runs automatically via hook after every file edit).
