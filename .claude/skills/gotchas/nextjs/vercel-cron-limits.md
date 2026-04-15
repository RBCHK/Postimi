# Vercel cron limit: 10 per project

Vercel caps `vercel.json` → `crons` at **10 entries** per project (at least on the current plan tier used here). Exceeding it fails the deployment silently — the status page redirects to the generic "Usage & Pricing for Cron Jobs" docs with no useful build log.

## Symptom

- `Vercel` GitHub status = failure, timestamp nearly identical to creation (fails pre-build).
- `vercel.link/<id>` redirects to docs, not a build log.
- Main branch deploys fine; only the PR that added an 11th cron fails.

## Fix

Don't add an 11th entry. Options:

1. Inline the extra job into an existing cron route (call the function at the start of e.g. `daily-insight`).
2. Collapse multiple same-path entries (e.g. four `trend-snapshot` times → fewer runs).
3. Keep the route file for manual Bearer-gated invocation, just drop it from `vercel.json`.

Before adding a new cron: count `jq '.crons | length' vercel.json`. If ≥10, consolidate first.
