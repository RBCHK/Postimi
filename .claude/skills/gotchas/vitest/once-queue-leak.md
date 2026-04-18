# vitest — `mockResolvedValueOnce` queue leaks across tests

### `vi.clearAllMocks()` is not enough when you use `Once` variants

**Tried:** per-test `beforeEach(() => vi.clearAllMocks())` + each test
queues up its mocks with `mockResolvedValueOnce`:

```ts
beforeEach(() => vi.clearAllMocks());

it("a", () => {
  prismaMock.socialPost.groupBy
    .mockResolvedValueOnce([])       // call 1
    .mockResolvedValueOnce([]);      // call 2 — never consumed
});

it("b", () => {
  prismaMock.socialPost.groupBy
    .mockResolvedValueOnce([{ platform: "LINKEDIN", ... }]);
  // expects this value on first call — but gets the leftover [] from test "a"!
});
```

**Broke:** test "b" asserts `platforms: ["LINKEDIN"]` but gets `[]`.

**Fix:** use `vi.resetAllMocks()` — it drains the `Once` queue and
restores all mocks to their initial state:

```ts
beforeEach(() => {
  vi.resetAllMocks();
  (requireUserId as ReturnType<typeof vi.fn>).mockResolvedValue(USER_ID);
});
```

**Why:** `clearAllMocks` only resets `.mock.calls` and `.mock.results`.
The internal queue of pending `Once` implementations is NOT cleared. So
any `mockResolvedValueOnce` that wasn't consumed in one test will pop
off first in the next.

**Rule of thumb:** if any test uses `mockResolvedValueOnce`, use
`resetAllMocks` in `beforeEach`. If every test uses `mockResolvedValue`
(the permanent variant), `clearAllMocks` is fine.
