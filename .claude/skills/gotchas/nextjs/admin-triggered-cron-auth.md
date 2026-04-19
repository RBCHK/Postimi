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
