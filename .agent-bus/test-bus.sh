#!/bin/sh
# test-bus.sh — self-test for the .agent-bus message bus.
#
# Runs against the REAL .agent-bus directories (messages are runtime state,
# not source). It refuses to run if either inbox already holds a message, so
# it can never destroy in-flight traffic, and it removes its own archived
# messages when it is done.
#
# Prints PASS/FAIL per case; exits non-zero if any case fails.
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUS_DIR=$SCRIPT_DIR
REPO_ROOT=$(dirname "$BUS_DIR")
BIN="$BUS_DIR/bin"
RUNTIME="$BIN/codex-reviewer-runtime"
TASK=BUS-SELFTEST

FAILURES=0
CASE_NO=0

pass() { CASE_NO=$((CASE_NO + 1)); printf 'PASS  %d. %s\n' "$CASE_NO" "$1"; }
fail() {
  CASE_NO=$((CASE_NO + 1)); FAILURES=$((FAILURES + 1))
  printf 'FAIL  %d. %s\n' "$CASE_NO" "$1"
  [ $# -gt 1 ] && printf '        -> %s\n' "$2"
}
check() { # check <description> <condition-result> [detail]
  if [ "$2" = 0 ]; then pass "$1"; else fail "$1" "${3:-}"; fi
}

inbox_count() {
  n=0
  for f in "$BUS_DIR/inbox/$1"/*.json; do
    [ -e "$f" ] || break
    n=$((n + 1))
  done
  printf '%s' "$n"
}

mkdir -p "$BUS_DIR/inbox/builder" "$BUS_DIR/inbox/reviewer" \
         "$BUS_DIR/archive" "$BUS_DIR/tmp"

"$RUNTIME" status >/dev/null 2>&1
runtime_status=$?
if [ "$runtime_status" != 1 ] || [ -e "$BUS_DIR/tmp/codex-reviewer.lock" ] || \
   [ -e "$BUS_DIR/tmp/codex-reviewer-current" ] || \
   [ "$(inbox_count builder)" != 0 ] || [ "$(inbox_count reviewer)" != 0 ]; then
  printf 'ABORT: Reviewer runtime/state or an inbox is active; refusing to touch live traffic.\n' >&2
  exit 1
fi

HEAD_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD)
OLD_SHA=$(git -C "$REPO_ROOT" rev-parse HEAD~3 2>/dev/null || git -C "$REPO_ROOT" rev-parse HEAD)
# An orphan commit: real object, reachable from nothing, so not an ancestor of HEAD.
ORPHAN_SHA=$(git -C "$REPO_ROOT" commit-tree "$HEAD_SHA^{tree}" -m 'bus selftest orphan' </dev/null)

printf 'bus self-test\n  repo   : %s\n  HEAD   : %s\n  old    : %s\n  orphan : %s\n\n' \
  "$REPO_ROOT" "$HEAD_SHA" "$OLD_SHA" "$ORPHAN_SHA"

# --- 1. atomic send + wait + read round-trip, both directions --------------
rt_ok=0
rt_detail=''

# builder -> reviewer
p1=$(BUS_FROM=builder "$BIN/bus-send" reviewer READY_FOR_REVIEW "$HEAD_SHA" "$TASK" "slice 1 ready") || rt_ok=1
[ -f "$p1" ] || { rt_ok=1; rt_detail="send did not create $p1"; }
case "$p1" in *"/inbox/reviewer/"*) ;; *) rt_ok=1; rt_detail="wrong inbox: $p1" ;; esac
w1=$("$BIN/bus-wait" reviewer 10) || { rt_ok=1; rt_detail='bus-wait reviewer failed'; }
case "$w1" in *"$p1"*) ;; *) rt_ok=1; rt_detail='bus-wait did not print the message path' ;; esac
case "$w1" in *'"type":"READY_FOR_REVIEW"'*) ;; *) rt_ok=1; rt_detail='bus-wait did not print the JSON' ;; esac
r1=$("$BIN/bus-read" reviewer) || { rt_ok=1; rt_detail='bus-read reviewer failed'; }
case "$r1" in *'"from":"builder"'*'"to":"reviewer"'*) ;; *) rt_ok=1; rt_detail="bad JSON: $r1" ;; esac
[ "$(inbox_count reviewer)" = 0 ] || { rt_ok=1; rt_detail='reviewer inbox not drained'; }
[ -f "$BUS_DIR/archive/$(basename "$p1")" ] || { rt_ok=1; rt_detail='message not archived'; }

# reviewer -> builder
p2=$(BUS_FROM=reviewer "$BIN/bus-send" builder CHANGES_REQUESTED "$HEAD_SHA" "$TASK" "fix the thing") || rt_ok=1
[ -f "$p2" ] || { rt_ok=1; rt_detail="send did not create $p2"; }
w2=$("$BIN/bus-wait" builder 10) || { rt_ok=1; rt_detail='bus-wait builder failed'; }
case "$w2" in *'"type":"CHANGES_REQUESTED"'*) ;; *) rt_ok=1; rt_detail='bus-wait builder JSON missing' ;; esac
r2=$("$BIN/bus-read" builder) || { rt_ok=1; rt_detail='bus-read builder failed'; }
case "$r2" in *'"from":"reviewer"'*'"to":"builder"'*) ;; *) rt_ok=1; rt_detail="bad JSON: $r2" ;; esac
[ "$(inbox_count builder)" = 0 ] || { rt_ok=1; rt_detail='builder inbox not drained'; }

check "round-trip send/wait/read in both directions" "$rt_ok" "$rt_detail"

# --- 2. invalid role and invalid type are rejected (exit 2) ----------------
"$BIN/bus-send" nobody PASS "$HEAD_SHA" "$TASK" x >/dev/null 2>&1; rc_role=$?
"$BIN/bus-send" reviewer NOT_A_TYPE "$HEAD_SHA" "$TASK" x >/dev/null 2>&1; rc_type=$?
v_ok=0
[ "$rc_role" = 2 ] || v_ok=1
[ "$rc_type" = 2 ] || v_ok=1
check "bus-send rejects invalid role and invalid type (exit 2)" "$v_ok" \
      "role rc=$rc_role type rc=$rc_type (want 2/2)"

# --- 3. SHA_BINDING: non-existent sha rejected (exit 3) --------------------
FAKE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
"$BIN/bus-send" reviewer PASS "$FAKE_SHA" "$TASK" x >/dev/null 2>&1; rc_fake=$?
"$BIN/bus-send" reviewer PASS "abc123" "$TASK" x >/dev/null 2>&1; rc_short=$?
"$BIN/bus-send" reviewer PASS "" "$TASK" x >/dev/null 2>&1; rc_empty=$?
s_ok=0
[ "$rc_fake" = 3 ] || s_ok=1
[ "$rc_short" = 3 ] || s_ok=1
[ "$rc_empty" = 3 ] || s_ok=1
check "SHA_BINDING: bogus/short/empty sha rejected (exit 3)" "$s_ok" \
      "fake=$rc_fake short=$rc_short empty=$rc_empty (want 3/3/3)"

# --- 4. ROLE_SEPARATION: from == to rejected (exit 6) ---------------------
BUS_FROM=builder "$BIN/bus-send" builder QUESTION "" "$TASK" x >/dev/null 2>&1; rc_self_b=$?
BUS_FROM=reviewer "$BIN/bus-send" reviewer QUESTION "" "$TASK" x >/dev/null 2>&1; rc_self_r=$?
rs_ok=0
[ "$rc_self_b" = 6 ] || rs_ok=1
[ "$rc_self_r" = 6 ] || rs_ok=1
check "ROLE_SEPARATION: from==to rejected (exit 6)" "$rs_ok" \
      "builder=$rc_self_b reviewer=$rc_self_r (want 6/6)"

# --- 5. bus-wait returns promptly when a message is already present -------
p5=$(BUS_FROM=builder "$BIN/bus-send" reviewer QUESTION "" "$TASK" "already waiting")
t0=$(date +%s)
"$BIN/bus-wait" reviewer 30 >/dev/null; rc5=$?
t1=$(date +%s)
elapsed=$((t1 - t0))
q_ok=0
[ "$rc5" = 0 ] || q_ok=1
[ "$elapsed" -lt 5 ] || q_ok=1
check "bus-wait returns in <5s when a message is present" "$q_ok" \
      "rc=$rc5 elapsed=${elapsed}s"

# --- 9. crash-safety: bus-wait must NOT consume the message ---------------
# (checked here, while the message from case 5 is still pending)
cs_ok=0
[ -f "$p5" ] || cs_ok=1
[ "$(inbox_count reviewer)" = 1 ] || cs_ok=1
w5b=$("$BIN/bus-wait" reviewer 10) || cs_ok=1
[ -f "$p5" ] || cs_ok=1
case "$w5b" in *'"body":"already waiting"'*) ;; *) cs_ok=1 ;; esac
crash_detail="after bus-wait: exists=$([ -f "$p5" ] && echo yes || echo no) count=$(inbox_count reviewer)"

# drain it so later cases see an empty inbox
"$BIN/bus-read" reviewer >/dev/null 2>&1 || cs_ok=1

# --- 6. bus-wait times out with exit 4 when nothing arrives ---------------
t0=$(date +%s)
"$BIN/bus-wait" reviewer 3 >/dev/null 2>&1; rc6=$?
t1=$(date +%s)
elapsed6=$((t1 - t0))
to_ok=0
[ "$rc6" = 4 ] || to_ok=1
[ "$elapsed6" -ge 3 ] || to_ok=1
check "bus-wait times out with exit 4 (timeout 3)" "$to_ok" \
      "rc=$rc6 elapsed=${elapsed6}s (want rc=4, >=3s)"

# --- 7. bus-read on an empty inbox exits 5 --------------------------------
"$BIN/bus-read" reviewer >/dev/null 2>&1; rc7a=$?
"$BIN/bus-read" builder  >/dev/null 2>&1; rc7b=$?
e_ok=0
[ "$rc7a" = 5 ] || e_ok=1
[ "$rc7b" = 5 ] || e_ok=1
check "bus-read on empty inbox exits 5" "$e_ok" \
      "reviewer=$rc7a builder=$rc7b (want 5/5)"

# --- 8. STALE SHA flagging ------------------------------------------------
st_ok=0
st_detail=''

p8a=$(BUS_FROM=builder "$BIN/bus-send" reviewer PASS "$OLD_SHA" "$TASK" "ancestor sha") || st_ok=1
out8a=$("$BIN/bus-read" reviewer) || st_ok=1
case "$out8a" in *'STALE=false'*) ;; *) st_ok=1; st_detail="ancestor sha not flagged STALE=false" ;; esac

p8h=$(BUS_FROM=builder "$BIN/bus-send" reviewer PASS "$HEAD_SHA" "$TASK" "head sha") || st_ok=1
out8h=$("$BIN/bus-read" reviewer) || st_ok=1
case "$out8h" in *'STALE=false'*) ;; *) st_ok=1; st_detail="HEAD sha not flagged STALE=false" ;; esac

p8b=$(BUS_FROM=builder "$BIN/bus-send" reviewer PASS "$ORPHAN_SHA" "$TASK" "orphan sha") || st_ok=1
out8b=$("$BIN/bus-read" reviewer) || st_ok=1
case "$out8b" in *'STALE=true'*) ;; *) st_ok=1; st_detail="orphan sha not flagged STALE=true" ;; esac

# a stale message is flagged, not destroyed
[ -f "$BUS_DIR/archive/$(basename "$p8b")" ] || { st_ok=1; st_detail='stale message was not preserved in archive'; }

check "STALE flagging: HEAD/ancestor=false, non-ancestor=true, not deleted" "$st_ok" "$st_detail"

# --- 9 (reported) ---------------------------------------------------------
check "crash-safety: message still in inbox after bus-wait" "$cs_ok" "$crash_detail"

# --- 10. task is mandatory ------------------------------------------------
"$BIN/bus-send" reviewer QUESTION "" "" x >/dev/null 2>&1; rc10=$?
t_ok=0
[ "$rc10" = 2 ] || t_ok=1
check "empty task is rejected before it can poison a consumer" "$t_ok" "rc=$rc10 (want 2)"

# --- 11. the global sequence preserves mixed-type send order --------------
order_ok=0
p11a=$(BUS_FROM=builder "$BIN/bus-send" reviewer READY_FOR_REVIEW "$HEAD_SHA" "$TASK" "ready first") || order_ok=1
p11b=$(BUS_FROM=builder "$BIN/bus-send" reviewer DONE "" "$TASK" "done second") || order_ok=1
ms11a=$(basename "$p11a" | cut -d- -f1)
ms11b=$(basename "$p11b" | cut -d- -f1)
[ "$ms11a" -lt "$ms11b" ] || order_ok=1
out11a=$("$BIN/bus-read" reviewer) || order_ok=1
out11b=$("$BIN/bus-read" reviewer) || order_ok=1
case "$out11a" in *'"type":"READY_FOR_REVIEW"'*) ;; *) order_ok=1 ;; esac
case "$out11b" in *'"type":"DONE"'*) ;; *) order_ok=1 ;; esac
check "mixed message types retain send order on macOS" "$order_ok" "prefixes=$ms11a,$ms11b"

# --- 12. JSON encoder round-trips controls and Unicode --------------------
json_ok=0
control_body=$(printf 'A\rB\bC\fD\tE\n雪🙂')
p12=$(BUS_FROM=builder "$BIN/bus-send" reviewer QUESTION "" "$TASK" "$control_body") || json_ok=1
node - "$p12" <<'NODE' || json_ok=1
const fs = require("fs");
const m = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
if (m.body !== "A\rB\bC\fD\tE\n雪🙂") process.exit(1);
NODE
"$BIN/bus-read" reviewer >/dev/null 2>&1 || json_ok=1
check "JSON round-trips CR, backspace, form-feed, tab, newline, and Unicode" "$json_ok"

# --- 13. concurrent publishers cannot collide or lose a message ----------
parallel_ok=0
parallel_pids=''
i=1
while [ "$i" -le 24 ]; do
  if [ $((i % 2)) -eq 0 ]; then parallel_type=DONE; else parallel_type=QUESTION; fi
  BUS_FROM=builder "$BIN/bus-send" reviewer "$parallel_type" "" "$TASK" "parallel-$i" \
    > "$BUS_DIR/tmp/bus-selftest-parallel-$i.out" 2>&1 &
  parallel_pids="$parallel_pids $!"
  i=$((i + 1))
done
for parallel_pid in $parallel_pids; do wait "$parallel_pid" || parallel_ok=1; done
node - "$BUS_DIR/inbox/reviewer" "$TASK" <<'NODE' || parallel_ok=1
const fs = require("fs");
const path = require("path");
const [dir, task] = process.argv.slice(2);
const messages = fs.readdirSync(dir).filter((name) => name.endsWith(".json")).map((name) => {
  const value = JSON.parse(fs.readFileSync(path.join(dir, name), "utf8"));
  if (value.task !== task || `${value.id}.json` !== name) process.exit(1);
  return value;
});
if (messages.length !== 24 || new Set(messages.map((m) => m.id)).size !== 24) process.exit(1);
if (new Set(messages.map((m) => m.body)).size !== 24) process.exit(1);
NODE
[ "$(inbox_count reviewer)" = 24 ] || parallel_ok=1
i=1
while [ "$i" -le 24 ]; do "$BIN/bus-read" reviewer >/dev/null 2>&1 || parallel_ok=1; i=$((i + 1)); done
rm -f "$BUS_DIR/tmp"/bus-selftest-parallel-*.out
check "24 concurrent mixed-type sends are lossless and collision-free" "$parallel_ok"

# --- cleanup: remove only this test's archived messages -------------------
for f in "$BUS_DIR/archive"/*.json; do
  [ -e "$f" ] || break
  if grep -q "\"task\":\"$TASK\"" "$f" 2>/dev/null; then rm -f "$f"; fi
done

printf '\n%d cases run, %d failed\n' "$CASE_NO" "$FAILURES"
[ "$FAILURES" = 0 ] || exit 1
printf 'ALL CASES PASS\n'
exit 0
