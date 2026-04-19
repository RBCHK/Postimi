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

## Variant: `export type { X }` re-exports also break build

```
Export ConnectedPlatforms doesn't exist in target module
The export ConnectedPlatforms was not found in module [project]/src/app/actions/platforms.ts [app-rsc] (ecmascript).
Did you mean to import getConnectedPlatforms?
All exports of the module are statically known (It doesn't have dynamic exports).
So it's known statically that the requested export doesn't exist.
```

**Trigger**: a `"use server"` file re-exports a type via `export type { X }` (a type-only re-export), and some page/component imports `X` from that action file. Turbopack generates the actions manifest (`.next-internal/server/app/**/actions.js`) with a real re-export statement for every exported symbol — including the type — but since `X` was erased at transpile time there's no runtime symbol to re-export.

**Fix**: never `export type { X }` from a `"use server"` file. Types must live next to the implementation (`src/lib/server/*` or a plain types module). Consumers import types from the source module, not from the action wrapper.

```ts
// ❌ BAD — breaks `next build`
// src/app/actions/platforms.ts
"use server";
import { getConnectedPlatforms as _g, type ConnectedPlatforms } from "@/lib/server/platforms";
export type { ConnectedPlatforms };  // ← fails at build
export async function getConnectedPlatforms(): Promise<ConnectedPlatforms> { ... }

// ✅ GOOD
// src/app/actions/platforms.ts
"use server";
import { getConnectedPlatforms as _g, type ConnectedPlatforms } from "@/lib/server/platforms";
// Types are NOT re-exported — consumers import from @/lib/server/platforms.
export async function getConnectedPlatforms(): Promise<ConnectedPlatforms> { ... }

// src/components/foo.tsx
import { getConnectedPlatforms } from "@/app/actions/platforms";
import type { ConnectedPlatforms } from "@/lib/server/platforms";
```

Inline type aliases and interfaces (`export type X = ...`, `export interface X { ... }`) inside `"use server"` files **are** safe — they're fully erased by tsc and never appear in the transpiled output. Only `export type { X }` re-exports break the build.

**Grep guard**: `rg -n '^export type \{' src/app/actions/` — any hit is a latent build failure.
