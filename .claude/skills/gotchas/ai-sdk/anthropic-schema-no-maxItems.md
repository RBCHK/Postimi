# Anthropic generateObject rejects array `minItems` / `maxItems`

## Problem

`generateObject({ model: anthropic(...), schema })` fails with:

```
output_format.schema: For 'array' type, property 'maxItems' is not supported
```

(or `'minItems'`) when the Zod schema uses `.min(N)` / `.max(N)` on an `z.array(...)`.

Anthropic's tool-use schema has a stricter JSON-Schema profile than vanilla AI SDK. `minItems` / `maxItems` keywords are not in their allowlist. String-level `.min()` / `.max()` (which emit `minLength` / `maxLength`) ARE supported — only **array** counts fail.

Other commonly unsupported keywords on Anthropic: `additionalProperties: false` on nested objects, `format`-string variants beyond `date-time`/`uri`/`email`. When in doubt, send the schema and read the error.

## Wrong

```ts
const SCHEMA = z.object({
  alternatives: z.array(z.string()).max(3), // ❌ maxItems
  themes: z.array(z.string()).min(0).max(6), // ❌ minItems + maxItems
});
```

## Correct

Drop the array-level `.min()` / `.max()`. Enforce limits in two layers instead:

1. **System prompt** — tell the model the cap explicitly:
   ```
   "alternatives": MUST contain at most 3 items.
   "themes": MUST contain at most 6 items.
   ```
2. **Post-fetch slice** — clamp on the server after the call returns:
   ```ts
   const alternatives = raw.alternatives.slice(0, 3);
   const themes = raw.drift.themes.slice(0, 6);
   ```

The two-layer approach is robust: prompt makes 99% of calls comply; slice catches the 1% the model overshoots.

## Where it bit us

`src/lib/server/niche-suggest.ts` (PR #108 originally landed with `.max(3)` + `.max(6)` on arrays — the API rejected the call, surfaced as a red error in the suggest modal). Fixed by removing the array-level constraints and reinforcing in the prompt.

`src/prompts/daily-insight.ts` already followed the pattern correctly (string-only `.min().max()` everywhere; arrays unconstrained at schema level).

## Quick sanity grep

Before opening a PR that adds a Zod schema for `generateObject` against Anthropic:

```sh
rg -n "z\.array\(.*\)\.(min|max)\(" src/
```

Any hit on a schema feeding `anthropic(...)` is a likely fail.
