# `new vi.fn().mockImplementation(() => ...)` is not a constructor

## Symptom

```
TypeError: () => ({ verify: verifyMock }) is not a constructor
   at new Webhook (src/app/api/webhooks/...)
```

When code does `new SomeClass(...)` and `SomeClass` is mocked with an
arrow function, V8 throws because arrow functions have no `[[Construct]]`
internal slot — you cannot `new` them.

## Failing pattern

```ts
vi.mock("svix", () => ({
  Webhook: vi.fn().mockImplementation(() => ({
    verify: verifyMock,
  })),
}));
```

Looks fine. But `new Webhook(secret)` throws `is not a constructor`
because the implementation is an arrow.

## Fix

Use a **regular function expression** (or a class):

```ts
const WebhookCtor = vi.hoisted(() =>
  vi.fn(function () {
    return { verify: verifyMock };
  })
);
```

A plain `function () {}` has `[[Construct]]` and works with `new`.

## Also: `mockReset` wipes constructor implementation

If you do `vi.clearAllMocks()` or `ctor.mockReset()` in `beforeEach`, the
mockImplementation is gone and `new Ctor()` returns undefined. Re-apply
after every reset:

```ts
beforeEach(() => {
  WebhookCtor.mockReset();
  WebhookCtor.mockImplementation(function () {
    return { verify: verifyMock };
  });
});
```
