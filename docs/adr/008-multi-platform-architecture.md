# ADR-008: Multi-platform Strategist & analytics architecture

## Status

Accepted — Phase 0 in progress (2026-04-17)

## Context

Postimi connects to three social networks (X, LinkedIn, Threads) and supports publishing to all three, but the growth pipeline — analytics models, cron importers, Analytics UI, and the Strategist AI agent — is **X-only**. The Strategist prompt hardcodes "X growth strategist", Russian output, 2026, and benchmarks. Adding a fourth platform (or even lighting up the two already connected) would require rewriting the prompt and duplicating schema/cron/UI/agent code.

This ADR freezes the architectural decisions that unblock the refactor documented in `/Users/rbchk/.claude/plans/strategist-polished-feather.md`.

## Decision

### Platform-agnostic data models

Replace the X-specific models (`XPost`, `DailyAccountStats`, `FollowersSnapshot`, `PostEngagementSnapshot`) with platform-scoped models:

```
SocialPost(userId, platform, externalPostId, platformMetadata Json, ...)
SocialDailyStats(userId, platform, date, ...)
SocialFollowersSnapshot(userId, platform, date, ...)
SocialPostEngagementSnapshot(userId, platform, postId → SocialPost, ...)
```

All have `@@unique([userId, platform, ...])` constraints and composite indexes `(userId, platform, date)`. `TrendSnapshot` stays X-only (LinkedIn/Threads do not expose personalized trends) with a schema comment declaring the scope.

Cutover is split into two migrations (Phase 1a + Phase 1b, one week apart) so rollback is cheap: Phase 1a adds new tables + dual-writes, Phase 1b drops the old tables after a week of silent parallel operation.

### Platform interface registry

One `PlatformTokenClient` interface (token fetch/refresh/save) and one `PlatformImporter` interface (fetch posts / fetch followers) live in `src/lib/platform/types.ts`. The three existing token modules (`x-token.ts`, `linkedin-token.ts`, `threads-token.ts`) are currently ~90% duplicated; they get refactored to implement the interface and register themselves in `PLATFORM_CLIENTS`. Adding a fourth platform becomes a registry addition, not a core rewrite.

`SocialPost.platformMetadata` is typed by a Zod discriminated union on `platform` — the runtime validator rejects X metadata on a LINKEDIN row, eliminating `as any` casts.

### LinkedIn: CSV-only

LinkedIn's Marketing Developer Platform was sunset April 2024 and replaced with Community Management APIs. The `r_member_social` scope needed for post-level analytics is **closed to new applications** (LinkedIn API FAQ, Aug 2025). Without it, a connected LinkedIn account can publish but cannot expose post stats, follower counts, or aggregate statistics.

**Decision:** LinkedIn analytics come from user-uploaded CSV exports (LinkedIn Creator Analytics → CSV) — the same mechanism Postimi already uses for X pre-API, hardened with the security controls below.

### Threads: full API integration

Threads exposes `threads_manage_insights` (a normal grantable scope) with per-post metrics (views, likes, replies, reposts, quotes, shares) and account-level metrics (views, followers_count, demographics). Rate limit ~200 calls/hour per user — handled by a single cron with backoff. `ThreadsApiToken.grantedScopes` is stored as an array so silent scope downgrades on refresh are detectable.

### Benchmarks live in the database, not the prompt

A `PlatformBenchmark` global table (`platform × audienceSize × metric` with `strongThreshold`, `avgThreshold`, `weakThreshold`, `source`, `sourceUrl`) replaces the hardcoded ">2.5% engagement / 1–2.5% / <1%" numbers in the Strategist prompt. Writes are admin-only (`requireAdmin()`); reads are per-user. `sourceUrl` preserves provenance so the agent can cite benchmarks.

### Output language is a Prisma enum on User

`User.outputLanguage Language?` with enum values `EN | RU | UK | ES | DE | FR` (extensible). Populated on sign-up from Clerk locale via a **whitelist mapper** (never raw locale → DB). Synced to localStorage as a cache; DB wins on conflict. Enum (not String) is a prompt-injection defense — `"EN\nIgnore previous"` fails Prisma validation.

### Single Strategist, parameterized by (platform, language)

`getStrategistPrompt(platform: Platform, language: Language)` produces the prompt. Benchmarks, year, and language name are computed, not hardcoded. The `strategist` cron iterates over each user's connected platforms **sequentially** (not `Promise.all` — Serializable contention on quota reservations), with per-platform `try/catch` + `Sentry.captureException({ tags: { platform, userId } })`. Partial failure (platform 1 succeeds, platform 2 fails) saves what worked and emits a Sentry event for what didn't — it never silently swallows or aborts siblings.

### Quota: per-platform reservation with explicit cap

Each Strategist run reserves quota per-platform. A user with all three platforms gets 3 weekly reservations. Real Sonnet cost per run is $0.01–0.05, so `3 platforms × 4 weeks × $0.05 = $0.60/month` — comfortably within the $10 Pro tier. Documented here so future plan-tier changes do not silently break the budget assumption.

### CSV security (LinkedIn importer)

The existing X CSV flow is permissive. The new LinkedIn importer adds: server-side parsing (Server Action, not client), 5 MB size cap, 50k row cap, MIME magic-byte validation, UTF-8 + UTF-16 BOM support (LinkedIn exports as UTF-16), formula-injection stripping (`= + - @ \t \r` prefixes), `linkedin.com/*` URL whitelisting, fail-loud on unknown columns. Primitives (`stripFormulaInjection`, `parseCsvLine`, `parseNumber`) move into `src/lib/csv/primitives.ts` and the X parser adopts them — no duplication.

## Consequences

**Positive**

- Adding a 4th platform (TikTok, Bluesky) becomes a registry entry + importer + benchmark seed, not a core rewrite.
- The Strategist prompt is reviewable per `(platform, language)` pair via snapshot tests.
- Benchmarks can evolve without shipping code — an admin UI can update `PlatformBenchmark` rows.
- CSV injection, SSRF via post links, and oversized-upload DoS are closed off at the boundary.
- Prompt-injection via user language setting is structurally impossible (type-enforced enum).

**Negative**

- Two-phase migration (1a + 1b) takes a week of dual-writes before old tables can be dropped. This is the point — cheap rollback — but the window must be respected.
- LinkedIn remains manual upload until LinkedIn re-opens `r_member_social`. Users must understand why. The Analytics UI surfaces this explicitly.
- Per-platform quota reservation means a user with 3 platforms can exhaust their weekly budget 3× faster. The $10/month cap still holds; billing doesn't.
- Sequential cron iteration (required for quota serializability) means a slow Anthropic response on one platform delays the next. Acceptable at current scale; revisit if users exceed ~100 and weekly cron drifts past its window.

## What this ADR intentionally does NOT decide

- **TikTok / Bluesky / Mastodon** — out of scope. Design must _support_ a 4th platform cheaply, but we don't build one speculatively.
- **Teams or multi-user org accounts** — Postimi is single-user per Clerk account; `where: { userId }` everywhere is the isolation boundary. Team accounts would need a new model (`Organization`) which is deferred.
- **Soft quota / overage billing** — per ADR-007, hard cap only. Multi-platform does not change this.
- **Automated benchmark scraping** — `PlatformBenchmark` is admin-curated. Automated ingestion from public reports can come later.

## Related work

- ADR-005 (CSV vs X API) — extended: LinkedIn is now CSV-by-necessity, not CSV-first.
- ADR-007 (open-registration path) — the quota / `withAiQuota` contract is reused as-is.
- Plan file: `/Users/rbchk/.claude/plans/strategist-polished-feather.md` (7 phases).
