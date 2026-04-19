---
name: gotchas
description: Living log of mistakes made and solved in this project. Use BEFORE implementing — read the relevant category. Use AFTER solving a problem — write/update the gotcha immediately.
---

# Gotchas — Project Error Log

A living journal of real mistakes made in this codebase, how they were diagnosed, and how they were fixed.
Not abstract rules — concrete cases with context.

## When to READ

After understanding the task, before writing code:

1. Identify which categories apply (react, nextjs, eslint, prisma, ai-sdk)
2. Read only those subdirectories — not everything
3. If a gotcha matches your current task, apply the fix proactively

## When to WRITE

When user says "запиши в gotchas", "добавь gotcha", "зафиксируй это" — write immediately.

Immediately after verifying a fix works (tsc + lint clean):

1. Identify the category
2. Read existing `.md` files in that category — search for similar cases
3. If similar case exists → UPDATE it (add new variant, update solution if approach changed)
4. If no similar case → CREATE new entry in the right file
5. Never create duplicate entries for the same root cause

## Entry format

```
### [Short title]
**Tried:** what was written
**Broke:** exact error or symptom
**Fix:** what actually works and why
**Watch out:** edge cases or related traps (optional)
```

## Categories

- `react/` — component patterns, hooks, render behavior
- `nextjs/` — SSR, App Router, client/server boundary
- `eslint/` — lint rules, disable patterns, false positives
- `prisma/` — schema, queries, migrations
- `ai-sdk/` — useChat, transport, streaming
- `external-apis/` — third-party API quirks (Threads, LinkedIn, X)
