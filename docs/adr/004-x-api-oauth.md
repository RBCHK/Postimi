# ADR-004: X API — OAuth 2.0 PKCE per-user

## Status

Implemented

## Context

xREBA is a multi-user SaaS. Each user needs their own X (Twitter) API access for importing tweets and fetching analytics. A shared `.env` token caused a data isolation bug: cron routes wrote one X account's data to all users.

## Decision

Each user connects their X account via **OAuth 2.0 PKCE** (confidential client):

- OAuth initiation at `/api/auth/x` with PKCE code_verifier/challenge + state in httpOnly cookie
- Callback at `/api/auth/x/callback` exchanges code for tokens, fetches profile, saves to DB
- Tokens encrypted with AES-256-GCM (`v1:iv:authTag:ciphertext` format for future key rotation)
- Auto-refresh with optimistic locking (re-read `updatedAt` before refresh to prevent race conditions)
- Global endpoints (trends) use any connected user's token via `getAnyValidXApiToken()`
- No `.env` fallback — single code path

## Implementation

### DB Model

`XApiToken` linked to `User` (1:1 via `@unique userId`): encrypted access/refresh tokens, expiry, X profile info.

### Key Files

| File                                   | Purpose                                           |
| -------------------------------------- | ------------------------------------------------- |
| `src/lib/token-encryption.ts`          | AES-256-GCM encrypt/decrypt                       |
| `src/app/actions/x-token.ts`           | Token CRUD, auto-refresh, connection status       |
| `src/lib/x-api.ts`                     | OAuth 2.0 Bearer token fetch (OAuth 1.0a removed) |
| `src/app/api/auth/x/route.ts`          | OAuth initiation                                  |
| `src/app/api/auth/x/callback/route.ts` | OAuth callback                                    |
| Settings UI (ConnectionsTab)           | Connect/disconnect X account                      |

### Env Vars

- `X_CLIENT_ID`, `X_CLIENT_SECRET` — from X Developer Portal
- `TOKEN_ENCRYPTION_KEY` — 64-char hex (32 bytes), `openssl rand -hex 32`
- `NEXT_PUBLIC_APP_URL` — for OAuth redirect URI

## Cost at Scale

- 100 users x daily snapshot = ~$30-60/month (X API pay-per-use)
- Batch `/2/users` by 100 IDs per request for efficiency
- Server-level Redis cache becomes relevant at scale
