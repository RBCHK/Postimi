### Admin "Run now" to Bearer-gated cron route returns 401

**Tried:** In `src/app/app/admin/admin-view.tsx`, `handleRun(jobName)` did `await fetch(cronPath)` directly from the client. Path resolved from a hardcoded map (`/api/cron/x-import`, etc.).

**Broke:** Every job triggered manually by admin returned `failed: Unauthorized`. Nobody noticed until prod — the buttons sat unused for the whole Phase 1a dual-write window. `withCronLogging` in `src/lib/cron-helpers.ts` checks `authHeader !== Bearer ${CRON_SECRET}` as the very first thing; the browser fetch sent no header, so the route 401'd before any handler logic ran. The UI only saw `data.ok=false` and surfaced `Unauthorized`.

**Fix:** Wrap the trigger in a Server Action (`runCronJob` in `src/app/actions/admin.ts`):

1. Admin gate via `adminAction()` wrapper (structural guarantee, can't forget).
2. Server-side whitelist `ALLOWED_CRON_PATHS` — client passes `jobName`, never a URL. Guards against path traversal / coercing the server into attaching `CRON_SECRET` to an arbitrary origin.
3. Resolve absolute URL via `new URL(path, process.env.NEXT_PUBLIC_APP_URL)` — Vercel fetch needs absolute URLs, and it makes the path-traversal guard cleaner than string concat.
4. Attach `Authorization: Bearer ${process.env.CRON_SECRET}` server-side — secret never crosses the network boundary to the browser.

**Watch out:**

- Never push the secret to the client. Even `NEXT_PUBLIC_CRON_SECRET` or a `useEffect` fetch is wrong — the production CRON_SECRET is what Vercel itself uses; leaking it lets any visitor trigger all crons.
- Keep the Server Action whitelist (`ALLOWED_CRON_PATHS`) in sync with the UI map (`CRON_PATHS` in `admin-view.tsx`). Two maps because they serve different purposes: UI map = rendering, server map = security boundary. Don't DRY them into one module — the UI map is safe to leak, the server map must stay server-only.
- `withCronLogging` also returns `HTTP 200 ok:false` on handler failure (distinct from `HTTP 401 Unauthorized`). The Server Action must surface both — check `res.ok` AND `data.ok !== false`.
- If `CRON_SECRET` or `NEXT_PUBLIC_APP_URL` env var is missing, fail loud with a specific error message. A silent 500 from `new URL(undefined)` or `Bearer undefined` wastes debug time.

### Admin "Run now" on a disabled cron shows misleading "unknown error"

**Tried:** After fixing the 401 above, `runCronJob` proxied the fetch correctly but shared the same `withCronLogging` enabled-check path as scheduled Vercel runs. When the admin toggled a cron off and hit ▷ Run now, the route returned `HTTP 200 { ok: false, skipped: true, reason: "Job disabled" }`. `runCronJob` didn't read `reason` and returned `{ ok: false, error: undefined }`, so `toast.error` fell through to "unknown error".

**Broke:** Admin intent (explicit button click) got treated identically to a scheduled invocation. The toggle is meant to pause the Vercel schedule, not block deliberate manual runs — but the handler couldn't tell them apart, so both paths hit the same skip. Two visible symptoms: (a) misleading toast on a valid button click; (b) admin had to re-enable the toggle, run, disable again — bad UX for things like triggering a backfill while the schedule is paused.

**Fix:**

1. `runCronJob` appends `?manual=1` to the URL.
2. `withCronLogging` reads the query param: `if (!isManual && config && !config.enabled)` — manual runs skip the enabled check entirely.
3. Bearer auth above the enabled check still gates everything — the flag is not a security bypass, just intent signalling.
4. Defense-in-depth on the client side: `runCronJob` also plumbs `data.reason` through and returns `{ ok: false, skipped: true, reason }`. The admin view uses `toast.info(…skipped: ${reason})` instead of `toast.error`, so any future skip path (not just "Job disabled") surfaces a specific message.

**Watch out:**

- Don't confuse the toggle's purpose. It pauses Vercel's scheduler; it is not a kill switch for the handler. If you want to _fully_ disable a job (including admin runs), remove it from the whitelist in `runCronJob` — that's the security boundary. The toggle is operational.
- Vercel cron paths in `vercel.json` can carry their own query strings (e.g. `/api/cron/x-import?mode=refresh`). That's independent of `manual=1` — don't collide them. Check the existing URLs before adding a new flag.
- `toast.info` exists in sonner but is easy to miss among `.success/.error/.warning`. A skipped result isn't a failure — matching the color (blue vs red) to the outcome is the whole point of distinguishing them.
