#!/usr/bin/env bash
# Security guard: no "use server" file may export an async function
# that takes `userId: string` as its first parameter.
#
# Why: in Next.js 15 App Router, every exported async function in a
# "use server" file is a callable Server Action. The browser can POST
# with an attacker-controlled userId and read/write another user's data.
# "Internal" naming is not enforcement — see
# .claude/skills/gotchas/nextjs/server-action-exports-are-public.md
#
# This script is invoked by:
#  - .husky/pre-commit (blocks git commit for all devs/CI)
#  - .claude/settings.json PreToolUse hook (blocks Claude's git commit)

set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

files=$(grep -rlE '^"use server"' src/app/actions/ 2>/dev/null || true)
[ -z "$files" ] && exit 0

violations=$(echo "$files" | xargs grep -nE 'export async function [a-zA-Z_]+\(\s*userId:\s*string' 2>/dev/null || true)
[ -z "$violations" ] && exit 0

cat >&2 <<EOF
❌ Security: Server Action exports a function with \`userId: string\` as first parameter.
   In Next.js 15 App Router, any exported async function in a "use server" file is a
   public Server Action — the browser can call it with an attacker-controlled userId.

   Violations:
$violations

   Fix: move the function to src/lib/server/*.ts (no "use server"), accept userId there.
   The public Server Action in src/app/actions/*.ts should call requireUserId() first,
   then pass the authenticated userId to the lib helper.

   See: .claude/skills/gotchas/nextjs/server-action-exports-are-public.md
EOF
exit 2
