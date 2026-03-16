# ADR-002: DB is the source of truth for messages

## Status

Accepted

## Context

When a user creates a conversation (pastes a tweet URL, types a message), the content needs to reach the AI chat endpoint. Two approaches: pass via URL params / client state, or save to DB first.

## Decision

Save message to DB **before** sending to AI. No URL params for passing content.

Flow: save to DB → redirect to `/c/{id}` → ConversationProvider loads from DB → auto-starts AI.

## Why

- Page refresh preserves state (message is in DB, not lost URL param)
- ConversationProvider has a single data source (DB), not two (DB + URL)
- Server Actions can validate/transform before the AI sees it
- Multi-tab safety: opening same conversation in two tabs shows consistent data

## Consequences

- Creating a conversation is a two-step action: `createConversation()` → `router.push(/c/{id})`
- ConversationProvider auto-starts AI when it sees exactly 1 user message with no assistant reply
- No `initialMessage` prop — all data comes via `initialData.messages`
