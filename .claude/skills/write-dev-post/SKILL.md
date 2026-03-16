---
name: write-dev-post
description: >
  Write a shareable developer post based on the current session — problem, solution, lesson learned.
  Use when user says "напиши пост", "оформи опыт", "напиши отчет", "поделюсь с разработчиками",
  "write a post", "summarize what we did".
disable-model-invocation: true
---

Write a developer post from the user's perspective based on what we worked on in this session.
If $ARGUMENTS is provided — use it as additional context or focus.

## Format

Write in **English first**, then **Russian translation** below separated by a horizontal rule.

Structure:

**Opening line** — one sentence hook: what was being built and what went wrong (or what was the goal).

**The problem** — 2-4 sentences. What exactly failed or was missing? What made it hard to notice or diagnose?

**What I built** — numbered list of concrete things done. Each item: what it is + why it matters technically. Include code snippet if there's a key pattern worth showing.

**The deeper lesson** — the non-obvious insight from this session. Not "X was broken", but "this revealed that...". Should be generalizable.

**The meta-fix** _(optional)_ — only if something systemic was changed (workflow, tooling, CLAUDE.md rule). What was set up so this class of problem doesn't repeat.

## Tone

- Written from the user's perspective ("I", "my")
- Developer-to-developer: technical but not dry
- Concrete: real file names, real patterns, real code where helpful
- No fluff, no "In conclusion"

## Length

English version: 200-350 words. Tight. Every sentence earns its place.

## After writing

Save the post as a new file in `~/.claude/dev-posts/`:

- Filename: `YYYY-MM-DD-<slug>.md` where slug is 2-4 words from the topic, kebab-case
- File starts directly with `# Title` (no date header needed — it's in the filename)
- Use the Write tool — do NOT read any existing files first
- Do not ask for confirmation — just save silently after outputting the post.
