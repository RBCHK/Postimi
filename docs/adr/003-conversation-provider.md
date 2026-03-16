# ADR-003: ConversationProvider owns all AI state

## Status

Accepted

## Context

Conversation page has: chat messages, notes panel, content type selector, AI streaming. Multiple components need to read/write this shared state.

## Decision

Single `ConversationProvider` context wraps the conversation page. It owns:

- AI chat (via `useChat` from `@ai-sdk/react`)
- Message persistence (save to DB on send/receive)
- Notes CRUD
- Content type state
- Auto-start logic (1 user message → trigger AI)

Components use `useConversation()` hook — never call `useChat` or DB actions directly.

## Why

- One place manages the send → save → stream → save cycle
- No race conditions between components trying to save simultaneously
- Transport body closure always reads latest notes/contentType via refs
- Auto-start logic is centralized and guarded by `hasSentInitial` ref

## Consequences

- All AI-related state changes go through ConversationProvider
- New features (voice, attachments) plug into the same provider
- See JSDoc in `conversation-context.tsx` for the full contract
