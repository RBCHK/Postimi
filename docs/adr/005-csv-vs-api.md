# ADR-005: Data source — CSV vs X API

## Status

Phase 1 (CSV) — active; Phase 2 (API) — later

## Context

Need X account analytics data (impressions, engagements, follows, unfollows) for the growth strategy system.

## Decision

**Phase 1**: Manual CSV import from X Analytics dashboard.
**Phase 2**: X API automation (`GET /posts/analytics`).

## Why CSV first

CSV (Account Overview export) is **richer than API**:

- Gives `new_follows` AND `unfollows` per day
- API only gives current `followers_count` (net, no breakdown)
- No API cost during development

## API advantages (Phase 2)

- Automatic — no manual uploads
- Real-time data availability
- Gives: impressions, engagements, follows, profile_visits, clicks
- Cost: ~$0.30/month for daily follower polling (`/2/users/me` at $0.01/req)

## What API cannot replace

- Unfollows per day (CSV only)
- Historical new_follows breakdown (CSV only)
- For follower growth tracking: poll `/2/users/me` daily, store `FollowersSnapshot` in DB
