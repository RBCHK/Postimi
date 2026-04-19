# `"use server"` files can only export async functions

## Symptom

Next.js build fails (dev often succeeds):

```
Only async functions are allowed to be exported in a "use server" file.
...
Export <SymbolName> doesn't exist in target module
The module has no exports at all.
```

The second message is misleading — the module **does** export things, but Next.js strips all non-async exports before emitting the client proxy, so from the client-side perspective the exports vanish.

## Cause

Next.js uses `"use server"` to generate a thin client proxy that forwards calls to the server over the RSC boundary. The proxy can only forward **async function calls** — so the compiler deletes every other export (classes, non-async functions, const values, enums) when building the client bundle. The type-level imports pass tsc because erased interfaces/type-only imports survive, but any runtime value (class, const) breaks the build.

## Fix

Move non-function exports (classes, interfaces used at runtime via `instanceof`, const lookup tables, enums) into a sibling plain module and re-import them in the `"use server"` file:

```ts
// linkedin-xlsx-types.ts  (no "use server")
export interface MyResult { ... }
export class MyUserError extends Error { ... }

// linkedin-xlsx.ts
"use server";
import { MyUserError, type MyResult } from "./linkedin-xlsx-types";
export async function importLinkedIn(fd: FormData): Promise<MyResult> { ... }
```

Clients that need `instanceof MyUserError` import from `linkedin-xlsx-types` directly; they get the class, not the server-action proxy.

## Why tsc doesn't catch it

`tsc --noEmit` only checks types. The "async-only export" rule is enforced by the Next.js bundler (Turbopack/Webpack loader), which runs during `next build`. Dev mode sometimes skips the check for changed files and only surfaces the error on a full build, so CI is usually the first place you see it. Always run `next build` (or rely on Vercel preview) before assuming a server-action refactor is clean.
