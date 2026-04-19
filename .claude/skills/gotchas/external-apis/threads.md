### Meta Threads returns HTTP 500 (not 403) on scope denial

**Tried:** In `src/lib/threads-api.ts`, classify scope/permission denials only on `res.status === 401 || 403`, throw generic `Error` otherwise.

**Broke:** Production Sentry issue 7422796902 — `Threads fetchUserInsights failed 500: {"error":{"message":"Application does not have permission for this action","type":"THApiException","code":10,"fbtrace_id":"..."}}`. Meta returned HTTP **500** with body `code:10`, so our code fell through the auth check, threw a generic `Error`, and the cron's `ThreadsScopeError` handler never fired — no reconnect banner, no grantedScopes strip, just a noisy Sentry every run.

**Fix:** Classify scope denials by **body**, not status. `code:10` ("Application does not have permission for this action") is Meta's canonical scope-denial signal regardless of HTTP status. Use a helper that parses JSON and checks `parsed.error.code === 10` or `message` contains "scope", then apply it to both the `401/403` branch and the `!res.ok` fallback. See `isScopeDenial()` in `src/lib/threads-api.ts`.

**Watch out:**

- The old `body.includes("10")` substring check was brittle — `fbtrace_id` often contains "10" as a coincidence. Parse JSON, check the numeric code.
- Apply this to **every** Threads endpoint that requires `threads_manage_insights`, not just per-post insights: account-level `fetchThreadsUserInsights` also needs it (was missed originally).
- Orphan `ThreadsApiToken` rows with empty `grantedScopes` used to trigger this on every cron run. Keep the webhook `user.deleted` handler intact so dead tokens get cascaded out.
