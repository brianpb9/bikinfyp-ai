#!/bin/sh
# Fault-injection test for poison handling, hard-crash recovery, bounded
# failures, exact response ordering, and immediate re-arm.
set -u

BUS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname "$BUS_DIR")
SELF="$BUS_DIR/test-reviewer-runtime.sh"
RUNTIME="$BUS_DIR/bin/codex-reviewer-runtime"
SEND="$BUS_DIR/bin/bus-send"
READ="$BUS_DIR/bin/bus-read"
FAKE="$BUS_DIR/test-fixtures/fake-codex-reviewer.sh"
PID_FILE="$BUS_DIR/tmp/codex-reviewer.pid"
RUNNER_PID_FILE="$BUS_DIR/tmp/codex-reviewer-runner.pid"
CODEX_PID_FILE="$BUS_DIR/tmp/codex-reviewer-codex.pid"
STATE_DIR="$BUS_DIR/tmp/codex-reviewer-current"
LOCK_DIR="$BUS_DIR/tmp/codex-reviewer.lock"
HEAD_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
FAKE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
ACTIVE_PID=''
FAILURES=0

inbox_count() {
  count=0
  for file in "$BUS_DIR/inbox/$1"/*.json; do
    [ -e "$file" ] || break
    count=$((count + 1))
  done
  printf '%s\n' "$count"
}

wait_for() {
  description=$1 command=$2 limit=${3:-200} index=0
  while ! eval "$command"; do
    index=$((index + 1))
    if [ "$index" -ge "$limit" ]; then
      printf 'FAIL  timeout waiting for %s\n' "$description"
      return 1
    fi
    sleep 0.1
  done
}

stop_active() {
  if [ -n "$ACTIVE_PID" ] && kill -0 "$ACTIVE_PID" 2>/dev/null; then
    kill "$ACTIVE_PID" 2>/dev/null || true
    wait "$ACTIVE_PID" 2>/dev/null || true
  fi
  ACTIVE_PID=''
}

cleanup() {
  stop_active
  for role in builder reviewer; do
    for file in "$BUS_DIR/inbox/$role"/*.json; do
      [ -e "$file" ] || break
      grep -q '"task":"RUNTIME-SELFTEST-' "$file" 2>/dev/null && rm -f "$file"
    done
  done
  for file in "$BUS_DIR/archive"/*.json; do
    [ -e "$file" ] || break
    grep -q '"task":"RUNTIME-SELFTEST-' "$file" 2>/dev/null && rm -f "$file"
  done
  rm -rf "$STATE_DIR"
  rm -f "$PID_FILE" "$RUNNER_PID_FILE" "$CODEX_PID_FILE"
  rm -f "$LOCK_DIR/pid"
  rmdir "$LOCK_DIR" 2>/dev/null || true
}

mkdir -p "$BUS_DIR/inbox/builder" "$BUS_DIR/inbox/reviewer" "$BUS_DIR/archive" "$BUS_DIR/tmp"
"$RUNTIME" status >/dev/null 2>&1
runtime_status=$?
if [ "$runtime_status" != 1 ] || [ "$(inbox_count builder)" != 0 ] || \
   [ "$(inbox_count reviewer)" != 0 ] || [ -e "$STATE_DIR" ] || [ -e "$LOCK_DIR" ]; then
  printf 'ABORT: live Reviewer state exists; refusing fault-injection test.\n' >&2
  exit 1
fi
trap cleanup EXIT INT TERM HUP

start_runtime() {
  timeout=$1
  CODEX_REVIEWER_BIN="$FAKE" \
  CODEX_REVIEWER_WAIT_SECONDS=1 \
  CODEX_REVIEWER_RETRY_SECONDS=0 \
  CODEX_REVIEWER_TIMEOUT_SECONDS="$timeout" \
  CODEX_REVIEWER_MAX_ATTEMPTS=2 \
    "$RUNTIME" run >> "$BUS_DIR/tmp/codex-reviewer-selftest.log" 2>&1 &
  ACTIVE_PID=$!
}

printf 'reviewer runtime self-test\n'

# Case 1: the self-test's active-runtime guard must be observational only. A
# rejected nested invocation must not fire this process's destructive cleanup.
start_runtime 5
if wait_for "idle fake runtime state" '[ -s "$PID_FILE" ] && [ -s "$LOCK_DIR/pid" ] && [ -d "$STATE_DIR" ]'; then
  printf 'guard-sentinel\n' > "$STATE_DIR/selftest-guard-sentinel"
  guard_pid_before=$(cat "$PID_FILE")
  guard_lock_before=$(cat "$LOCK_DIR/pid")
  guard_state_before=$(find "$STATE_DIR" -maxdepth 1 -type f -exec cksum {} \; | sort)
  /bin/sh "$SELF" > "$BUS_DIR/tmp/codex-reviewer-nested-guard.log" 2>&1
  nested_rc=$?
  guard_state_after=$(find "$STATE_DIR" -maxdepth 1 -type f -exec cksum {} \; | sort)
  if [ "$nested_rc" = 1 ] && kill -0 "$ACTIVE_PID" 2>/dev/null && [ -d "$STATE_DIR" ] && \
     [ "$(cat "$PID_FILE" 2>/dev/null || true)" = "$guard_pid_before" ] && \
     [ "$(cat "$LOCK_DIR/pid" 2>/dev/null || true)" = "$guard_lock_before" ] && \
     [ "$guard_state_after" = "$guard_state_before" ]; then
    printf 'PASS  active-runtime guard leaves live PID, lock, and state untouched\n'
  else
    printf 'FAIL  active-runtime guard mutated live runtime state\n'
    FAILURES=$((FAILURES + 1))
  fi
  rm -f "$STATE_DIR/selftest-guard-sentinel"
else
  FAILURES=$((FAILURES + 1))
fi
stop_active
wait_for "runtime cleanup after guard regression" '[ ! -e "$LOCK_DIR" ]' 100 || FAILURES=$((FAILURES + 1))

# Case 2: recover state written by the old/crash-window ordering where
# message.json exists but source_name has not been published yet.
staging_path=$(BUS_FROM=builder "$SEND" reviewer READY_FOR_REVIEW "$HEAD_SHA" RUNTIME-SELFTEST-STAGING staging)
mkdir -p "$STATE_DIR"
cp "$staging_path" "$STATE_DIR/message.json"
start_runtime 5
if wait_for "legacy partial staging recovery" '[ "$(inbox_count builder)" -ge 1 ]'; then
  staging_response=$("$READ" builder)
  case "$staging_response" in
    *'"type":"PASS"'*'"task":"RUNTIME-SELFTEST-STAGING"'*) printf 'PASS  partial staging state is recovered without message loss\n' ;;
    *) printf 'FAIL  partial staging state did not receive PASS\n'; FAILURES=$((FAILURES + 1)) ;;
  esac
else
  FAILURES=$((FAILURES + 1))
fi
stop_active
wait_for "runtime cleanup after staging recovery" '[ ! -e "$LOCK_DIR" ]' 100 || FAILURES=$((FAILURES + 1))

# Case 3: a syntactically valid unknown SHA is terminal poison, not a queue lock.
poison_path=$(BUS_FROM=builder "$SEND" reviewer QUESTION "" RUNTIME-SELFTEST-POISON poison)
node - "$poison_path" "$FAKE_SHA" <<'NODE'
const fs = require("fs");
const [file, sha] = process.argv.slice(2);
const message = JSON.parse(fs.readFileSync(file, "utf8"));
message.type = "READY_FOR_REVIEW";
message.sha = sha;
message.id = message.id.replace(/-QUESTION$/, "-READY_FOR_REVIEW");
fs.writeFileSync(file, `${JSON.stringify(message)}\n`);
NODE
poison_ready_path=$(printf '%s\n' "$poison_path" | sed 's/-QUESTION\.json$/-READY_FOR_REVIEW.json/')
mv "$poison_path" "$poison_ready_path"
BUS_FROM=builder "$SEND" reviewer READY_FOR_REVIEW "$HEAD_SHA" RUNTIME-SELFTEST-VALID valid >/dev/null
start_runtime 5
if wait_for "valid message after poison" '[ "$(inbox_count builder)" -ge 1 ]'; then
  response=$($READ builder)
  case "$response" in
    *'"type":"PASS"'*'"task":"RUNTIME-SELFTEST-VALID"'*) printf 'PASS  poison dropped; next valid review completed\n' ;;
    *) printf 'FAIL  unexpected poison response\n'; FAILURES=$((FAILURES + 1)) ;;
  esac
else
  FAILURES=$((FAILURES + 1))
fi
stop_active
wait_for "runtime cleanup after case 3" '[ ! -e "$LOCK_DIR" ]' 100 || FAILURES=$((FAILURES + 1))

# Case 4: SIGKILL leaves a detached reviewer, restart reaps it, bounded failure
# emits CHANGES_REQUESTED, then the next queued SHA receives PASS.
BUS_FROM=builder "$SEND" reviewer READY_FOR_REVIEW "$HEAD_SHA" RUNTIME-SELFTEST-HANG hang >/dev/null
BUS_FROM=builder "$SEND" reviewer READY_FOR_REVIEW "$HEAD_SHA" RUNTIME-SELFTEST-NEXT next >/dev/null
start_runtime 60
if wait_for "runner and Codex PID files" '[ -s "$RUNNER_PID_FILE" ] && [ -s "$CODEX_PID_FILE" ]'; then
  old_runner=$(cat "$RUNNER_PID_FILE")
  old_codex=$(cat "$CODEX_PID_FILE")
  kill -KILL "$ACTIVE_PID"
  wait "$ACTIVE_PID" 2>/dev/null || true
  ACTIVE_PID=''
  start_runtime 1
  if wait_for "bounded failure and following PASS" '[ "$(inbox_count builder)" -ge 2 ]' 300; then
    first=$($READ builder)
    second=$($READ builder)
    case "$first" in
      *'"type":"CHANGES_REQUESTED"'*'"task":"RUNTIME-SELFTEST-HANG"'*) : ;;
      *) printf 'FAIL  first post-crash response was not bounded CHANGES_REQUESTED\n'; FAILURES=$((FAILURES + 1)) ;;
    esac
    case "$second" in
      *'"type":"PASS"'*'"task":"RUNTIME-SELFTEST-NEXT"'*) : ;;
      *) printf 'FAIL  second queued review did not receive PASS\n'; FAILURES=$((FAILURES + 1)) ;;
    esac
    if kill -0 "$old_runner" 2>/dev/null; then
      printf 'FAIL  orphan runner survived restart\n'; FAILURES=$((FAILURES + 1))
    elif node -e 'try{process.kill(-Number(process.argv[1]),0);process.exit(1)}catch(e){process.exit(e.code==="ESRCH"?0:1)}' "$old_codex"; then
      printf 'PASS  hard-crash orphan reaped; bounded failure re-armed queue\n'
    else
      printf 'FAIL  orphan Codex process group survived restart\n'; FAILURES=$((FAILURES + 1))
    fi
  else
    FAILURES=$((FAILURES + 1))
  fi
else
  FAILURES=$((FAILURES + 1))
fi

stop_active
wait_for "final runtime cleanup" '[ ! -e "$LOCK_DIR" ]' 100 || FAILURES=$((FAILURES + 1))

# Case 5: an older infrastructure response for the same SHA/task must not
# suppress an explicit later READY retry. Request/response identity is ordered
# by the bus-global sequence, not permanently memoized by SHA+task.
retry_task=RUNTIME-SELFTEST-RETRY
BUS_FROM=reviewer "$SEND" builder CHANGES_REQUESTED "$HEAD_SHA" "$retry_task" "older infrastructure failure" >/dev/null
"$READ" builder >/dev/null
BUS_FROM=builder "$SEND" reviewer READY_FOR_REVIEW "$HEAD_SHA" "$retry_task" retry >/dev/null
start_runtime 5
if wait_for "same-SHA retry after older response" '[ "$(inbox_count builder)" -ge 1 ]'; then
  retry_response=$("$READ" builder)
  case "$retry_response" in
    *'"type":"PASS"'*'"task":"RUNTIME-SELFTEST-RETRY"'*) printf 'PASS  later READY is not suppressed by an older response\n' ;;
    *) printf 'FAIL  later same-SHA READY was suppressed or misanswered\n'; FAILURES=$((FAILURES + 1)) ;;
  esac
else
  FAILURES=$((FAILURES + 1))
fi
stop_active
wait_for "runtime cleanup after case 5" '[ ! -e "$LOCK_DIR" ]' 100 || FAILURES=$((FAILURES + 1))

printf '%s\n' "runtime self-test failures=$FAILURES"
[ "$FAILURES" -eq 0 ]
