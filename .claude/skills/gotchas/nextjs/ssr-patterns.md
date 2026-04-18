# Next.js — SSR / Client Boundary Patterns

### setState for browser-only APIs (localStorage, matchMedia)

**Tried:** Initializing state with lazy `useState(() => window.matchMedia(...).matches)` or `localStorage.getItem(...)` to avoid setState in effect
**Broke:** `window`/`localStorage` are unavailable during SSR — server throws or returns wrong initial value. Lazy initializer runs on the server too.
**Fix:** Initialize state with a safe default (`false`, `null`, `DEFAULT_VALUE`), then read the browser API inside `useEffect`. This is the correct Next.js SSR pattern. Silence the ESLint `react-hooks/set-state-in-effect` rule with:

```ts
// eslint-disable-next-line react-hooks/set-state-in-effect -- browser API access requires effect for SSR safety
setState(window.matchMedia(...).matches);
```

**Watch out:** Do NOT try to "fix" this by moving to a lazy initializer — it breaks SSR. The eslint-disable is the correct solution here, not a workaround.

### setIsLoading(true) before async fetch in useEffect

**Tried:** Removing `setIsLoading(true)` or wrapping in a timeout to avoid ESLint `react-hooks/set-state-in-effect`
**Broke:** UI shows stale data without loading indicator
**Fix:** Keep the pattern. Silence with:

```ts
// eslint-disable-next-line react-hooks/set-state-in-effect -- intentional: sets loading state before async fetch
setIsLoading(true);
```

**Watch out:** This is a legitimate loading state pattern. The ESLint rule is overly strict here.

### `"use server"` file exports only async functions (Next 16)

**Tried:** `export const SCOPES = [...] as const` at top-level of a `"use server"` server-action file (next to the async actions).
**Broke:** Local `npx tsc --noEmit` passed. `npm run build` failed with `A "use server" file can only export async functions, found object` during "Collecting page data". The error pointed at an unrelated route handler that transitively imported the module.
**Fix:** Remove the `export` — keep it as a module-private const. If callers outside the module need it, move the constant to a non-server-action file (e.g. `src/lib/…`) and import it from there. `export type` / `export interface` are fine — types erase at build time and don't emit runtime values.
**Watch out:** Only the production build catches this; `tsc` and unit tests don't. Lint in this repo doesn't catch it either. Check build output before pushing any PR that adds `export const`/`export let` to a `"use server"` module.

### router.refresh() causes initialData object reference to change

**Tried:** Storing content type in component state, updating it via dropdown, calling `router.refresh()` after note operations
**Broke:** `router.refresh()` causes the server to re-render and pass a new `initialData` object to the provider. `useEffect([conversationId, initialData])` fires and resets `contentType` to the DB value, discarding the user's dropdown change.
**Fix:** For data that shouldn't reset on refresh — either remove it from the `useEffect` deps, or make it immutable (set once from `initialData`, never changed by user). In this project: `contentType` is now immutable within a conversation — no dropdown in active chat.
