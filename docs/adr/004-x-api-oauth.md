# ADR-004: X API — OAuth flow for multi-user

## Status

Planned (not yet implemented)

## Context

xREBA is a multi-user SaaS. Each user needs their own X (Twitter) API access for importing tweets, posting, and fetching analytics.

## Current state (development)

Static OAuth 1.0a tokens in `.env` (API Key + Secret + Access Token + Access Token Secret). Works for single-developer testing.

## Production plan

Each user connects their X account via **OAuth 2.0 PKCE**:

- Callback route handles the OAuth dance
- Tokens stored in DB: `XApiToken { access_token, refresh_token, expires_at }`
- Auto-refresh logic for expired tokens
- Estimated effort: ~3-4 days

## Refactoring scope

Only `src/lib/x-api.ts` changes (token source: `.env` → DB per user). All fetching, mapping, and saving logic stays the same.

## Cost at scale

- 100 users x daily snapshot = ~$30-60/month (X API pay-per-use)
- Batch `/2/users` by 100 IDs per request for efficiency
- Server-level Redis cache becomes relevant at scale
