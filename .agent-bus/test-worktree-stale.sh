#!/bin/sh
# Regression coverage for linked-worktree-bound stale evaluation.
set -u

BUS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(dirname "$BUS_DIR")
if ! "$BUS_DIR/bin/run-bus-test-isolated" --verify "$REPO_ROOT"; then
  "$BUS_DIR/bin/run-bus-test-isolated" .agent-bus/test-worktree-stale.sh "$@"
  exit $?
fi

SEND="$BUS_DIR/bin/bus-send"
READ="$BUS_DIR/bin/bus-read"
OWNER=builder-worktree-stale
FAILURES=0
LINKED=''
LINKED_ROUTE=''

cleanup() {
  case "$LINKED_ROUTE" in /tmp/bikinfyp-agent-bus-linked-*) git -C "$REPO_ROOT" worktree remove --force "$LINKED_ROUTE" >/dev/null 2>&1 || true ;; esac
}
trap cleanup EXIT INT TERM HUP

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
route_key() { printf '%s' "$1" | git hash-object --stdin | cut -c1-16; }
physical() { CDPATH= cd -- "$1" && pwd -P; }
common_dir() {
  _top=$(git -C "$1" rev-parse --show-toplevel) || return 1
  _common=$(git -C "$1" rev-parse --git-common-dir) || return 1
  case "$_common" in /*) ;; *) _common="$_top/$_common" ;; esac
  physical "$_common"
}
send_pass() { # task sha origin_worktree repo_id repo_path
  AGENT_BUS_OWNER_ID="$OWNER" AGENT_BUS_WORKER_ID="$OWNER" \
  AGENT_BUS_ORIGIN_BRANCH=fixture-linked \
  AGENT_BUS_ORIGIN_WORKTREE="$3" AGENT_BUS_ORIGIN_REPO_ID="$4" \
  AGENT_BUS_ORIGIN_REPO_PATH="$5" BUS_FROM=reviewer \
    "$SEND" builder PASS "$2" "$1" fixture >/dev/null
}

mkdir -p "$BUS_DIR/inbox/builder" "$BUS_DIR/inbox/reviewer" "$BUS_DIR/archive" "$BUS_DIR/tmp"

BASE_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
LINKED_SHA=$(git -C "$REPO_ROOT" commit-tree "$BASE_SHA^{tree}" -p "$BASE_SHA" -m linked-head </dev/null)
TOKEN_SHORT=$(printf '%s' "$AGENT_BUS_TEST_TOKEN" | cut -c1-12)
LINKED_ROUTE="/tmp/bikinfyp-agent-bus-linked-$TOKEN_SHORT"
git -C "$REPO_ROOT" worktree add --detach "$LINKED_ROUTE" "$LINKED_SHA" >/dev/null
LINKED=$(physical "$LINKED_ROUTE")
COMMON=$(common_dir "$LINKED")
REPO_ID=$(route_key "$COMMON")

# The canonical checkout deliberately does not contain LINKED_SHA, while the
# supplied linked worktree does. Its unrelated HEAD must not influence scope.
if git -C "$REPO_ROOT" merge-base --is-ancestor "$LINKED_SHA" HEAD 2>/dev/null; then
  fail "fixture canonical HEAD is unrelated to linked SHA"
else
  pass "fixture canonical HEAD is unrelated to linked SHA"
fi
send_pass WT-LINKED "$LINKED_SHA" "$LINKED_ROUTE" "$REPO_ID" "$COMMON"
OUT=$($READ builder --task WT-LINKED --owner "$OWNER" --worktree "$LINKED_ROUTE")
case "$OUT" in *'STALE=false'*) pass "/tmp route resolves to physical linked worktree as non-stale" ;; *) fail "/tmp route alias was stale" ;; esac

send_pass WT-MISMATCH "$LINKED_SHA" "$REPO_ROOT" "$REPO_ID" "$COMMON"
OUT=$($READ builder --task WT-MISMATCH --owner "$OWNER" --worktree "$LINKED")
case "$OUT" in *'STALE=true'*) pass "origin/worktree mismatch fails closed" ;; *) fail "origin/worktree mismatch became non-stale" ;; esac

send_pass WT-REPO-ID "$LINKED_SHA" "$LINKED" wrong-repo-id "$COMMON"
OUT=$($READ builder --task WT-REPO-ID --owner "$OWNER" --worktree "$LINKED")
case "$OUT" in *'STALE=true'*) pass "repository ID mismatch fails closed" ;; *) fail "repository ID mismatch became non-stale" ;; esac

send_pass WT-REPO-PATH "$LINKED_SHA" "$LINKED" "$REPO_ID" "$REPO_ROOT/.git/not-the-common-dir"
OUT=$($READ builder --task WT-REPO-PATH --owner "$OWNER" --worktree "$LINKED")
case "$OUT" in *'STALE=true'*) pass "repository path mismatch fails closed" ;; *) fail "repository path mismatch became non-stale" ;; esac

OTHER="$REPO_ROOT-other"
git clone -q "$REPO_ROOT" "$OTHER"
OTHER=$(physical "$OTHER")
git -C "$OTHER" checkout -q --detach "$LINKED_SHA"
send_pass WT-OTHER "$LINKED_SHA" "$OTHER" "$REPO_ID" "$COMMON"
OUT=$($READ builder --task WT-OTHER --owner "$OWNER" --worktree "$OTHER")
case "$OUT" in *'STALE=true'*) pass "different repository fails closed" ;; *) fail "different repository became non-stale" ;; esac

ORPHAN_SHA=$(git -C "$REPO_ROOT" commit-tree "$BASE_SHA^{tree}" -m orphan </dev/null)
send_pass WT-STALE "$ORPHAN_SHA" "$LINKED" "$REPO_ID" "$COMMON"
OUT=$($READ builder --task WT-STALE --owner "$OWNER" --worktree "$LINKED")
case "$OUT" in *'STALE=true'*) pass "non-ancestor remains stale in correct worktree" ;; *) fail "non-ancestor became non-stale" ;; esac

send_pass WT-OWNER "$LINKED_SHA" "$LINKED" "$REPO_ID" "$COMMON"
BEFORE=$(find "$BUS_DIR/inbox/builder" -name '*reviewer-PASS.json' -type f | wc -l | tr -d ' ')
$READ builder --task WT-OWNER --owner intruder --worktree "$LINKED" >/dev/null 2>&1; RC=$?
AFTER=$(find "$BUS_DIR/inbox/builder" -name '*reviewer-PASS.json' -type f | wc -l | tr -d ' ')
[ "$RC" = 8 ] && [ "$BEFORE" = "$AFTER" ] \
  && pass "wrong owner cannot consume scoped message" || fail "wrong owner consumed or changed inbox"
OUT=$($READ builder --task WT-OWNER --owner "$OWNER" --worktree "$LINKED")
case "$OUT" in *'STALE=false'*) pass "right owner consumes exactly once" ;; *) fail "right owner could not consume" ;; esac
$READ builder --task WT-OWNER --owner "$OWNER" --worktree "$LINKED" >/dev/null 2>&1; RC=$?
[ "$RC" = 5 ] && pass "scoped message archives exactly once" || fail "second consume rc=$RC"

$READ reviewer --worktree "$LINKED" >/dev/null 2>&1; RC=$?
[ "$RC" = 2 ] && pass "Reviewer cannot use Builder worktree scope" || fail "Reviewer accepted --worktree"
$READ builder --worktree "$LINKED" >/dev/null 2>&1; RC=$?
[ "$RC" = 2 ] && pass "worktree scope requires task and owner" || fail "unscoped Builder accepted --worktree"

if [ "$FAILURES" -eq 0 ]; then
  printf 'All worktree stale tests passed.\n'
  exit 0
fi
printf '%s worktree stale test(s) failed.\n' "$FAILURES" >&2
exit 1
