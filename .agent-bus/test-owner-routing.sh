#!/bin/sh
# Counterexample-sensitive owner/task routing tests. Always runs in a clone.
set -u

BUS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd -P)
REPO_ROOT=$(dirname "$BUS_DIR")
if ! "$BUS_DIR/bin/run-bus-test-isolated" --verify "$REPO_ROOT"; then
  "$BUS_DIR/bin/run-bus-test-isolated" .agent-bus/test-owner-routing.sh "$@"
  exit $?
fi

SEND="$BUS_DIR/bin/bus-send"
WAIT="$BUS_DIR/bin/bus-wait"
READ="$BUS_DIR/bin/bus-read"
ARM="$BUS_DIR/bin/bus-arm"
HEAD_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
ORPHAN_SHA=$(git -C "$REPO_ROOT" commit-tree "$HEAD_SHA^{tree}" -m routing-orphan </dev/null)
OWNER_A=builder-A
OWNER_B=builder-B
REPO_ID=repo-shared-fixture
REPO_PATH="$REPO_ROOT/.git"
FAILURES=0

pass() { printf 'PASS  %s\n' "$1"; }
fail() { printf 'FAIL  %s\n' "$1"; FAILURES=$((FAILURES + 1)); }
count_inbox() { find "$BUS_DIR/inbox/$1" -maxdepth 1 -name '*.json' -type f | wc -l | tr -d ' '; }
route_key() { printf '%s\n%s' "$1" "$2" | git hash-object --stdin | cut -c1-16; }
wait_dead() { # wait_dead <pid>
  _i=0
  while [ "$_i" -lt 60 ] && kill -0 "$1" 2>/dev/null; do sleep 0.1; _i=$((_i + 1)); done
  ! kill -0 "$1" 2>/dev/null
}

send_as() { # owner branch worktree to type sha task body
  _owner=$1 _branch=$2 _tree=$3 _to=$4 _type=$5 _sha=$6 _task=$7 _body=$8
  if [ "$_to" = builder ]; then _from=reviewer; else _from=builder; fi
  AGENT_BUS_OWNER_ID="$_owner" AGENT_BUS_WORKER_ID="$_owner" \
  AGENT_BUS_ORIGIN_BRANCH="$_branch" AGENT_BUS_ORIGIN_WORKTREE="$_tree" \
  AGENT_BUS_ORIGIN_REPO_ID="$REPO_ID" AGENT_BUS_ORIGIN_REPO_PATH="$REPO_PATH" \
  BUS_FROM="$_from" "$SEND" "$_to" "$_type" "$_sha" "$_task" "$_body"
}

mkdir -p "$BUS_DIR/inbox/builder" "$BUS_DIR/inbox/reviewer" "$BUS_DIR/archive" "$BUS_DIR/tmp"

# A arrives first; B must bypass it without touching a byte of A.
A_PATH=$(send_as "$OWNER_A" branch-A /physical/worktree-A builder PASS "$HEAD_SHA" ROUTE-A A)
A_BEFORE=$(cksum "$A_PATH")
B_PATH=$(send_as "$OWNER_B" branch-B /physical/worktree-B builder PASS "$HEAD_SHA" ROUTE-B B)
B_WAIT=$("$WAIT" builder 2 --task ROUTE-B --owner "$OWNER_B") || fail "B waiter did not bypass older A"
case "$B_WAIT" in *"$B_PATH"*) pass "B waiter selects B behind older A" ;; *) fail "B waiter selected wrong path" ;; esac
B_READ=$("$READ" builder --task ROUTE-B --owner "$OWNER_B") || fail "B read failed"
case "$B_READ" in *'"task_id":"ROUTE-B"'*'STALE=false'*) pass "B consumes only its exact routed verdict" ;; *) fail "B read binding/stale mismatch" ;; esac
[ -f "$A_PATH" ] && [ "$(cksum "$A_PATH")" = "$A_BEFORE" ] \
  && pass "scanning B neither moves nor edits older A" || fail "A changed while B scanned"

"$READ" builder --task ROUTE-A --owner intruder >/dev/null 2>&1; WRONG_RC=$?
[ "$WRONG_RC" = 8 ] && [ "$(cksum "$A_PATH")" = "$A_BEFORE" ] \
  && pass "wrong owner is rejected and cannot consume" || fail "wrong-owner rc/state mismatch"
AGENT_BUS_POLL_SECONDS=1 "$WAIT" builder 2 --task ROUTE-A --owner intruder >/dev/null 2>&1; WRONG_WAIT_RC=$?
[ "$WRONG_WAIT_RC" = 8 ] && [ "$(cksum "$A_PATH")" = "$A_BEFORE" ] \
  && pass "wrong-owner waiter is rejected immediately without consuming" || fail "wrong-owner wait rc/state mismatch"
A_READ=$("$READ" builder --task ROUTE-A --owner "$OWNER_A") || fail "A read failed"
case "$A_READ" in *'"task_id":"ROUTE-A"'*'STALE=false'*) pass "A later consumes A" ;; *) fail "A read mismatch" ;; esac
"$READ" builder --task ROUTE-A --owner "$OWNER_A" >/dev/null 2>&1; AGAIN_RC=$?
[ "$AGAIN_RC" = 5 ] && pass "A archives exactly once" || fail "second A consume rc=$AGAIN_RC"

# Durable identity fields represent two branches/worktrees of one repository.
node - "$BUS_DIR/archive/$(basename "$A_PATH")" "$BUS_DIR/archive/$(basename "$B_PATH")" <<'NODE'
const fs = require("fs");
const [aPath, bPath] = process.argv.slice(2);
const a = JSON.parse(fs.readFileSync(aPath, "utf8"));
const b = JSON.parse(fs.readFileSync(bPath, "utf8"));
const fields = ["task_id", "owner_id", "worker_id", "origin_branch", "origin_worktree", "origin_repo_id", "origin_repo_path"];
if (!fields.every((f) => typeof a[f] === "string" && a[f] && typeof b[f] === "string" && b[f])) process.exit(1);
if (a.owner_id !== a.worker_id || b.owner_id !== b.worker_id) process.exit(1);
if (a.origin_branch === b.origin_branch || a.origin_worktree === b.origin_worktree) process.exit(1);
if (a.origin_repo_id !== b.origin_repo_id || a.origin_repo_path !== b.origin_repo_path) process.exit(1);
NODE
[ $? = 0 ] && pass "two branches/worktrees retain distinct physical origin and shared repo identity" || fail "origin identity fields invalid"

# Restart is non-destructive: killing a waiter leaves the message layer empty;
# after publication, a fresh waiter finds the correct route.
"$WAIT" builder 30 --task ROUTE-RESTART --owner "$OWNER_B" >/dev/null 2>&1 & OLD_WAIT=$!
sleep 1; kill "$OLD_WAIT" 2>/dev/null || true; wait "$OLD_WAIT" 2>/dev/null || true
R_PATH=$(send_as "$OWNER_B" branch-B /physical/worktree-B builder PASS "$HEAD_SHA" ROUTE-RESTART restart)
R_WAIT=$("$WAIT" builder 2 --task ROUTE-RESTART --owner "$OWNER_B")
case "$R_WAIT" in *"$R_PATH"*) pass "waiter restart preserves routed delivery" ;; *) fail "restart lost route" ;; esac
"$READ" builder --task ROUTE-RESTART --owner "$OWNER_B" >/dev/null

# Existing stale-SHA semantics survive selective routing.
send_as "$OWNER_B" branch-B /physical/worktree-B builder PASS "$ORPHAN_SHA" ROUTE-STALE stale >/dev/null
STALE_OUT=$("$READ" builder --task ROUTE-STALE --owner "$OWNER_B")
case "$STALE_OUT" in *'STALE=true'*) pass "selective read preserves stale-SHA rejection signal" ;; *) fail "stale SHA was not flagged" ;; esac

# The first routed message owns the task; a conflicting writer cannot publish.
send_as "$OWNER_A" branch-A /physical/worktree-A reviewer TASK "" ROUTE-OWNERSHIP assign >/dev/null
BEFORE_CONFLICT=$(count_inbox reviewer)
send_as "$OWNER_B" branch-B /physical/worktree-B reviewer READY_FOR_REVIEW "$HEAD_SHA" ROUTE-OWNERSHIP conflict >/dev/null 2>&1
CONFLICT_RC=$?
[ "$CONFLICT_RC" = 7 ] && [ "$(count_inbox reviewer)" = "$BEFORE_CONFLICT" ] \
  && pass "one task has one durable write owner" || fail "task-owner conflict was published"
"$READ" reviewer >/dev/null

# Legacy is explicit: scoped readers do not claim it; only unscoped migration
# mode may archive the truly field-less message.
LEGACY_PATH=$(send_as "$OWNER_A" branch-A /physical/worktree-A builder QUESTION "" ROUTE-LEGACY legacy)
node - "$LEGACY_PATH" <<'NODE'
const fs = require("fs");
const file = process.argv[2];
const m = JSON.parse(fs.readFileSync(file, "utf8"));
for (const f of ["task_id", "owner_id", "worker_id", "origin_branch", "origin_worktree", "origin_repo_id", "origin_repo_path", "reply_to_id"]) delete m[f];
fs.writeFileSync(file, `${JSON.stringify(m)}\n`);
NODE
"$READ" builder --task ROUTE-LEGACY --owner "$OWNER_A" >/dev/null 2>&1; LEGACY_SCOPED_RC=$?
[ "$LEGACY_SCOPED_RC" = 5 ] && [ -f "$LEGACY_PATH" ] \
  && pass "scoped reader leaves legacy message unclaimed" || fail "scoped reader claimed legacy"
LEGACY_OUT=$(env -u AGENT_BUS_TASK_ID -u AGENT_BUS_OWNER_ID "$READ" builder)
case "$LEGACY_OUT" in *'"task":"ROUTE-LEGACY"'*) pass "legacy migration is explicit and unscoped" ;; *) fail "legacy unscoped migration failed" ;; esac

# A process that merely runs the exact scoped bus-wait command is not a
# supervisor. bus-arm must replace it, even while its shell parent is alive.
STANDALONE_TASK=ROUTE-STANDALONE
STANDALONE_KEY=$(route_key "$STANDALONE_TASK" "$OWNER_A")
STANDALONE_PIDFILE="$BUS_DIR/tmp/waiter-builder-$STANDALONE_KEY.pid"
"$WAIT" builder 40 --task "$STANDALONE_TASK" --owner "$OWNER_A" >/dev/null 2>&1 & STANDALONE=$!
sleep 1
printf '%s\n' "$STANDALONE" > "$STANDALONE_PIDFILE"
"$ARM" builder 20 --task "$STANDALONE_TASK" --owner "$OWNER_A" >"$BUS_DIR/tmp/route-standalone-arm.out" 2>&1 & STANDALONE_ARM=$!
_i=0
while [ "$_i" -lt 80 ] && [ "$(cat "$STANDALONE_PIDFILE" 2>/dev/null || true)" = "$STANDALONE" ]; do sleep 0.1; _i=$((_i + 1)); done
wait "$STANDALONE" 2>/dev/null || true
REPLACEMENT=$(cat "$STANDALONE_PIDFILE" 2>/dev/null || true)
if ! kill -0 "$STANDALONE" 2>/dev/null && [ -n "$REPLACEMENT" ] && [ "$REPLACEMENT" != "$STANDALONE" ] && kill -0 "$REPLACEMENT" 2>/dev/null; then
  pass "standalone scoped waiter is replaced, not mistaken for a supervisor"
else
  fail "standalone replacement failed: old=$STANDALONE new=${REPLACEMENT:-none} arm=$(cat "$BUS_DIR/tmp/route-standalone-arm.out" 2>/dev/null)"
fi
kill "$REPLACEMENT" 2>/dev/null || true
wait "$STANDALONE_ARM" 2>/dev/null || true

# Two routed arms coexist; each wakes only for its own task. Cleanup must leave
# no waiter, supervisor claim, or route lock directory/daemon.
"$ARM" builder 20 --task ROUTE-ARM-A --owner "$OWNER_A" >"$BUS_DIR/tmp/route-arm-a.out" 2>&1 & ARM_A=$!
"$ARM" builder 20 --task ROUTE-ARM-B --owner "$OWNER_B" >"$BUS_DIR/tmp/route-arm-b.out" 2>&1 & ARM_B=$!
sleep 2
KEY_A=$(route_key ROUTE-ARM-A "$OWNER_A"); KEY_B=$(route_key ROUTE-ARM-B "$OWNER_B")
PID_A=$(cat "$BUS_DIR/tmp/waiter-builder-$KEY_A.pid" 2>/dev/null || true)
PID_B=$(cat "$BUS_DIR/tmp/waiter-builder-$KEY_B.pid" 2>/dev/null || true)
if [ -n "$PID_A" ] && [ -n "$PID_B" ] && [ "$PID_A" != "$PID_B" ] && kill -0 "$PID_A" 2>/dev/null && kill -0 "$PID_B" 2>/dev/null; then
  pass "selective arm namespaces two Builders without duplicate ownership"
else
  fail "two selective arms were not independently live"
fi
send_as "$OWNER_B" branch-B /physical/worktree-B builder QUESTION "" ROUTE-ARM-B wake-B >/dev/null
wait_dead "$PID_B" || true
kill -0 "$PID_A" 2>/dev/null && ! kill -0 "$PID_B" 2>/dev/null \
  && pass "B wake does not wake A" || fail "selective arm cross-woke wrong Builder"
"$READ" builder --task ROUTE-ARM-B --owner "$OWNER_B" >/dev/null
send_as "$OWNER_A" branch-A /physical/worktree-A builder QUESTION "" ROUTE-ARM-A wake-A >/dev/null
wait_dead "$PID_A" || fail "A waiter did not wake"
"$READ" builder --task ROUTE-ARM-A --owner "$OWNER_A" >/dev/null
wait "$ARM_A" 2>/dev/null || true; wait "$ARM_B" 2>/dev/null || true
sleep 1
LEAKS=$(ps ax -o command= | grep -F "$REPO_ROOT/.agent-bus/bin/bus-wait builder" | grep -v grep | wc -l | tr -d ' ')
[ "$LEAKS" = 0 ] && [ ! -e "$BUS_DIR/tmp/waiter-builder-$KEY_A.pid" ] && [ ! -e "$BUS_DIR/tmp/waiter-builder-$KEY_B.pid" ] \
  && [ ! -e "$BUS_DIR/tmp/supervisor-builder-$KEY_A.pid" ] && [ ! -e "$BUS_DIR/tmp/supervisor-builder-$KEY_B.pid" ] \
  && pass "routing test leaves no daemon, pidfile, or supervisor claim" || fail "routing process/state leaked"

if [ "$FAILURES" -eq 0 ]; then
  printf 'owner routing self-test: ALL PASS\n'
else
  printf 'owner routing self-test: %s failure(s)\n' "$FAILURES"
fi
exit "$FAILURES"
