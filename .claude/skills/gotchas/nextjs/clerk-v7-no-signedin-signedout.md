# Clerk Next.js v7: no SignedIn/SignedOut export

## The trap

```ts
import { SignedIn, SignedOut } from "@clerk/nextjs"; // ❌ TS2305
```

Older Clerk versions (and most third-party tutorials/handoffs) export
`<SignedIn>` / `<SignedOut>` server components from `@clerk/nextjs`.
**Clerk v7 removed them.** TS error: `'@clerk/nextjs' has no exported member named 'SignedIn'`.

## What v7 ships instead

- **Server components** → `<Show when="signed-in">` / `<Show when="signed-out">` (also accepts `{ role }`, `{ permission }`, `{ feature }`, `{ plan }`, or a predicate)
- **Client components** → `const { isLoaded, isSignedIn } = useAuth()` and conditional render

## Migration

Server (no `"use client"`):

```tsx
import { Show } from "@clerk/nextjs";

<Show when="signed-in">
  <a href={APP_URL}>Open app</a>
</Show>
<Show when="signed-out">
  <Link href="#waitlist">Join waitlist</Link>
</Show>
```

Client (`"use client"`):

```tsx
import { useAuth } from "@clerk/nextjs";

const { isLoaded, isSignedIn } = useAuth();

// Render signed-out branch pre-hydration to avoid layout shift,
// then swap once Clerk has resolved auth state.
{
  isLoaded && isSignedIn ? <OpenAppButton /> : <JoinWaitlistButton />;
}
```

## Why pre-hydration default matters

`useAuth()` returns `isLoaded: false` on first client render. Picking a
visible default (the signed-out branch) keeps the rendered HTML stable
between SSR and the first client paint — otherwise the CTA flashes /
shifts when Clerk hydrates.

## Source of truth

`node_modules/@clerk/nextjs/dist/types/index.d.ts` — only these are
exported: `SignIn`, `SignUp`, `UserButton`, `Show`, `useAuth`, etc.
No `SignedIn` / `SignedOut`.
