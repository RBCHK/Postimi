---
name: update-claude-md
description: >
  Update CLAUDE.md and optionally CLAUDE.template.md with a new rule derived from
  the current conversation. Auto-trigger (without user asking) after fixing a mistake,
  answering a correction, or identifying a pattern that should not repeat.
  Also trigger when user says "добавь в шаблон", "запомни это правило",
  "add to template", "не делай так больше".
---

Derive the rule from the current conversation context (the mistake we just discussed and fixed).
If $ARGUMENTS is provided — use it as the rule description instead.

## Filter — before doing anything, ask yourself:

Add to CLAUDE.md ONLY if ALL of these are true:

- I made the **same type of mistake** that could easily happen again in a different context
- The rule is **actionable** ("always do X" / "never do Y") — not just an explanation of what happened
- It's **not already obvious** from the code, framework docs, or existing CLAUDE.md rules
- It would have **prevented the mistake** if it existed before

Do NOT add if:

- It was a one-off bug or typo
- The fix is visible in the code itself
- It's a domain/business logic decision, not a coding pattern

## Step 1 — Always: update project CLAUDE.md

1. Read the current project's `CLAUDE.md`
2. Determine which section the rule belongs to
3. Check for duplicates — update existing rule if similar one exists
4. Edit `CLAUDE.md` with the new rule

## Step 2 — If universal: also update ~/.claude/CLAUDE.template.md

Ask yourself: "Could this mistake happen in any project, regardless of stack?"

- Yes → also update `~/.claude/CLAUDE.template.md` with the same steps (read → place → dedup → edit)
- No (project-specific: Prisma, Next.js, PWA, etc.) → skip

## What counts as universal

Universal (goes to template):

- Error handling patterns
- Code quality / TypeScript discipline
- Testing habits
- Workflow process rules

Project-specific (CLAUDE.md only):

- Framework-specific conventions (Next.js, Prisma, etc.)
- Mobile/PWA rules
- Project architecture decisions
- Stack-specific patterns
