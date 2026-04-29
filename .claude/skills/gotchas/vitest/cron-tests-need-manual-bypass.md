# Cron route tests fail locally when `CronJobConfig.enabled = false`

## Symptom

Real-prisma cron contract tests (e.g. `src/app/api/cron/followers-snapshot/__tests__/route.test.ts`, `daily-insight`, `trend-snapshot`, `strategist`) report failures locally with:

- `expected undefined to be 'SUCCESS'` — `body.status` is missing
- `Cannot read properties of undefined (reading 'find'/'filter')` — `body.results` is missing

…but **the same tests pass in CI**.

## Why

`withCronLogging` (`src/lib/cron-helpers.ts:48`) short-circuits when `CronJobConfig.enabled = false`:

```ts
if (!isManual && config && !config.enabled) {
  // ...log SKIPPED, return:
  return NextResponse.json({ ok: false, skipped: true, reason: "Job disabled" });
}
```

The response body has no `status` or per-user `results` fields — tests that read those crash.

**Why CI works**: CI uses a fresh `xreba_test` Postgres (`.github/workflows/ci.yml:29`). Without seeding `CronJobConfig`, the lookup returns `null` → wrapper falls through to "missing row = enabled" → handler runs.

**Why local fails**: developers hooked up to Supabase often have prod-mirrored data where `CronJobConfig.enabled = false` (cost-control during development).

## Fix

Add `?manual=1` to the test request URL — the wrapper bypasses the toggle for manual-triggered runs:

```ts
function authed() {
  return new NextRequest("https://app.postimi.com/api/cron/<name>?manual=1", {
    headers: { authorization: `Bearer ${CRON_SECRET}` },
  });
}
```

This is what `researcher` and `strategist` cron tests already do — pattern they should all follow.

## Don't fix it by

- Toggling `CronJobConfig` rows from a `beforeAll` — couples tests to shared DB state and breaks parallel test files.
- Mocking the cron-helpers wrapper — defeats the contract-test purpose.

## When you'll hit this

- Adding a new real-prisma test for a cron route, copying an existing pattern that lacks `?manual=1`.
- Investigating "why does this test fail locally but pass in CI" loops — that's the giveaway.
