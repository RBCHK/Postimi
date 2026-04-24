#!/usr/bin/env bash
# Security guard: no "use server" file may export an async function
# that accepts a caller-provided userId as its first parameter.
#
# Why: in Next.js 15 App Router, every exported async function in a
# "use server" file is a callable Server Action. The browser can POST
# with an attacker-controlled userId and read/write another user's data.
# "Internal" naming is not enforcement — see
# .claude/skills/gotchas/nextjs/server-action-exports-are-public.md
#
# Variants caught:
#   1. export async function foo(userId: string, …)
#   2. export async function foo({ userId }: { userId: string }, …)
#   3. export async function foo(opts: { userId: string }, …)
#   4. export const foo = async (userId: string, …) => …
#   5. export const foo = async ({ userId }: { userId: string }, …) => …
#   6. export const foo = async (opts: { userId: string }, …) => …
#
# This script is invoked by:
#  - .husky/pre-commit (blocks git commit for all devs/CI)
#  - .claude/settings.json PreToolUse hook (blocks Claude's git commit)

set -u
cd "$(git rev-parse --show-toplevel)" || exit 1

# SRC_DIR override exists for the test harness (scripts/__tests__/).
# Default matches the real repo layout.
SRC_DIR="${SRC_DIR:-src/app/actions/}"

files=$(grep -rlE '^"use server"' "$SRC_DIR" 2>/dev/null || true)
[ -z "$files" ] && exit 0

# Patterns:
#   PATTERN_FN_POS : named function with positional `userId: string`
#   PATTERN_FN_OBJ : named function with destructured `{ userId }: { userId: string }`
#                    OR typed bag `name: { userId: string }` (order-agnostic — see below)
#   PATTERN_ARROW_POS : const … = async (userId: string,
#   PATTERN_ARROW_OBJ : const … = async ({ userId }: { userId: string }, OR ({ userId: string })
#
# grep -E is POSIX ERE, so we keep each pattern simple and combine with -e.
# We accept either `{ userId: string }` in the type annotation OR
# the destructure form `{ userId }: { userId: string }`. Both are bad.
PATTERN_FN_POS='export async function [a-zA-Z_][a-zA-Z0-9_]*\(\s*userId:\s*string'
PATTERN_FN_OBJ_DESTRUCT='export async function [a-zA-Z_][a-zA-Z0-9_]*\(\s*\{\s*userId\b.*\}\s*:\s*\{[^}]*userId:\s*string'
PATTERN_FN_OBJ_TYPED='export async function [a-zA-Z_][a-zA-Z0-9_]*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*\{[^}]*userId:\s*string'
PATTERN_ARROW_POS='export const [a-zA-Z_][a-zA-Z0-9_]*\s*=\s*async\s*\(\s*userId:\s*string'
PATTERN_ARROW_OBJ_DESTRUCT='export const [a-zA-Z_][a-zA-Z0-9_]*\s*=\s*async\s*\(\s*\{\s*userId\b.*\}\s*:\s*\{[^}]*userId:\s*string'
PATTERN_ARROW_OBJ_TYPED='export const [a-zA-Z_][a-zA-Z0-9_]*\s*=\s*async\s*\(\s*[a-zA-Z_][a-zA-Z0-9_]*\s*:\s*\{[^}]*userId:\s*string'

violations=$(echo "$files" | xargs grep -nE \
  -e "$PATTERN_FN_POS" \
  -e "$PATTERN_FN_OBJ_DESTRUCT" \
  -e "$PATTERN_FN_OBJ_TYPED" \
  -e "$PATTERN_ARROW_POS" \
  -e "$PATTERN_ARROW_OBJ_DESTRUCT" \
  -e "$PATTERN_ARROW_OBJ_TYPED" \
  2>/dev/null || true)
[ -z "$violations" ] && exit 0

cat >&2 <<EOF
❌ Security: Server Action exports a function that accepts userId as its first parameter.
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
