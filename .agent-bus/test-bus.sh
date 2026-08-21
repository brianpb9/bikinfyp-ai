#!/bin/sh
# test-bus.sh — self-test for the .agent-bus message bus.
#
# The public entrypoint re-runs this suite inside a disposable local clone, so
# it cannot consume or mutate live runtime traffic. The inner guard is defense
# in depth for direct isolated invocations.
#
# Prints PASS/FAIL per case; exits non-zero if any case fails.
set -u

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BUS_DIR=$SCRIPT_DIR
REPO_ROOT=$(dirname "$BUS_DIR")
if ! "$SCRIPT_DIR/bin/run-bus-test-isolated" --verify "$REPO_ROOT"; then
  "$SCRIPT_DIR/bin/run-bus-test-isolated" .agent-bus/test-bus.sh "$@"
  exit $?
fi
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

# --- 12. LIFECYCLE PENUNGGU (bus-arm) -------------------------------------
#
# Sampai 22 Agu bus-arm TIDAK punya satu pun test, padahal ia mekanisme yang
# menjaga loop tetap hidup. Cacat lifecycle yang ditutup di bawah semuanya
# berakhir sama: Builder diam-diam tuli sementara laporannya berkata sehat.

waiter_pid_file="$BUS_DIR/tmp/waiter-builder.pid"
waiter_hidup() { # waiter_hidup <pid>
  [ -n "${1:-}" ] || return 1
  kill -0 "$1" 2>/dev/null || return 1
  case "$(ps -o command= -p "$1" 2>/dev/null || true)" in
    *"$BIN/bus-wait"*builder*) return 0 ;;
    *) return 1 ;;
  esac
}
cacah_penunggu() { # cacah penunggu builder MILIK bus ini
  pgrep -f "$BIN/bus-wait builder" 2>/dev/null | wc -l | tr -d ' '
}
matikan_penunggu() {
  for pid in $(pgrep -f "$BIN/bus-wait builder" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  for pid in $(pgrep -f "$BIN/bus-arm builder" 2>/dev/null); do kill "$pid" 2>/dev/null || true; done
  rm -f "$waiter_pid_file"
  sleep 1
}

matikan_penunggu

# --- 12a. TEPAT SATU penunggu, walau di-arm berkali-kali ------------------
dup_ok=0; dup_detail=""
"$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm1.out" 2>&1 &
arm1=$!
sleep 1
out2=$("$BIN/bus-arm" builder 30 2>&1 || true)
out3=$("$BIN/bus-arm" builder 30 2>&1 || true)
case "$out2" in *"SUDAH ADA"*) ;; *) dup_ok=1; dup_detail="arm kedua tidak mengenali penunggu: $out2" ;; esac
case "$out3" in *"SUDAH ADA"*) ;; *) dup_ok=1; dup_detail="arm ketiga tidak mengenali penunggu: $out3" ;; esac
[ "$(cacah_penunggu)" = 1 ] || { dup_ok=1; dup_detail="penunggu=$(cacah_penunggu), seharusnya 1"; }
check "bus-arm idempoten: tiga kali arm = TEPAT SATU penunggu" "$dup_ok" "$dup_detail"

# --- 12b. TIGA siklus bangun berturut-turut, penunggu pulih tiap kali -----
siklus_ok=0; siklus_detail=""
n=1
while [ "$n" -le 3 ]; do
  "$BIN/bus-send" builder CHANGES_REQUESTED "$HEAD_SHA" "$TASK" "siklus $n" >/dev/null 2>&1 || {
    siklus_ok=1; siklus_detail="bus-send siklus $n gagal"; break; }
  # Penunggu HARUS keluar (itulah yang membangunkan Builder).
  tunggu=0
  while [ "$tunggu" -lt 15 ] && [ "$(cacah_penunggu)" != 0 ]; do sleep 1; tunggu=$((tunggu + 1)); done
  [ "$(cacah_penunggu)" = 0 ] || { siklus_ok=1; siklus_detail="siklus $n: penunggu tidak bangun oleh pesan"; break; }
  # Builder memproses pesannya...
  "$BIN/bus-read" builder >/dev/null 2>&1 || { siklus_ok=1; siklus_detail="siklus $n: bus-read gagal"; break; }
  # ...lalu memasang ulang. Inilah keadaan mantap yang wajib pulih tiap siklus.
  "$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-siklus-$n.out" 2>&1 &
  sleep 1
  [ "$(cacah_penunggu)" = 1 ] || { siklus_ok=1; siklus_detail="siklus $n: penunggu=$(cacah_penunggu) sesudah arm ulang"; break; }
  n=$((n + 1))
done
check "TIGA siklus bangun berturut-turut, tiap kali berakhir dengan TEPAT SATU penunggu" "$siklus_ok" "$siklus_detail"
matikan_penunggu

# --- 12c. TIMEOUT tidak boleh berarti tuli permanen ----------------------
# Cacat lama: bus-wait keluar 4, bus-arm meneruskannya lalu berhenti, dan tidak
# ada yang memasang penunggu berikutnya. Batas 24 jam membuatnya lambat terlihat,
# bukan tidak ada.
to_ok=0; to_detail=""
"$BIN/bus-arm" builder 2 >"$BUS_DIR/tmp/arm-timeout.out" 2>&1 &
arm_to=$!
sleep 7   # cukup untuk beberapa kali habis-waktu
if ! kill -0 "$arm_to" 2>/dev/null; then
  to_ok=1; to_detail="bus-arm berhenti sesudah timeout; Builder tuli permanen"
fi
grep -q 'ARMED-ULANG' "$BUS_DIR/tmp/arm-timeout.out" 2>/dev/null || {
  to_ok=1; to_detail="tidak ada ARMED-ULANG: $(cat "$BUS_DIR/tmp/arm-timeout.out" 2>/dev/null)"; }
[ "$(cacah_penunggu)" = 1 ] || { to_ok=1; to_detail="sesudah timeout penunggu=$(cacah_penunggu), seharusnya 1"; }
check "TIMEOUT memasang ulang sendiri — bukan tuli permanen" "$to_ok" "$to_detail"

# --- 12d. --sekali TIDAK memasang ulang (kontrol arah sebaliknya) --------
# Tanpa kontrol ini, bus-arm yang memasang ulang SEGALANYA akan membuat 12c
# hijau tanpa membuktikan bahwa pemasangan ulang itu khusus untuk timeout.
sekali_ok=0; sekali_detail=""
matikan_penunggu
"$BIN/bus-arm" builder 2 --sekali >"$BUS_DIR/tmp/arm-sekali.out" 2>&1
rc_sekali=$?
[ "$rc_sekali" = 4 ] || { sekali_ok=1; sekali_detail="--sekali keluar $rc_sekali, seharusnya 4 (timeout bus-wait)"; }
grep -q 'ARMED-ULANG' "$BUS_DIR/tmp/arm-sekali.out" 2>/dev/null && {
  sekali_ok=1; sekali_detail="--sekali tetap memasang ulang"; }
check "--sekali meneruskan timeout apa adanya (kontrol arah sebaliknya)" "$sekali_ok" "$sekali_detail"

# --- 12e. PID DAUR ULANG tidak boleh diterima sebagai penunggu -----------
# Penjaga lama memakai `kill -0` saja: proses ASING yang kebetulan memakai PID
# di pidfile membuat bus-arm melapor SUDAH ADA lalu keluar tanpa memasang apa
# pun. Builder tuli, laporannya berkata sebaliknya.
reuse_ok=0; reuse_detail=""
matikan_penunggu
sleep 60 &            # proses asing yang HIDUP, tapi jelas bukan penunggu
asing=$!
echo "$asing" > "$waiter_pid_file"
# CATATAN: output bus-arm TIDAK boleh ditangkap lewat $( ) selama ia berjalan
# di latar — pipa command-substitution tidak pernah tertutup selama proses latar
# memegangnya, dan test-nya menggantung selamanya alih-alih gagal. Ditemukan saat
# menulis kasus ini; karena itu keluarannya ditulis ke berkas.
"$BIN/bus-arm" builder 20 >"$BUS_DIR/tmp/arm-reuse.out" 2>&1 &
sleep 2
pid_sekarang=$(cat "$waiter_pid_file" 2>/dev/null || true)
[ "$pid_sekarang" != "$asing" ] || {
  reuse_ok=1; reuse_detail="pidfile masih menunjuk proses asing $asing; bus-arm menolak memasang penunggu"; }
waiter_hidup "$pid_sekarang" || {
  reuse_ok=1; reuse_detail="pidfile menunjuk $pid_sekarang yang bukan penunggu bus ini"; }
[ "$(cacah_penunggu)" = 1 ] || { reuse_ok=1; reuse_detail="penunggu=$(cacah_penunggu) padahal pidfile basi seharusnya diabaikan"; }
kill -0 "$asing" 2>/dev/null || { reuse_ok=1; reuse_detail="proses ASING ikut terbunuh oleh pemulihan pidfile basi"; }
kill "$asing" 2>/dev/null || true
check "PID daur ulang: pidfile basi tidak diterima, dan proses asing tidak dibunuh" "$reuse_ok" "$reuse_detail"
matikan_penunggu

# --- 12f. pesan yang datang saat TIDAK ada penunggu tetap menunggu -------
# Batas jujur dari lifecycle ini: penunggu adalah alat BANGUN, bukan tempat
# menyimpan pesan. Selama pesannya tetap di inbox, jeda tanpa penunggu adalah
# soal latensi, bukan kehilangan.
simpan_ok=0
"$BIN/bus-send" builder QUESTION "$HEAD_SHA" "$TASK" "tanpa penunggu" >/dev/null 2>&1 || simpan_ok=1
[ "$(inbox_count builder)" = 1 ] || simpan_ok=1
"$BIN/bus-arm" builder 20 >/dev/null 2>&1 &
sleep 2
[ "$(inbox_count builder)" = 1 ] || simpan_ok=1   # bus-wait TIDAK mengonsumsi
"$BIN/bus-read" builder >/dev/null 2>&1 || simpan_ok=1
check "pesan yang datang tanpa penunggu tidak hilang — hanya tertunda" "$simpan_ok"
matikan_penunggu

# --- 12g. peringatan hanya berbunyi saat BENAR-BENAR tuli ----------------
# Batas jujur: pembuatan penunggu tidak bisa dipindahkan sepenuhnya ke runtime
# (lihat .agent-bus/README.md — kanal bangunnya milik harness sesi). Yang BISA
# dipindahkan adalah DETEKSINYA: keadaan tuli tidak boleh lagi senyap.
#
# Tapi alarm hanya berguna kalau ia DIAM di alur normal. Versi pertama kasus ini
# cuma menguji "send dengan penunggu sudah terpasang" — bukan transisi kanonik
# yang sebenarnya dijalankan Builder. Dengan kontrak lama (kirim dulu, arm
# belakangan) peringatan itu berbunyi di SETIAP siklus yang benar, dan alarm
# yang selalu berbunyi diabaikan orang dalam sehari (temuan Reviewer, fbb7337).
warn_ok=0; warn_detail=""
matikan_penunggu

# (a) benar-benar tuli -> HARUS berbunyi
err_tanpa=$("$BIN/bus-send" reviewer READY_FOR_REVIEW "$HEAD_SHA" "$TASK" "tanpa penunggu" 2>&1 >/dev/null || true)
case "$err_tanpa" in
  *"nol penunggu builder"*) ;;
  *) warn_ok=1; warn_detail="tidak ada peringatan saat penunggu nol: ${err_tanpa:-<kosong>}" ;;
esac
"$BIN/bus-read" reviewer >/dev/null 2>&1

# (b) SIKLUS KANONIK PENUH, seperti yang benar-benar dijalankan Builder:
#     Reviewer mengirim -> penunggu keluar (Builder bangun) -> bus-read ->
#     bus-arm -> bus-send. Nol peringatan di seluruh siklus, tiga kali berturut.
"$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-kanonik.out" 2>&1 &
sleep 1
n=1
while [ "$n" -le 3 ]; do
  "$BIN/bus-send" builder CHANGES_REQUESTED "$HEAD_SHA" "$TASK" "kanonik $n" >/dev/null 2>&1
  tunggu=0
  while [ "$tunggu" -lt 15 ] && [ "$(cacah_penunggu)" != 0 ]; do sleep 1; tunggu=$((tunggu + 1)); done
  "$BIN/bus-read" builder >/dev/null 2>&1 || { warn_ok=1; warn_detail="siklus $n: bus-read gagal"; break; }
  # ARM DULU, BARU KIRIM — inilah kontraknya, dan inilah yang diuji.
  "$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-kanonik-$n.out" 2>&1 &
  sleep 1
  err_siklus=$("$BIN/bus-send" reviewer READY_FOR_REVIEW "$HEAD_SHA" "$TASK" "balasan $n" 2>&1 >/dev/null || true)
  case "$err_siklus" in
    *"nol penunggu builder"*) warn_ok=1; warn_detail="ALARM PALSU di siklus kanonik $n: $err_siklus"; break ;;
  esac
  "$BIN/bus-read" reviewer >/dev/null 2>&1
  [ "$(cacah_penunggu)" = 1 ] || { warn_ok=1; warn_detail="siklus $n: penunggu=$(cacah_penunggu)"; break; }
  n=$((n + 1))
done
check "peringatan berbunyi saat tuli, DIAM di tiga siklus kanonik arm-lalu-kirim" "$warn_ok" "$warn_detail"
matikan_penunggu

# --- 12h. TRAP TERM/INT: anak mati, pidfile lepas, kode keluar benar ------
# Klaim "trap memperbaiki pidfile basi" sebelumnya TIDAK PERNAH diuji: helper
# matikan_penunggu membunuh bus-wait lebih dulu, jadi bus-arm selalu keluar
# lewat hasil `wait`, bukan lewat trap (temuan Reviewer, fbb7337).
#
# `set -m` WAJIB di sini, dan alasannya bagian dari yang diuji: POSIX 2.11
# menetapkan bahwa anak LATAR dari shell NON-INTERAKTIF mewarisi SIGINT sebagai
# SIG_IGN, dan trap tidak bisa memasang ulang sinyal yang sudah diabaikan saat
# masuk. Tanpa job control, `kill -INT` ke bus-arm adalah operasi kosong: trap
# INT-nya tidak akan pernah berbunyi, dan test yang "lulus" hanya membuktikan
# bahwa tidak ada yang terjadi. Dengan `set -m` anak mendapat process group
# sendiri dan disposisi sinyal bawaan, jadi INT benar-benar sampai.
trap_ok=0; trap_detail=""
set -m
for sinyal in TERM INT; do
  matikan_penunggu
  "$BIN/bus-arm" builder 60 >"$BUS_DIR/tmp/arm-trap-$sinyal.out" 2>&1 &
  induk=$!
  sleep 2
  anak=$(cat "$waiter_pid_file" 2>/dev/null || true)
  waiter_hidup "$anak" || { trap_ok=1; trap_detail="$sinyal: penunggu tidak terpasang sebelum sinyal"; break; }

  kill -"$sinyal" "$induk" 2>/dev/null || { trap_ok=1; trap_detail="$sinyal: gagal mengirim sinyal ke induk"; break; }
  rc_trap=0
  wait "$induk" 2>/dev/null || rc_trap=$?

  if [ "$sinyal" = INT ]; then harap=130; else harap=143; fi
  [ "$rc_trap" = "$harap" ] || { trap_ok=1; trap_detail="$sinyal: kode keluar $rc_trap, seharusnya $harap"; break; }

  tunggu=0
  while [ "$tunggu" -lt 5 ] && kill -0 "$anak" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
  ! kill -0 "$anak" 2>/dev/null || { trap_ok=1; trap_detail="$sinyal: penunggu $anak YATIM — induk mati, anak hidup"; break; }
  [ ! -f "$waiter_pid_file" ] || { trap_ok=1; trap_detail="$sinyal: pidfile basi tertinggal ($(cat "$waiter_pid_file"))"; break; }
done
set +m
check "trap TERM/INT: anak ikut mati, pidfile lepas, kode keluar 143/130" "$trap_ok" "$trap_detail"
matikan_penunggu

# --- 12i. ARM PARALEL: tetap TEPAT SATU penunggu -------------------------
# Kasus 14 memanggil arm kedua/ketiga SESUDAH sleep, jadi ia tidak pernah
# menguji balapan yang sebenarnya. Dua bus-arm yang start bersamaan dulu bisa
# sama-sama lolos pemeriksaan pidfile SEBELUM salah satunya menulis PID, lalu
# keduanya menelurkan penunggu: satu pesan membangunkan dua kali, dan yang
# tidak tercatat di pidfile jadi yatim (temuan Reviewer, fbb7337).
par_ok=0; par_detail=""
matikan_penunggu
i=1
while [ "$i" -le 8 ]; do
  "$BIN/bus-arm" builder 25 >"$BUS_DIR/tmp/arm-par-$i.out" 2>&1 &
  i=$((i + 1))
done
sleep 4
jml=$(cacah_penunggu)
[ "$jml" = 1 ] || { par_ok=1; par_detail="delapan arm serentak menghasilkan $jml penunggu"; }
tercatat=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$tercatat" || { par_ok=1; par_detail="pidfile ($tercatat) tidak menunjuk penunggu hidup; ada yang yatim"; }
# Penunggu yang HIDUP harus PERSIS yang tercatat — kalau bukan, ada yatim.
hidup_pid=$(pgrep -f "$BIN/bus-wait builder" 2>/dev/null | head -1)
[ "$hidup_pid" = "$tercatat" ] || { par_ok=1; par_detail="penunggu hidup $hidup_pid != tercatat $tercatat"; }
# Tepat SATU pemenang mencetak ARMED; sisanya SUDAH ADA.
armed=$(grep -l '^ARMED ' "$BUS_DIR/tmp"/arm-par-*.out 2>/dev/null | wc -l | tr -d ' ')
[ "$armed" = 1 ] || { par_ok=1; par_detail="$armed instance mengklaim ARMED, seharusnya 1"; }
check "delapan bus-arm SERENTAK: tepat satu penunggu, nol yatim" "$par_ok" "$par_detail"
rm -f "$BUS_DIR/tmp"/arm-par-*.out
matikan_penunggu

# --- 12j. pidfile HANYA boleh dilepas oleh pemiliknya ---------------------
# Cacat pasangan dari 12i, dan Reviewer menyebut keduanya sekaligus:
# pembersihan lama menghapus pidfile TANPA memastikan isinya milik instance itu.
# Akibatnya instance yang penunggunya baru saja selesai bisa menghapus
# REGISTRASI instance lain yang masih hidup — penunggu itu lalu tidak tercatat
# di mana pun, dan `bus-arm` berikutnya menelurkan penunggu KEDUA karena
# pidfile-nya kosong.
#
# DETERMINISTIK, tanpa mengandalkan balapan: pidfile sengaja dialihkan ke
# penunggu lain yang benar-benar hidup, lalu instance pertama dibiarkan HABIS
# WAKTU supaya ia menjalankan jalur pembersihannya.
#
# Pemicunya habis-waktu, BUKAN pesan. Versi pertama kasus ini membangunkan A
# dengan sebuah pesan — dan pesan yang sama juga membangunkan B, yang lalu
# keluar normal. Testnya "menemukan" B mati dan menuduh pembersihan A, padahal
# B hanya melakukan tugasnya. Test yang salah menuduh sama tidak bergunanya
# dengan test yang tidak menguji apa pun.
milik_ok=0; milik_detail=""
matikan_penunggu

"$BIN/bus-arm" builder 3 --sekali >"$BUS_DIR/tmp/arm-milik.out" 2>&1 &
sleep 1
pid_a=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$pid_a" || { milik_ok=1; milik_detail="penunggu A tidak terpasang"; }

# Penunggu KEDUA yang sah dan hidup, mewakili instance lain yang sudah
# mendaftarkan dirinya sesudah A. Batas waktunya panjang supaya ia TIDAK ikut
# selesai karena sebab lain.
"$BIN/bus-wait" builder 60 >/dev/null 2>&1 &
pid_b=$!
sleep 1
printf '%s\n' "$pid_b" > "$waiter_pid_file"

# Biarkan penunggu A habis waktu; instance A lalu menjalankan pembersihannya.
tunggu=0
while [ "$tunggu" -lt 12 ] && kill -0 "$pid_a" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
sleep 2

sisa=$(cat "$waiter_pid_file" 2>/dev/null || true)
[ "$sisa" = "$pid_b" ] || {
  milik_ok=1
  milik_detail="registrasi instance lain dihapus: pidfile berisi '${sisa:-<hilang>}', seharusnya $pid_b. Penunggu B hidup tapi tidak tercatat, jadi arm berikutnya menelurkan penunggu KEDUA."
}
kill -0 "$pid_b" 2>/dev/null || { milik_ok=1; milik_detail="penunggu B ikut terbunuh oleh pembersihan instance lain"; }
kill "$pid_b" 2>/dev/null || true
check "pidfile hanya dilepas oleh pemiliknya — registrasi instance lain tidak dihapus" "$milik_ok" "$milik_detail"
matikan_penunggu

# --- cleanup: remove only this test's archived messages -------------------
for f in "$BUS_DIR/archive"/*.json; do
  [ -e "$f" ] || break
  if grep -q "\"task\":\"$TASK\"" "$f" 2>/dev/null; then rm -f "$f"; fi
done

printf '\n%d cases run, %d failed\n' "$CASE_NO" "$FAILURES"
[ "$FAILURES" = 0 ] || exit 1
printf 'ALL CASES PASS\n'
exit 0
