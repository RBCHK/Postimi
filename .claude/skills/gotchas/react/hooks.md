# React — Hooks

### setIndex derived from time — storing in state unnecessarily

**Tried:** `const [index, setIndex] = useState(...)` + `useEffect` that calls `setIndex(getHourIndex(...))` synchronously at the top before setting an interval
**Broke:** ESLint `react-hooks/set-state-in-effect` — "Calling setState synchronously within an effect"
**Fix:** Remove state entirely. Derive the value on each render: `const index = hasInsights ? getHourIndex(insights.length) : 0`. Use a ticker state (`const [, setTick] = useState(0)`) and `setInterval(() => setTick(n => n + 1), 60_000)` in the effect to trigger re-renders. The index is always computed fresh.
**Watch out:** Only works when the derived value is pure (no async, no external data). If computation is expensive — memoize with `useMemo`.

### Ref assignments at render time

**Tried:** Moving `notesRef.current = notes` and `contentTypeRef.current = contentType` into `useLayoutEffect` to silence `react-hooks/refs`
**Broke:** Caused a new ESLint error: "Calling setState synchronously within an effect" (useLayoutEffect calling setState counts too)
**Fix:** Render-time ref assignments (`ref.current = value` directly in the component body, outside any hook) are a legitimate React pattern for keeping refs in sync. The `react-hooks/refs` rule flags this as a false positive when the ref is used inside a `useState` factory closure. Use `/* eslint-disable react-hooks/refs */ ... /* eslint-enable */` block around the `useState(factory)` call, not around the ref assignments.
**Watch out:** `eslint-disable-next-line` doesn't work for multi-line expressions — must use block disable/enable.

### Optimistic update without try/catch + premature success toast

**Tried:** `clearNotes` — `setNotes([]); await clearNotesAction(...)` without try/catch. Also `addNote` in popup — `addNote(...); toast.success("Added")` before server confirms.
**Broke:** If server action throws, state is already cleared with no rollback. Toast shows success even on failure.
**Fix:** Every optimistic update must follow the pattern: (1) save previous state, (2) optimistically update, (3) try server call, (4) catch → rollback state. Toast must only fire after server confirms success. Return `boolean` from context method so callers know the outcome.
**Watch out:** Easy to miss when copying existing patterns — `removeNote` and `updateNote` had try/catch, but `clearNotes` (same file, same author) did not. Check all sibling methods when adding a new one.

### useConversation() in shared component crashes outside provider

**Tried:** Added `useConversation()` to `ChatInput` to show highlights badge
**Broke:** `ChatInput` is also used on the home page (`home-view.tsx`) which has no `ConversationProvider` — runtime crash: "useConversation must be used within ConversationProvider"
**Fix:** Don't call context hooks in shared components. Pass the data via props (`highlightsCount`). The drawer component (which does need context) only renders when count > 0, so it's never mounted outside the provider.
**Watch out:** Before adding a context hook to any component, grep for all its usage sites. If it's used outside the provider boundary, pass data via props instead.
