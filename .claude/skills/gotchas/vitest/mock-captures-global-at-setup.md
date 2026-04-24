# Mock factories capture `global.fetch` at setup, not at call time

**Symptom:** You have a test that mocks `@/lib/fetch-with-timeout` (or any wrapper over `fetch`) with a factory that reads `global.fetch`, and also does `vi.stubGlobal("fetch", mockFetch)` later in the file. Your `mockFetch` is never called — real network calls hit the actual API (including a real 401/403 from the upstream).

**Why:**

```ts
vi.mock("@/lib/fetch-with-timeout", async () => {
  const realFetch = global.fetch; // ← captured NOW, at mock-registration time
  return {
    fetchWithTimeout: (input, init) => realFetch(input, init), // ← stale closure
  };
});

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch); // ← too late; factory already captured the native fetch
```

Vitest hoists `vi.mock(...)` to the top of the file and runs the factory before the rest of the module body (including `vi.stubGlobal`). So `realFetch` closes over the native `fetch`, and every call goes to the network.

This used to look fine because the real network call would abort quickly under a 50ms timeout shim and return an `AbortError` — coincidentally matching the test's regex. Once a retry layer sits in front (e.g. `fetchWithRetry`), the retry gives the real fetch time to succeed with a real 4xx, and the test fails on an unrelated error name (e.g. `XApiAuthError` from a real 403 "Unsupported Authentication" response).

**Fix:** Read the global at invocation time, not at factory time:

```ts
vi.mock("@/lib/fetch-with-timeout", () => ({
  fetchWithTimeout: (input, init) =>
    (globalThis.fetch as typeof fetch)(input, init), // ← resolved when called
}));
```

By the time the shim actually runs, `vi.stubGlobal("fetch", mockFetch)` has installed the stub on `globalThis.fetch`, so `mockFetch` is what gets called.

**Rule of thumb:** anything that references a global from inside a `vi.mock` factory should read it lazily (at call time) unless you *want* the native version.
