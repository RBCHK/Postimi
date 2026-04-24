#!/usr/bin/env bash
#
# Harness for scripts/check-server-actions.sh
#
# Why this test exists:
#   The real script guards a security invariant (no Server Action may
#   export `userId: string` as its first parameter). If the script stops
#   catching violations — e.g. someone changes the grep and breaks it —
#   the guard silently lets attacker-controlled userIds through.
#
# Cases covered:
#   (A) bad file with `export async function foo(userId: string …)` → non-zero exit
#   (B) clean file with only `requireUserId()` → exit 0
#   (C) empty directory → exit 0
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

# --- Case A: bad file must fail ---
echo "Case A: bad file with userId: string export"
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
assert_exit "2" "$rc" "bad file trips the guard (exit 2)"
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

echo ""
echo "Summary: $pass passed, $fail failed"
[ "$fail" = "0" ]
