#!/usr/bin/env bash
#
# Harness for scripts/check-server-actions.sh
#
# Why this test exists:
#   The real script guards a security invariant (no Server Action may
#   accept a caller-provided userId as its first parameter). If the
#   script stops catching violations — e.g. someone changes the grep
#   and breaks it — the guard silently lets attacker-controlled userIds
#   through.
#
# Cases covered:
#   (A) bad: `export async function foo(userId: string …)` → non-zero exit
#   (B) clean file with only `requireUserId()` → exit 0
#   (C) empty directory → exit 0
#   (D) bad: `export async function foo({ userId }: { userId: string }, …)` → non-zero
#   (E) bad: `export async function foo(opts: { userId: string }, …)` → non-zero
#   (F) bad: `export const foo = async (userId: string, …) =>` → non-zero
#   (G) bad: `export const foo = async ({ userId }: { userId: string }, …) =>` → non-zero
#   (H) bad: `export const foo = async (opts: { userId: string }, …) =>` → non-zero
#
# The script accepts `SRC_DIR` env var so we can point it at a fake tree.
set -u

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCRIPT="$REPO_ROOT/scripts/check-server-actions.sh"

if [ ! -f "$SCRIPT" ]; then
  echo "FAIL: cannot locate check-server-actions.sh at $SCRIPT" >&2
  exit 1
fi

pass=0
fail=0

assert_exit() {
  local expected="$1"
  local actual="$2"
  local label="$3"
  if [ "$expected" = "$actual" ]; then
    echo "  PASS: $label (exit=$actual)"
    pass=$((pass + 1))
  else
    echo "  FAIL: $label (expected exit=$expected, got $actual)" >&2
    fail=$((fail + 1))
  fi
}

# --- Case A: bad file must fail (positional userId: string) ---
echo "Case A: bad file with positional userId: string export"
tmp_a=$(mktemp -d)
mkdir -p "$tmp_a/fakedir"
cat >"$tmp_a/fakedir/bad.ts" <<'EOF'
"use server";

export async function leakyAction(userId: string, payload: string) {
  return { userId, payload };
}
EOF
SRC_DIR="$tmp_a/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "2" "$rc" "positional userId: string trips the guard (exit 2)"
rm -rf "$tmp_a"

# --- Case B: clean file must pass ---
echo "Case B: clean file with requireUserId()"
tmp_b=$(mktemp -d)
mkdir -p "$tmp_b/fakedir"
cat >"$tmp_b/fakedir/good.ts" <<'EOF'
"use server";

import { requireUserId } from "@/lib/auth";

export async function goodAction(payload: string) {
  const userId = await requireUserId();
  return { userId, payload };
}
EOF
SRC_DIR="$tmp_b/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "0" "$rc" "clean file passes (exit 0)"
rm -rf "$tmp_b"

# --- Case C: empty directory must pass ---
echo "Case C: empty directory"
tmp_c=$(mktemp -d)
mkdir -p "$tmp_c/fakedir"
SRC_DIR="$tmp_c/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "0" "$rc" "empty directory passes (exit 0)"
rm -rf "$tmp_c"

# --- Case D: object-destructured userId must fail ---
echo "Case D: bad file with { userId }: { userId: string } destructure"
tmp_d=$(mktemp -d)
mkdir -p "$tmp_d/fakedir"
cat >"$tmp_d/fakedir/bad.ts" <<'EOF'
"use server";

export async function leakyAction({ userId, payload }: { userId: string; payload: string }) {
  return { userId, payload };
}
EOF
SRC_DIR="$tmp_d/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "2" "$rc" "destructured { userId }: { userId: string } trips the guard (exit 2)"
rm -rf "$tmp_d"

# --- Case E: typed-bag userId must fail ---
echo "Case E: bad file with opts: { userId: string } param"
tmp_e=$(mktemp -d)
mkdir -p "$tmp_e/fakedir"
cat >"$tmp_e/fakedir/bad.ts" <<'EOF'
"use server";

export async function leakyAction(opts: { userId: string; payload: string }) {
  return opts;
}
EOF
SRC_DIR="$tmp_e/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "2" "$rc" "typed bag opts: { userId: string } trips the guard (exit 2)"
rm -rf "$tmp_e"

# --- Case F: arrow-function positional userId must fail ---
echo "Case F: bad file with arrow-function positional userId"
tmp_f=$(mktemp -d)
mkdir -p "$tmp_f/fakedir"
cat >"$tmp_f/fakedir/bad.ts" <<'EOF'
"use server";

export const leakyAction = async (userId: string, payload: string) => {
  return { userId, payload };
};
EOF
SRC_DIR="$tmp_f/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "2" "$rc" "arrow-function positional userId trips the guard (exit 2)"
rm -rf "$tmp_f"

# --- Case G: arrow-function destructured userId must fail ---
echo "Case G: bad file with arrow-function { userId } destructure"
tmp_g=$(mktemp -d)
mkdir -p "$tmp_g/fakedir"
cat >"$tmp_g/fakedir/bad.ts" <<'EOF'
"use server";

export const leakyAction = async ({ userId, payload }: { userId: string; payload: string }) => {
  return { userId, payload };
};
EOF
SRC_DIR="$tmp_g/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "2" "$rc" "arrow-function destructured { userId } trips the guard (exit 2)"
rm -rf "$tmp_g"

# --- Case H: arrow-function typed-bag userId must fail ---
echo "Case H: bad file with arrow-function opts: { userId: string } param"
tmp_h=$(mktemp -d)
mkdir -p "$tmp_h/fakedir"
cat >"$tmp_h/fakedir/bad.ts" <<'EOF'
"use server";

export const leakyAction = async (opts: { userId: string; payload: string }) => {
  return opts;
};
EOF
SRC_DIR="$tmp_h/fakedir/" bash "$SCRIPT" >/dev/null 2>&1
rc=$?
assert_exit "2" "$rc" "arrow-function typed bag trips the guard (exit 2)"
rm -rf "$tmp_h"

echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" = "0" ]
