# vitest — mock hoisting

### Top-level `const` referenced inside `vi.mock` factory

**Tried:**

```ts
const prismaMock = { user: { findMany: vi.fn() } };
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
```

**Broke:**

```
ReferenceError: Cannot access 'prismaMock' before initialization
```

**Fix:** wrap the mock object in `vi.hoisted()` so Vitest reorders
**both** the declaration and the `vi.mock` call to the top of the module:

```ts
const prismaMock = vi.hoisted(() => ({
  user: { findMany: vi.fn() },
}));
vi.mock("@/lib/prisma", () => ({ prisma: prismaMock }));
```

**Why:** Vitest lifts `vi.mock` calls above every `import` statement —
but it does NOT lift plain `const` declarations. By the time the mock
factory runs, the TDZ for `prismaMock` is still live. `vi.hoisted`
marks the entire expression as safe to hoist alongside `vi.mock`.

**Watch out:** the same trap applies to spies and test fixtures — any
value captured by a `vi.mock` factory must either be imported (modules
are hoisted) or wrapped in `vi.hoisted()`.
