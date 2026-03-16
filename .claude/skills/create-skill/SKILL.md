---
name: create-skill
description: >
  Create a new reusable skill (custom command) for a repeatable task.
  Use when user asks to automate a workflow, create a new slash command,
  or when you notice a multi-step task that will be repeated in the future.
disable-model-invocation: true
---

Create a new skill for the task described in "$ARGUMENTS".

1. **Analyze the task**:
   - What are the exact steps?
   - Which files does it touch?
   - What arguments does it need (if any)?
   - Should it be invoked manually only (`disable-model-invocation: true`) or also auto-triggered?

2. **Create the skill directory and file**:
   - Path: `.claude/skills/<skill-name>/SKILL.md`
   - Use kebab-case for the directory name
   - Write a clear `description` with trigger phrases so Claude auto-detects when to use it

3. **SKILL.md structure**:

```
---
name: skill-name
description: >
  One-line description. Use when [specific triggers / user phrases].
  Include keywords that match natural language requests.
disable-model-invocation: true   # only if it has side effects (DB changes, migrations, etc.)
---

Task description with $ARGUMENTS substitution.

Step-by-step instructions...
```

4. **Verify**:
   - Description has clear trigger phrases
   - Steps are specific enough to be unambiguous
   - If it runs commands, ensure they're in `.claude/settings.local.json` allow list
   - Report the created file path

After creation, suggest adding this skill to CLAUDE.md conventions if it covers a common workflow.
