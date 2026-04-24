# vitest — parallel test files share the real DB; scope mocks by userId

### Symptom

Tests pass individually (`vitest run path/to/test.test.ts`) but fail
when run together (`npm test`). Failing assertion is usually a count
mismatch: `expected 1 to be 2` or `expected +0 to be 1`.

### Cause

Vitest runs test files in parallel pools. When tests use a **real shared
Postgres DB** (our CLAUDE.md rule — no Prisma mocks on critical paths),
a cron's `prisma.user.findMany()` returns BOTH our test's users AND
users created by any concurrently-running test file. The cron then
iterates all of them, not just ours.

Mock counters tied to "first call" then fire for some other test's user:

```ts
// BROKEN — parallel-unsafe
let callNum = 0;
generateTextMock.mockImplementation(async () => {
  callNum += 1;
  if (callNum === 1) throw new Error("boom"); // fires for SOME user,
  // not necessarily ours
  return okResponse();
});
```

And "happy path" assertions break when another test's user triggers a
call without a queued mock:

```ts
// BROKEN — parallel-unsafe
generateTextMock.mockResolvedValueOnce(okResponse());
// other test's user consumes this; ours gets the default (undefined)
```

### Fix

**Rule 1:** Always provide a safe default with `mockResolvedValue` (not
`mockResolvedValueOnce`) in `beforeEach`. Other users' calls resolve
cleanly instead of exploding.

**Rule 2:** Key specific failures to **your** userId using
`mockImplementation`:

```ts
const user = await createTestUser({ clerkId: `${PREFIX}...` });
// Scope the failure to OUR user.
getLatestTrendsMock.mockImplementation(async (uid: string) => {
  if (uid === user.id) throw new Error("trends failed");
  return [];
});
```

For helpers that take an object:

```ts
reserveQuotaMock.mockImplementation(async ({ userId }: { userId: string }) => {
  if (userId === targetUser.id) throw new QuotaExceededError(100, 50);
  return { reservationId: "other" };
});
```

**Rule 3:** Assert on **scoped results**, not global counts:

```ts
// BROKEN
expect(saveMock).toHaveBeenCalledTimes(1); // other users also call it

// GOOD — filter the mock's call log to our user
const ours = saveMock.mock.calls.filter((c) => c[0] === user.id);
expect(ours).toHaveLength(1);

// For the cron's JSON response (which contains a `results` array),
// filter by userId:
const ours = results.filter((r) => r.userId === user.id);
expect(ours.find((r) => r.error)).toBeTruthy();
```

**Rule 4:** `afterEach` must clean up only **your** rows via a shared
prefix (`cleanupByPrefix(PREFIX, { clerkId: true })`). Don't
`deleteMany({})` — you'd kill concurrent tests' users mid-run.

### Alternative: serialize

If scoping is impractical, set `poolOptions.forks.singleFork` or use
`test.sequential` in `vitest.config.ts`. Slower CI, but each file runs
alone. Prefer scoping when possible — parallelism is free speed.
