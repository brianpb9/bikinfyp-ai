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
# Cacah penunggu TINGKAT ATAS milik bus ini.
#
# `pgrep -f` mentah TIDAK cukup: bus-wait menjalankan command substitution
# (`dirname`, `date`) yang menelurkan shell anak sesaat, dan anak-anak itu
# mewarisi baris perintah yang cocok polanya. Menghitungnya mentah membuat SATU
# penunggu terbaca sebagai dua atau tiga — persis bukti palsu yang membuat
# "delapan arm serentak menghasilkan 2 penunggu" tampak seperti balapan padahal
# bisa jadi cuma salah hitung. Yang dihitung: proses yang cocok DAN induknya
# bukan penunggu (jadi keturunan transien tidak ikut).
penunggu_puncak() {
  for _p in $(pgrep -f "$BIN/bus-wait builder" 2>/dev/null); do
    _pp=$(ps -o ppid= -p "$_p" 2>/dev/null | tr -d ' ')
    [ -n "$_pp" ] || continue
    case "$(ps -o command= -p "$_pp" 2>/dev/null || true)" in
      *"$BIN/bus-wait"*) continue ;;   # keturunan transien
    esac
    printf '%s\n' "$_p"
  done
}
cacah_penunggu() { penunggu_puncak | wc -l | tr -d ' '; }
# Jalankan bus-arm dengan BATAS WAKTU KERAS.
#
# Tanpa ini, cacat kunci-diwarisi (kasus 24) muncul sebagai SUITE MENGGANTUNG di
# kasus 14, bukan sebagai kasus merah: tidak ada laporan, tidak ada sebab, dan
# di CI ia hanya jadi job yang mati kena batas waktu. Menggantung BUKAN gagal —
# ia lebih buruk, karena tidak memberi tahu apa pun.
#
# `timeout`/`gtimeout` dipakai kalau ada; kalau tidak, jatuh ke latar + polling
# supaya suite ini tidak bergantung pada coreutils.
arm_terbatas() { # arm_terbatas <detik> <argumen bus-arm...>
  _batas=$1; shift
  # BUS_UJI_TANPA_TIMEOUT memaksa cabang fallback. Lihat kasus 12r untuk alasan
  # kenapa mengosongkan PATH BUKAN cara yang sah menguji cabang itu.
  if [ -n "${BUS_UJI_TANPA_TIMEOUT:-}" ]; then
    :
  elif command -v timeout >/dev/null 2>&1; then
    timeout "$_batas" "$BIN/bus-arm" "$@" 2>&1
    return $?
  elif command -v gtimeout >/dev/null 2>&1; then
    gtimeout "$_batas" "$BIN/bus-arm" "$@" 2>&1
    return $?
  fi
  # FALLBACK tanpa timeout/gtimeout.
  #
  # Versi pertama memakai `kill -9` HANYA pada induk bus-arm. Anaknya —
  # bus-wait — lolos jadi YATIM: ia bertahan melewati akhir kasus, memegang
  # inbox klon yang sebentar lagi dihapus, dan mencemari kasus berikutnya
  # dengan penunggu yang tidak dimiliki siapa pun (temuan Reviewer).
  #
  # `set -m` memberi pekerjaan latar ini PROCESS GROUP sendiri, jadi sinyal
  # bisa dialamatkan ke SELURUH pohon lewat PGID negatif. Urutannya juga
  # penting: TERM lebih dulu supaya trap bus-arm sempat membersihkan anaknya
  # sendiri dengan rapi; KILL hanya jaring, dan keduanya BERBATAS.
  _out="$BUS_DIR/tmp/.arm-terbatas.$$"
  set -m
  "$BIN/bus-arm" "$@" >"$_out" 2>&1 &
  _p=$!
  set +m
  _t=0
  while [ "$_t" -lt "$_batas" ] && kill -0 "$_p" 2>/dev/null; do sleep 1; _t=$((_t + 1)); done
  if kill -0 "$_p" 2>/dev/null; then
    kill -TERM -"$_p" 2>/dev/null || kill -TERM "$_p" 2>/dev/null || true
    _k=0
    while kill -0 "$_p" 2>/dev/null && [ "$_k" -lt 40 ]; do
      sleep 0.05 2>/dev/null || sleep 1; _k=$((_k + 1))
    done
    if kill -0 "$_p" 2>/dev/null; then
      kill -9 -"$_p" 2>/dev/null || kill -9 "$_p" 2>/dev/null || true
    fi
    wait "$_p" 2>/dev/null || true
    cat "$_out" 2>/dev/null; rm -f "$_out"
    return 124
  fi
  wait "$_p" 2>/dev/null; _rc=$?
  cat "$_out" 2>/dev/null; rm -f "$_out"
  return "$_rc"
}

# Tunggu pidfile TERBIT, dengan batas waktu keras — bukan sleep tetap.
#
# Sleep tetap sebelum membaca pidfile adalah asumsi kesiapan yang RAPUH:
# terbukti konkret pada suite ini sendiri (kasus jendela pasca-wait, `sleep 1`
# lalu baca pidfile gagal sesekali di bawah beban sistem — jabat tangan token
# bus-arm sendiri boleh makan waktu hingga 10 detik dalam kondisi kontensi).
# Poll ini menunggu KEADAAN SEBENARNYA (pidfile ada), bukan menebak berapa
# lama keadaan itu butuh untuk tercapai — dengan batas atas keras supaya
# kegagalan tetap gagal cepat, bukan menggantung.
tunggu_pidfile() { # tunggu_pidfile <detik_maks>
  _maks=${1:-10}
  _t=0
  while [ "$_t" -lt "$_maks" ]; do
    [ -s "$waiter_pid_file" ] && return 0
    sleep 1; _t=$((_t + 1))
  done
  [ -s "$waiter_pid_file" ]
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
out2=$(arm_terbatas 8 builder 30 || true)
out3=$(arm_terbatas 8 builder 30 || true)
case "$out2$out3" in
  *"SUDAH ADA"*) ;;
  *) dup_ok=1; dup_detail="arm berikutnya MENGGANTUNG (batas 8s terlampaui) — kunci kemungkinan ikut diwarisi penunggu" ;;
esac
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
  tunggu_pidfile 10 || true
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
# SETIAP pecundang harus SELESAI, bukan sekadar "tidak terlihat". Tujuh
# contender yang masih menggantung di kunci akan lolos begitu saja kalau yang
# diperiksa hanya cacah penunggu, lalu tersapu oleh pembersihan berikutnya —
# dan kebuntuan yang tersapu tetap kebuntuan.
# PEMENANG WAJIB TETAP HIDUP — dialah pemilik penunggu. Yang harus habis adalah
# KETUJUH pecundang. Menuntut nol arm tersisa berarti menuntut pemenang ikut
# mati, dan itu justru kebalikan dari yang benar.
sisa=8
tunggu=0
while [ "$tunggu" -lt 20 ]; do
  sisa=$(pgrep -f "$BIN/bus-arm builder" 2>/dev/null | wc -l | tr -d ' ')
  [ "$sisa" -le 1 ] && break
  sleep 1; tunggu=$((tunggu + 1))
done
[ "$sisa" = 1 ] || { par_ok=1; par_detail="$sisa bus-arm hidup sesudah ${tunggu}s, seharusnya 1 (pemenang); pecundang terjepit di kunci"; }

jml=$(cacah_penunggu)
[ "$jml" = 1 ] || { par_ok=1; par_detail="${par_detail:-delapan arm serentak menghasilkan $jml penunggu tingkat atas}"; }
tercatat=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$tercatat" || { par_ok=1; par_detail="${par_detail:-pidfile ($tercatat) tidak menunjuk penunggu hidup; ada yang yatim}"; }
hidup_pid=$(penunggu_puncak | head -1)
[ "$hidup_pid" = "$tercatat" ] || { par_ok=1; par_detail="${par_detail:-penunggu hidup $hidup_pid != tercatat $tercatat}"; }
# Tepat SATU pemenang mencetak ARMED; KETUJUH sisanya wajib SUDAH ADA.
armed=$(grep -l '^ARMED ' "$BUS_DIR/tmp"/arm-par-*.out 2>/dev/null | wc -l | tr -d ' ')
[ "$armed" = 1 ] || { par_ok=1; par_detail="${par_detail:-$armed instance mengklaim ARMED, seharusnya 1}"; }
kalah=$(grep -l 'SUDAH ADA' "$BUS_DIR/tmp"/arm-par-*.out 2>/dev/null | wc -l | tr -d ' ')
[ "$kalah" = 7 ] || { par_ok=1; par_detail="${par_detail:-$kalah pecundang melapor SUDAH ADA, seharusnya 7}"; }
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

# --- 12k. KUNCI TIDAK BOLEH IKUT HIDUP DI DALAM PENUNGGU -----------------
# Cacat paling halus di bus-arm, dan Reviewer membuktikannya lewat bukti PROSES,
# bukan pembacaan kode: kunci fd hidup di OPEN FILE DESCRIPTION, bukan di
# prosesnya. Anak yang mewarisi fd 9 memegang description yang SAMA, jadi kunci
# baru lepas ketika SELURUH pewarisnya menutupnya. Tanpa `9>&-` saat menelurkan
# bus-wait, penunggu yang berumur panjang menahan kunci SEPANJANG HIDUPNYA:
# `exec 9>&-` di induk tidak melepas apa pun, dan bus-arm berikutnya menggantung
# di `lockf 9` sampai penunggu pertama mati.
#
# Efeknya kebalikan dari maksud kunci itu — penjaga anti-duplikat berubah jadi
# penyebab kebuntuan. Karena itu yang diuji BUKAN "arm kedua benar", melainkan
# "arm kedua kembali CEPAT selagi penunggu pertama masih hidup".
fd_ok=0; fd_detail=""
matikan_penunggu
"$BIN/bus-arm" builder 40 >"$BUS_DIR/tmp/arm-fd1.out" 2>&1 &
sleep 2
[ "$(cacah_penunggu)" = 1 ] || { fd_ok=1; fd_detail="penunggu pertama tidak terpasang"; }
pid_pertama=$(cat "$waiter_pid_file" 2>/dev/null || true)

mulai=$(date +%s)
"$BIN/bus-arm" builder 40 >"$BUS_DIR/tmp/arm-fd2.out" 2>&1 &
kedua=$!
tunggu=0
while [ "$tunggu" -lt 10 ] && kill -0 "$kedua" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
selesai=$(date +%s)
durasi=$((selesai - mulai))

kill -0 "$kedua" 2>/dev/null && {
  fd_ok=1
  fd_detail="arm KEDUA menggantung ${durasi}s selagi penunggu pertama hidup — kunci ikut diwarisi penunggu, jadi ia dipegang sepanjang siklus tunggu, bukan hanya bagian kritis"
  kill -9 "$kedua" 2>/dev/null || true
}
[ "$durasi" -le 5 ] || { fd_ok=1; fd_detail="${fd_detail:-arm kedua butuh ${durasi}s, seharusnya segera}"; }
grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-fd2.out" 2>/dev/null || {
  fd_ok=1; fd_detail="${fd_detail:-arm kedua tidak melapor SUDAH ADA: $(cat "$BUS_DIR/tmp/arm-fd2.out" 2>/dev/null)}"; }
# Penunggu pertama harus MASIH hidup: kalau ia mati, "cepat" jadi tidak berarti.
waiter_hidup "$pid_pertama" || { fd_ok=1; fd_detail="${fd_detail:-penunggu pertama mati sebelum arm kedua selesai}"; }
[ "$(cacah_penunggu)" = 1 ] || { fd_ok=1; fd_detail="${fd_detail:-penunggu=$(cacah_penunggu)}"; }
check "arm kedua kembali CEPAT selagi penunggu pertama hidup (kunci tidak diwarisi)" "$fd_ok" "$fd_detail"
matikan_penunggu

# --- 12l. PUBLIKASI menyiratkan identitas sudah terlihat ------------------
# Cacat produksi yang ditemukan Reviewer pada clean run, dan ia benar menolak
# menyebutnya flake: `$!` tersedia seketika sesudah fork, tapi anak belum tentu
# sudah `exec` ke bus-wait. Kalau pidfile diterbitkan dan kunci dilepas di
# jendela itu, contender berikutnya membaca baris perintah yang BELUM cocok,
# menyimpulkan pidfile basi, menghapusnya, lalu menelurkan penunggu KEDUA.
#
# Invarian yang dijaga: BEGITU pidfile terbit, PID di dalamnya WAJIB sudah lolos
# predikat identitas yang sama yang dipakai contender — tanpa polling.
#
# BATAS KEJUJURAN TEST INI: jendela pra-exec ada DI DALAM proses dan tidak bisa
# dilebarkan dari luar (anak yang belum exec adalah salinan shell bus-arm, bukan
# skrip yang bisa kita sisipi jeda). Jadi kepekaan kasus ini statistik —
# diulang beberapa kali — sementara yang membuat invariannya BENAR adalah jabat
# tangan di bus-arm, bukan test ini. Disebut apa adanya supaya tidak dibaca
# sebagai bukti yang lebih kuat dari yang sebenarnya.
pub_ok=0; pub_detail=""
n=1
while [ "$n" -le 5 ]; do
  matikan_penunggu
  "$BIN/bus-arm" builder 25 >"$BUS_DIR/tmp/arm-pub-$n.out" 2>&1 &
  # Tunggu HANYA sampai pidfile terbit, lalu periksa identitas SEKETIKA.
  tunggu=0
  while [ "$tunggu" -lt 60 ] && [ ! -s "$waiter_pid_file" ]; do sleep 0.1 2>/dev/null || sleep 1; tunggu=$((tunggu + 1)); done
  terbit=$(cat "$waiter_pid_file" 2>/dev/null || true)
  [ -n "$terbit" ] || { pub_ok=1; pub_detail="putaran $n: pidfile tidak pernah terbit"; break; }
  waiter_hidup "$terbit" || {
    pub_ok=1
    pub_detail="putaran $n: pidfile terbit dengan PID $terbit yang BELUM terlihat sebagai bus-wait — contender akan menganggapnya basi dan menelurkan penunggu kedua"
    break
  }
  n=$((n + 1))
done
check "pidfile terbit HANYA sesudah identitas penunggu terlihat (jendela pra-exec tertutup)" "$pub_ok" "$pub_detail"
matikan_penunggu

# --- 12m. kunci warisan: hanya pemilik MATI-NUMERIK yang boleh dipulihkan --
# Keadaan upgrade yang sah: f75d064 memakai path yang sama sebagai DIREKTORI.
# Tapi f75 menulis pid sebagai langkah KEDUA, jadi direktori TANPA pid tidak
# berarti tak bertuan — ia bisa berarti pemilik lama sedang di jendela
# mkdir-sebelum-tulis dan MASIH HIDUP. Menghapusnya otomatis = merampas kunci
# yang sedang dipegang. Karena itu hanya pemilik numerik yang terbukti MATI yang
# dipulihkan; sisanya gagal tertutup.
lockfile="$BUS_DIR/tmp/waiter-builder.lock"

warisan_ok=0; warisan_detail=""
matikan_penunggu
rm -rf "$lockfile"; mkdir -p "$lockfile"
# PID mati DETERMINISTIK: proses nyata yang sudah dibunuh dan di-reap, bukan
# angka besar yang diasumsikan bebas. Asumsi "999999 pasti tidak ada" adalah
# tebakan tentang ruang PID host, dan tebakan itu bisa salah.
sleep 60 & mati=$!
kill "$mati" 2>/dev/null || true
wait "$mati" 2>/dev/null || true
echo "$mati" > "$lockfile/pid"
"$BIN/bus-arm" builder 25 >"$BUS_DIR/tmp/arm-warisan.out" 2>&1 &
sleep 3
grep -q '^ARMED ' "$BUS_DIR/tmp/arm-warisan.out" 2>/dev/null || {
  warisan_ok=1; warisan_detail="tidak pulih dari kunci warisan bertuan-mati: $(cat "$BUS_DIR/tmp/arm-warisan.out" 2>/dev/null)"; }
[ "$(cacah_penunggu)" = 1 ] || { warisan_ok=1; warisan_detail="${warisan_detail:-penunggu=$(cacah_penunggu)}"; }
[ ! -d "$lockfile" ] || { warisan_ok=1; warisan_detail="${warisan_detail:-kunci masih berupa direktori}"; }
check "kunci warisan bertuan MATI dipulihkan otomatis" "$warisan_ok" "$warisan_detail"
matikan_penunggu

tutup_ok=0; tutup_detail=""
for kasus in hidup tanpa-pid rusak; do
  matikan_penunggu
  rm -rf "$lockfile"; mkdir -p "$lockfile"
  pemilik=""
  case "$kasus" in
    hidup)     sleep 30 & pemilik=$!; echo "$pemilik" > "$lockfile/pid" ;;
    tanpa-pid) : ;;                                   # jendela mkdir-sebelum-tulis
    rusak)     printf 'bukan-angka\n' > "$lockfile/pid" ;;
  esac
  keluar=$(arm_terbatas 8 builder 20 2>&1); rc_kasus=$?
  # rc PERSIS 75. Tanpa ini, kegagalan karena sebab lain (crash, batas waktu)
  # ikut lolos sebagai "gagal tertutup dengan benar".
  [ "$rc_kasus" = 75 ] || { tutup_ok=1; tutup_detail="$kasus: rc=$rc_kasus, seharusnya 75. keluaran: ${keluar:-<kosong>}"; }
  case "$keluar" in
    *ARMED*) tutup_ok=1; tutup_detail="$kasus: bus-arm MERAMPAS kunci warisan yang tidak terbukti mati" ;;
  esac
  case "$keluar" in
    *"kunci direktori warisan"*) ;;
    *) tutup_ok=1; tutup_detail="${tutup_detail:-$kasus: tidak ada diagnostik warisan yang bisa ditindaklanjuti: ${keluar:-<kosong>}}" ;;
  esac
  [ -d "$lockfile" ] || { tutup_ok=1; tutup_detail="${tutup_detail:-$kasus: direktori warisan dihapus padahal tidak terbukti tak bertuan}"; }
  if [ -n "$pemilik" ]; then
    kill -0 "$pemilik" 2>/dev/null || { tutup_ok=1; tutup_detail="${tutup_detail:-$kasus: proses pemilik ikut terbunuh}"; }
    kill "$pemilik" 2>/dev/null || true
  fi
  [ -z "$tutup_detail" ] || break
done
rm -rf "$lockfile"
check "kunci warisan hidup / tanpa-pid / rusak: GAGAL TERTUTUP, tidak dirampas" "$tutup_ok" "$tutup_detail"
matikan_penunggu

# --- 12n. gerbang PRA-SIAP deterministik ---------------------------------
# Jendela pra-exec tidak bisa dilebarkan dari luar, tapi jendela PRA-SIAP bisa:
# bus-wait menunda token lewat BUS_UJI_TUNDA_SIAP (khusus test). Yang dibuktikan:
# selama token belum datang, pidfile BELUM terbit dan arm kedua TERTAHAN; sesudah
# token, tepat satu ARMED + satu SUDAH ADA + satu penunggu tingkat atas.
gate_ok=0; gate_detail=""
matikan_penunggu
rm -f "$waiter_pid_file"
BUS_UJI_TUNDA_SIAP=6 "$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-gate1.out" 2>&1 &
sleep 2
[ ! -s "$waiter_pid_file" ] || { gate_ok=1; gate_detail="pidfile TERBIT sebelum token SIAP — jendela publikasi masih terbuka"; }
"$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-gate2.out" 2>&1 &
kedua=$!
sleep 2
kill -0 "$kedua" 2>/dev/null || { gate_ok=1; gate_detail="${gate_detail:-arm kedua TIDAK tertahan selagi pemenang memegang kunci pra-siap}"; }
tunggu=0
while [ "$tunggu" -lt 20 ] && kill -0 "$kedua" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$kedua" 2>/dev/null && { gate_ok=1; gate_detail="${gate_detail:-arm kedua tidak pernah lepas sesudah token}"; kill -9 "$kedua" 2>/dev/null || true; }
grep -q '^ARMED ' "$BUS_DIR/tmp/arm-gate1.out" 2>/dev/null || { gate_ok=1; gate_detail="${gate_detail:-pemenang tidak melapor ARMED}"; }
grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-gate2.out" 2>/dev/null || { gate_ok=1; gate_detail="${gate_detail:-arm kedua tidak melapor SUDAH ADA: $(cat "$BUS_DIR/tmp/arm-gate2.out" 2>/dev/null)}"; }
[ "$(cacah_penunggu)" = 1 ] || { gate_ok=1; gate_detail="${gate_detail:-penunggu tingkat atas=$(cacah_penunggu)}"; }
check "gerbang pra-siap: pidfile terbit HANYA sesudah token, arm kedua tertahan lalu SUDAH ADA" "$gate_ok" "$gate_detail"
matikan_penunggu

# --- 12o. inbox yang SUDAH berisi pesan tidak boleh membuat arm menyerah --
# Versi handshake pertama menunggu identitas lewat `ps`. Kalau inbox sudah
# berisi pesan, bus-wait mencetak lalu KELUAR hampir seketika, jadi induk tidak
# pernah sempat melihatnya, menyimpulkan penunggu gagal muncul, dan menyerah
# (exit 76) — SESUDAH pesannya dibangunkan, dan tanpa memasang ulang. Token yang
# dipancarkan sebelum pemindaian pertama menutup itu.
isi_ok=0; isi_detail=""
matikan_penunggu
"$BIN/bus-send" builder PASS "$HEAD_SHA" "$TASK" "sudah menunggu duluan" >/dev/null 2>&1
# `|| true` DILARANG di sini: ia membuat $? selalu 0, jadi kegagalan apa pun
# (75, crash sebelum wake) lolos hijau selama pesannya kebetulan masih ada.
keluar_isi=$(arm_terbatas 10 builder 20 2>&1); rc_isi=$?
[ "$rc_isi" = 0 ] || { isi_ok=1; isi_detail="arm keluar $rc_isi, seharusnya 0: ${keluar_isi:-<kosong>}"; }
case "$keluar_isi" in
  *"token SIAP"*) isi_ok=1; isi_detail="arm MENYERAH (76) padahal pesannya ada — bangun hilang tanpa pemasangan ulang" ;;
esac
# Bangun yang BENAR harus menyebut pesannya, bukan sekadar keluar 0.
case "$keluar_isi" in
  *"/inbox/builder/"*) ;;
  *) isi_ok=1; isi_detail="${isi_detail:-keluaran tidak menunjuk berkas pesan: ${keluar_isi:-<kosong>}}" ;;
esac
case "$keluar_isi" in
  *'"type":"PASS"'*) ;;
  *) isi_ok=1; isi_detail="${isi_detail:-keluaran tidak memuat JSON pesan yang benar}" ;;
esac
[ "$(inbox_count builder)" = 1 ] || { isi_ok=1; isi_detail="${isi_detail:-bus-wait mengonsumsi pesan: inbox=$(inbox_count builder)}"; }
"$BIN/bus-read" builder >/dev/null 2>&1
check "inbox yang sudah berisi pesan membangunkan arm, bukan membuatnya menyerah" "$isi_ok" "$isi_detail"
matikan_penunggu

# --- 12p. contender TIDAK boleh melihat penunggu yang sedang MATI --------
# Kasus 21 hanya mengirim sinyal tanpa contender, jadi ia tidak pernah menguji
# interleaving ini. Cacatnya: pembersihan membunuh penunggu SEBELUM memegang
# kunci, sehingga contender bisa masuk, melihat penunggu yang sudah dikirimi
# TERM tapi belum mati, menyimpulkannya sehat, lalu keluar "SUDAH ADA" —
# dan begitu pembersihan selesai, hasilnya NOL penunggu dengan laporan sehat.
#
# Jendelanya dilebarkan DETERMINISTIK lewat BUS_UJI_TUNDA_BERSIH (khusus test),
# bukan lewat stress timing.
mati_ok=0; mati_detail=""
matikan_penunggu
log_urutan="$BUS_DIR/tmp/kill-log-urutan.txt"
rm -f "$log_urutan"
BUS_UJI_LOG_KILL="$log_urutan" BUS_UJI_TUNDA_BERSIH=5 "$BIN/bus-arm" builder 40 >"$BUS_DIR/tmp/arm-mati1.out" 2>&1 &
induk=$!
tunggu_pidfile 10 || true
anak=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$anak" || { mati_ok=1; mati_detail="penunggu tidak terpasang sebelum sinyal"; }

kill -TERM "$induk" 2>/dev/null || true
sleep 1   # pembersihan sudah memegang kunci dan sedang tertunda
"$BIN/bus-arm" builder 40 >"$BUS_DIR/tmp/arm-mati2.out" 2>&1 &
kedua=$!
sleep 2
# Selagi pembersihan memegang kunci, contender WAJIB tertahan — bukan menyimpulkan sehat.
grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-mati2.out" 2>/dev/null && {
  mati_ok=1
  mati_detail="contender melapor SUDAH ADA atas penunggu yang sedang MATI — sesudah pembersihan selesai tidak ada penunggu tersisa, tapi laporannya sehat"
}
# Contender TIDAK harus keluar: begitu pembersihan melepas registrasi, dialah
# yang memasang penunggu baru dan menjadi pemiliknya — jadi ia memang tetap
# hidup. Yang wajib: ia mengambil alih (ARMED), bukan melapor SUDAH ADA.
tunggu=0
while [ "$tunggu" -lt 25 ]; do
  grep -q '^ARMED ' "$BUS_DIR/tmp/arm-mati2.out" 2>/dev/null && break
  kill -0 "$kedua" 2>/dev/null || break
  sleep 1; tunggu=$((tunggu + 1))
done
grep -q '^ARMED ' "$BUS_DIR/tmp/arm-mati2.out" 2>/dev/null || {
  mati_ok=1
  mati_detail="${mati_detail:-contender tidak pernah mengambil alih: $(cat "$BUS_DIR/tmp/arm-mati2.out" 2>/dev/null)}"
}
sleep 1
[ "$(cacah_penunggu)" = 1 ] || { mati_ok=1; mati_detail="${mati_detail:-akhirnya penunggu=$(cacah_penunggu), seharusnya 1}"; }
tercatat=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$tercatat" || { mati_ok=1; mati_detail="${mati_detail:-pidfile tidak menunjuk penunggu hidup}"; }
# induk WAJIB benar-benar keluar 143 — kalau TERM diabaikan/tertunda dan induk
# masih hidup diam-diam di latar, keseluruhan skenario di atas tidak
# membuktikan apa yang diklaimnya.
rc_induk=0; wait "$induk" 2>/dev/null || rc_induk=$?
[ "$rc_induk" = 143 ] || { mati_ok=1; mati_detail="${mati_detail:-induk (penerima TERM) keluar rc=$rc_induk, seharusnya 143}"; }

# URUTAN EKSEKUSI SEBENARNYA, bukan timing sleep: LOCK harus muncul SEBELUM
# KILL di log. Sleep saja (BUS_UJI_TUNDA_BERSIH) hanya membuktikan "contender
# tertahan selama jendela ada" — mutasi yang memindahkan `kill` ke SEBELUM
# ambil_kunci tetap lolos asalkan jendela sleep-nya tetap diletakkan di posisi
# yang sama, karena PADA SAAT ITU kunci memang sudah dipegang terlepas dari
# kapan kill sebenarnya terjadi. Penanda LOCK/KILL mencatat urutan yang
# sesungguhnya dijalankan, sehingga mutasi yang membalik urutan itu
# menghasilkan baris log yang terbalik pula.
if [ -f "$log_urutan" ]; then
  baris_lock=$(grep -n "^LOCK $anak\$" "$log_urutan" 2>/dev/null | head -1 | cut -d: -f1)
  baris_kill=$(grep -n "^KILL $anak\$" "$log_urutan" 2>/dev/null | head -1 | cut -d: -f1)
  [ -n "$baris_lock" ] || { mati_ok=1; mati_detail="${mati_detail:-tidak ada penanda LOCK untuk $anak}"; }
  [ -n "$baris_kill" ] || { mati_ok=1; mati_detail="${mati_detail:-tidak ada penanda KILL untuk $anak}"; }
  if [ -n "$baris_lock" ] && [ -n "$baris_kill" ]; then
    [ "$baris_lock" -lt "$baris_kill" ] || {
      mati_ok=1
      mati_detail="${mati_detail:-KILL terjadi SEBELUM LOCK (baris $baris_kill vs $baris_lock) — kill di luar kunci}"
    }
  fi
else
  mati_ok=1; mati_detail="${mati_detail:-berkas log urutan tidak ada}"
fi
rm -f "$log_urutan"
check "contender tidak menyimpulkan sehat atas penunggu yang sedang mati" "$mati_ok" "$mati_detail"
matikan_penunggu

# --- 12q. trap TIDAK menyinyali PID yang sudah dituai --------------------
# Sesudah `wait` menuai anak, PID-nya bisa didaur ulang. Trap yang masih
# memegang PID lama akan mengirim sinyal ke PROSES ASING.
#
# Versi pertama kasus ini TIDAK membuktikan itu, dan Reviewer benar menolaknya:
# ia menjalankan penyelesaian --sekali yang normal dan TIDAK PERNAH menyinyali
# induk sesudah anak dituai. Di jalur normal, `bersihkan` berjalan lewat trap
# EXIT saat WAITER sudah kosong di KEDUA versi — jadi mutasi berbahayanya tetap
# hijau, dan gerbangnya hanya membuktikan bahwa tidak ada yang terjadi.
#
# Sekarang: induk DITAHAN di dalam jendela pasca-reap oleh barrier test-only,
# lalu TERM dikirim TEPAT di sana. Yang diasersikan adalah catatan sinyal —
# PID yang sudah dituai tidak boleh muncul di dalamnya.
reap_ok=0; reap_detail=""
matikan_penunggu
log_kill="$BUS_DIR/tmp/kill-log.txt"
rm -f "$log_kill"

# Batas 2 detik + --sekali: penunggu habis waktu lalu DITUAI. Barrier menahan
# induk 6 detik di jendela itu, cukup lebar untuk menyinyalinya dengan pasti.
BUS_UJI_LOG_KILL="$log_kill" BUS_UJI_TUNDA_REAP=6 \
  "$BIN/bus-arm" builder 2 --sekali >"$BUS_DIR/tmp/arm-reap.out" 2>&1 &
induk2=$!
tunggu_pidfile 10 || true
anak2=$(cat "$waiter_pid_file" 2>/dev/null || true)
[ -n "$anak2" ] || { reap_ok=1; reap_detail="penunggu tidak terpasang"; }

# Tunggu sampai anak benar-benar DITUAI (proses hilang), lalu induk pasti
# sedang tertahan di barrier.
tunggu=0
while [ "$tunggu" -lt 12 ] && kill -0 "$anak2" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$anak2" 2>/dev/null && { reap_ok=1; reap_detail="${reap_detail:-anak tidak habis waktu}"; }

# PROSES KORBAN: berdiri SESUDAH anak dituai, mewakili proses asing yang
# mendapat PID daur ulang. Ia tidak boleh mati.
sleep 25 &
korban=$!

kill -0 "$induk2" 2>/dev/null || { reap_ok=1; reap_detail="${reap_detail:-induk sudah keluar sebelum sempat disinyali di jendela pasca-reap}"; }
kill -TERM "$induk2" 2>/dev/null || true
rc2=0; wait "$induk2" 2>/dev/null || rc2=$?
[ "$rc2" = 143 ] || { reap_ok=1; reap_detail="${reap_detail:-induk keluar rc=$rc2, seharusnya 143 (TERM diabaikan/tertunda tidak membuktikan apa pun)}"; }

# ASERSI UTAMA: PID yang sudah dituai tidak boleh disinyali.
if [ -f "$log_kill" ] && grep -q "KILL $anak2\$" "$log_kill" 2>/dev/null; then
  reap_ok=1
  reap_detail="${reap_detail:-trap menyinyali PID $anak2 yang SUDAH dituai — pada daur ulang PID itu mengenai proses asing}"
fi
kill -0 "$korban" 2>/dev/null || { reap_ok=1; reap_detail="${reap_detail:-proses korban ikut mati}"; }
kill "$korban" 2>/dev/null || true
wait "$korban" 2>/dev/null || true
[ ! -f "$waiter_pid_file" ] || { reap_ok=1; reap_detail="${reap_detail:-pidfile tertinggal sesudah penuaian normal}"; }
rm -f "$log_kill"
check "trap tidak menyinyali PID yang sudah dituai (sinyal dikirim DI DALAM jendela pasca-reap)" "$reap_ok" "$reap_detail"
matikan_penunggu

# --- 12r. fallback tanpa timeout/gtimeout tidak meninggalkan YATIM --------
# Jalur fallback hanya berjalan di mesin tanpa timeout/gtimeout, jadi ia mudah
# tidak pernah diuji sama sekali — dan justru di jalur itulah `kill` yang salah
# alamat meninggalkan bus-wait yatim yang mencemari kasus berikutnya.
#
# KENAPA BUKAN "PATH tanpa timeout/gtimeout", walau itu yang diminta: dicoba
# lebih dulu, dan hasilnya membuktikan caranya sendiri tidak sah. `timeout`
# tinggal di direktori yang SAMA dengan `lockf`/`flock`, jadi mengosongkan PATH
# ikut mencabut backend kunci bus-arm: ia keluar 75 (gagal mengunci) alih-alih
# 124, tidak pernah sampai ke cabang pemotongan, DAN meninggalkan keadaan yang
# menjatuhkan tiga kasus lain. Test seperti itu tidak menguji yatim sama sekali.
#
# Yang diuji di sini tetap cabang yang sama, dipilih lewat pemaksa eksplisit.
yatim_ok=0; yatim_detail=""
matikan_penunggu
sebelum=$(cacah_penunggu)
[ "$sebelum" = 0 ] || { yatim_ok=1; yatim_detail="ada $sebelum penunggu sebelum kasus dimulai"; }

# Batas 60 detik, dipotong paksa pada 3: memaksa cabang timeout fallback.
BUS_UJI_TANPA_TIMEOUT=1 arm_terbatas 3 builder 60 >/dev/null 2>&1
rc_fb=$?

[ "$rc_fb" = 124 ] || { yatim_ok=1; yatim_detail="${yatim_detail:-fallback mengembalikan $rc_fb, seharusnya 124}"; }
sleep 1
sesudah=$(cacah_penunggu)
[ "$sesudah" = 0 ] || {
  yatim_ok=1
  yatim_detail="${yatim_detail:-$sesudah penunggu YATIM tertinggal sesudah fallback memotong bus-arm — ia akan mencemari kasus berikutnya dan memegang inbox klon yang sebentar lagi dihapus}"
}
check "fallback tanpa timeout/gtimeout: nol penunggu yatim, kode 124" "$yatim_ok" "$yatim_detail"
matikan_penunggu

# --- 12t. GERBANG STATIS: setiap titik kill dijaga ppid_cocok ------------
# Reviewer menemukan TIGA titik kill yang tidak dijaga sama sekali atau
# dijaga berbeda-beda: fallback pgrep -P yang menyapu SEMUA anak langsung
# (termasuk subshell command-substitution yang sah), cabang token-tidak-sah
# yang kill mentah, dan cabang kegagalan ambil_kunci di LIVE yang kill mentah
# sebelum identitas terbukti. Ketiganya sudah diperbaiki memakai satu helper
# bersama (`ppid_cocok`) — kasus ini MENJAGA agar titik kill BARU yang lahir
# nanti wajib memakai helper yang sama, bukan menulis pemeriksaan sendiri yang
# bisa menyimpang diam-diam.
#
# Statis, bukan runtime: sebagian jendela ini (fase FORKING, misalnya) tidak
# bisa diinjeksi jeda dari luar sama sekali (lihat catatan kejujuran di kasus
# 12r), jadi pemeriksaan sumber ini adalah satu-satunya cara membuktikan
# invariannya tanpa bergantung pada kemampuan menjebak jendela mikrodetik.
statis_ok=0; statis_detail=""
python3 - "$BIN/bus-arm" <<'PYEOF_STATIS' || statis_ok=1
import re, sys
path = sys.argv[1]
lines = open(path).read().splitlines()
bad = []
for i, line in enumerate(lines):
    m = re.search(r'kill "(\$[A-Za-z_!][A-Za-z_]*)" 2>/dev/null \|\| true', line)
    if not m:
        continue
    var = m.group(1)
    # Kill -0 (pemeriksaan, bukan sinyal) dan baris di dalam blok `while
    # kill -0` sengaja tidak diperiksa: sudah dijamin lulus ppid_cocok
    # oleh gerbang if yang membungkus SELURUH blok pembersihan tempatnya berada.
    window = "\n".join(lines[max(0, i - 6):i + 1])
    # DUA bukti identitas yang sah, tergantung SIAPA yang boleh dibunuh:
    # ppid_cocok untuk anak LANGSUNG kita sendiri; penunggu_sah untuk penunggu
    # yang identitasnya sebagai bus-wait sudah terbukti walau BUKAN anak kita
    # (kasus penggantian yatim — tidak bisa dibuktikan PPID karena memang
    # bukan anak kita, tapi identitas bus-wait-nya sendiri sudah diverifikasi).
    guard_ppid = f'ppid_cocok "{var}"'
    guard_sah = f'penunggu_sah "{var}"'
    if guard_ppid not in window and guard_sah not in window:
        bad.append((i + 1, line.strip()))
if bad:
    for ln, txt in bad:
        print(f"TIDAK DIJAGA baris {ln}: {txt}", file=sys.stderr)
    sys.exit(1)
print(f"OK: {sum(1 for l in lines if re.search(r'kill \"\$[A-Za-z_!][A-Za-z_]*\" 2>/dev/null \|\| true', l))} titik kill, semua dijaga ppid_cocok")
PYEOF_STATIS
statis_msg=$?
[ "$statis_msg" = 0 ] || statis_detail="satu atau lebih titik kill tidak dijaga ppid_cocok — lihat stderr di atas"
check "gerbang statis: setiap titik kill di bus-arm dijaga ppid_cocok" "$statis_ok" "$statis_detail"

# --- 12u. jalur SUDAH ADA: exit bersih, trap tidak crash karena $! kosong -
# Reviewer membuktikan langsung: `/bin/sh -uc 'echo "$!"'` -> "$!: unbound
# variable", exit 127. bus-arm memakai `set -eu`, dan jalur SUDAH ADA (yang
# TERSERING dari seluruh skrip ini — setiap arm kedua dan seterusnya lewat
# sini) keluar SEBELUM shell itu pernah men-fork apa pun. Trap EXIT yang
# membaca `$!` di jalur ini akan menjatuhkan proses yang seharusnya keluar 0
# dengan bersih.
sudahada_ok=0; sudahada_detail=""
matikan_penunggu
"$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-sudahada1.out" 2>&1 &
sleep 2
"$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-sudahada2.out" 2>"$BUS_DIR/tmp/arm-sudahada2.err"
rc6=$?
[ "$rc6" = 0 ] || { sudahada_ok=1; sudahada_detail="rc=$rc6, seharusnya 0 pada jalur SUDAH ADA"; }
grep -qi 'unbound variable\|bad substitution' "$BUS_DIR/tmp/arm-sudahada2.err" 2>/dev/null && {
  sudahada_ok=1
  sudahada_detail="${sudahada_detail:-trap EXIT crash karena \$! belum pernah terisi di shell yang keluar lewat SUDAH ADA}"
}
grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-sudahada2.out" 2>/dev/null || {
  sudahada_ok=1; sudahada_detail="${sudahada_detail:-tidak melapor SUDAH ADA}"; }
check "jalur SUDAH ADA: exit 0 bersih, trap EXIT tidak crash karena '\$!' belum pernah terisi" "$sudahada_ok" "$sudahada_detail"
matikan_penunggu

# --- 12v. TERM sebelum fork PERTAMA di seluruh hidup shell ini -----------
# Jendela paling awal yang ada: bagian kritis (ambil_kunci, pemeriksaan
# pidfile) berjalan SEBELUM baris `&` sama sekali. Kunci ditahan dari LUAR
# supaya bus-arm blokir DI ambil_kunci-nya sendiri, sebelum ia sempat men-fork
# apa pun — `$!` di shell itu belum pernah terisi SAMA SEKALI sepanjang
# hidupnya. TERM dikirim TEPAT di jendela itu.
befork_ok=0; befork_detail=""
matikan_penunggu
lockfile3="$BUS_DIR/tmp/waiter-builder.lock"
rm -f "$lockfile3"
( exec 9>"$lockfile3"
  if command -v lockf >/dev/null 2>&1; then lockf 9; else flock -x 9; fi
  sleep 9
) &
pemegang=$!
sleep 1
"$BIN/bus-arm" builder 20 >"$BUS_DIR/tmp/arm-befork.out" 2>"$BUS_DIR/tmp/arm-befork.err" &
induk5=$!
sleep 1
kill -0 "$induk5" 2>/dev/null || { befork_ok=1; befork_detail="bus-arm sudah keluar sebelum sempat disinyali (kunci eksternal tidak menahannya)"; }

kill -TERM "$induk5" 2>/dev/null || true
tunggu=0
while [ "$tunggu" -lt 10 ] && kill -0 "$induk5" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
rc5=0
wait "$induk5" 2>/dev/null || rc5=$?
kill "$pemegang" 2>/dev/null || true
wait "$pemegang" 2>/dev/null || true
rm -f "$lockfile3"

[ "$rc5" = 143 ] || { befork_ok=1; befork_detail="${befork_detail:-rc=$rc5, seharusnya 143 (bukan crash nounset)}"; }
grep -qi 'unbound variable\|bad substitution' "$BUS_DIR/tmp/arm-befork.err" 2>/dev/null && {
  befork_ok=1
  befork_detail="${befork_detail:-trap crash karena \$! belum pernah terisi — TERM tiba sebelum satu pun fork terjadi}"
}
check "TERM sebelum fork pertama di seluruh hidup shell: trap tidak crash nounset" "$befork_ok" "$befork_detail"
matikan_penunggu

# --- 12w. FASE STARTING: anak pra-token dibersihkan lewat PPID-saja -------
# `WAITER=$!` sesudah `&` dan `PENUNGGU_STATE="STARTING:$WAITER"` adalah DUA
# pernyataan terpisah, dan token SIAP (yang membuktikan identitas sebagai
# bus-wait) belum tentu tiba secepat itu — jendela BUS_UJI_TUNDA_SIAP yang
# sudah dipakai kasus pra-siap melebarkan PERSIS jendela ini. Yang dibuktikan
# di sini: TERM yang tiba SEBELUM token tervalidasi tetap membersihkan anaknya,
# lewat jalur PPID-saja (tanpa syarat cocok baris perintah) — karena di fase
# ini baris perintah anak BELUM TENTU sudah berubah jadi bus-wait.
#
# BATAS KEJUJURAN: jendela pra-exec yang SEBENARNYA (antara fork() dan
# execve() selesai) berdurasi mikrodetik dan TIDAK BISA diinjeksi jeda dari
# skrip shell. Yang test ini benar-benar buktikan adalah jendela pra-TOKEN yang
# lebih luas dan NYATA terjadi di operasi normal (loop pemeriksaan token,
# hingga 10 detik). Desain PPID-saja untuk fase STARTING adalah jaminan
# STRUKTURAL (lihat kasus statis 12t), bukan sesuatu yang bisa dibuktikan lewat
# injeksi jeda pada sub-jendela mikrodetik itu.
starting_ok=0; starting_detail=""
matikan_penunggu
BUS_UJI_TUNDA_SIAP=6 "$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-starting.out" 2>&1 &
induk3=$!
sleep 1
[ ! -s "$waiter_pid_file" ] || { starting_ok=1; starting_detail="pidfile sudah terbit sebelum token — jendela STARTING tidak teruji"; }
# FILTER PERSIS, bukan "anak langsung PERTAMA": induk sendiri melahirkan
# anak langsung SAH lain lewat command substitution (mis. pemeriksaan token di
# atas ini) — `-f "$BIN/bus-wait"` menyaring hanya kandidat yang ARGV-nya benar
# memuat pola bus-wait, sama seperti gerbang FORKING.
anak3=$(pgrep -P "$induk3" -f "$BIN/bus-wait" 2>/dev/null | head -1)
[ -n "$anak3" ] || { starting_ok=1; starting_detail="${starting_detail:-tidak ditemukan anak bus-wait langsung dari induk}"; }
kill -0 "$anak3" 2>/dev/null || { starting_ok=1; starting_detail="${starting_detail:-anak tidak hidup sebelum sinyal dikirim}"; }

kill -TERM "$induk3" 2>/dev/null || true
rc3=0; wait "$induk3" 2>/dev/null || rc3=$?
# rc WAJIB 143. Tanpa ini, TERM yang diabaikan/tertunda dan induk yang
# kebetulan selesai normal lolos sebagai "berhasil dibersihkan" tanpa
# sinyalnya pernah benar-benar sampai.
[ "$rc3" = 143 ] || { starting_ok=1; starting_detail="${starting_detail:-induk keluar rc=$rc3, seharusnya 143}"; }

tunggu=0
while [ "$tunggu" -lt 10 ] && kill -0 "$anak3" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$anak3" 2>/dev/null && {
  starting_ok=1
  starting_detail="${starting_detail:-anak fase STARTING jadi YATIM sesudah induk mati — TERM pra-token tidak membersihkannya}"
  kill -9 "$anak3" 2>/dev/null || true
}
check "fase STARTING: anak pra-token dibersihkan lewat PPID-saja, tanpa syarat command" "$starting_ok" "$starting_detail"
matikan_penunggu

# --- 12x. jendela transisi pasca-wait/pra-REAPED benar-benar diuji --------
# BUS_UJI_TUNDA_TRANSISI ada di kode tapi tanpa test khusus adalah hook yang
# sama saja dengan tidak ada. Anak sengaja dibiarkan HABIS WAKTU dan DITUAI
# oleh jalur normal, lalu induk ditahan PERSIS di jendela antara `wait`
# kembali dan `PENUNGGU_STATE="REAPED:..."` berjalan — status yang tercatat
# SAAT itu masih "LIVE:<pid mati>". TERM dikirim TEPAT di sana. Yang
# diasersikan: penjaga identitas (ppid_cocok+penunggu_sah) di cabang LIVE
# menyelamatkan dari kill PID yang sudah mati, DAN pidfile tetap dilepas.
transisi_ok=0; transisi_detail=""
matikan_penunggu
log_transisi="$BUS_DIR/tmp/kill-log-transisi.txt"
rm -f "$log_transisi"
BUS_UJI_LOG_KILL="$log_transisi" BUS_UJI_TUNDA_TRANSISI=6 \
  "$BIN/bus-arm" builder 2 --sekali >"$BUS_DIR/tmp/arm-transisi.out" 2>&1 &
induk4=$!
tunggu_pidfile 10 || true
anak4=$(cat "$waiter_pid_file" 2>/dev/null || true)
[ -n "$anak4" ] || { transisi_ok=1; transisi_detail="penunggu tidak terpasang"; }

tunggu=0
while [ "$tunggu" -lt 12 ] && kill -0 "$anak4" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$anak4" 2>/dev/null && { transisi_ok=1; transisi_detail="${transisi_detail:-anak tidak habis waktu; induk mungkin belum di jendela transisi}"; }

kill -0 "$induk4" 2>/dev/null || { transisi_ok=1; transisi_detail="${transisi_detail:-induk sudah keluar sebelum sempat disinyali di jendela transisi}"; }
kill -TERM "$induk4" 2>/dev/null || true
rc4=0; wait "$induk4" 2>/dev/null || rc4=$?
[ "$rc4" = 143 ] || { transisi_ok=1; transisi_detail="${transisi_detail:-induk keluar rc=$rc4, seharusnya 143}"; }

if [ -f "$log_transisi" ] && grep -q "KILL $anak4\$" "$log_transisi" 2>/dev/null; then
  transisi_ok=1
  transisi_detail="${transisi_detail:-trap menyinyali PID $anak4 yang SUDAH mati — status masih 'LIVE' saat sinyal tiba tepat sebelum transisi REAPED}"
fi
[ ! -f "$waiter_pid_file" ] || { transisi_ok=1; transisi_detail="${transisi_detail:-pidfile tertinggal sesudah jendela transisi terpotong sinyal}"; }
rm -f "$log_transisi"
check "jendela pasca-wait/pra-REAPED: penjaga identitas menyelamatkan dari kill PID mati, pidfile tetap lepas" "$transisi_ok" "$transisi_detail"
matikan_penunggu

# --- 12s. jendela FORKING: TERM antara `&` dan penetapan PID -------------
# Jendela paling sempit di skrip ini: anak SUDAH di-fork, tapi PID-nya belum
# tercatat di mana pun. Cabang FORKING di bersihkan() dibangun khusus untuk itu,
# dan hook BUS_UJI_TUNDA_FORK sudah ada tanpa satu pun konsumen — hook tanpa
# konsumen adalah cakupan yang TAMPAK ada dan sebenarnya tidak ada.
#
# Kasus "TERM sebelum fork pertama" menguji jendela BERBEDA (belum ada anak
# sama sekali), jadi ia tidak menggantikan gerbang ini.
fork_ok=0; fork_detail=""
matikan_penunggu
BUS_UJI_TUNDA_FORK=6 "$BIN/bus-arm" builder 60 >"$BUS_DIR/tmp/arm-forking.out" 2>&1 &
induk_f=$!
tunggu=0; anak_f=""
while [ "$tunggu" -lt 10 ] && [ -z "$anak_f" ]; do
  anak_f=$(pgrep -P "$induk_f" -f "$BIN/bus-wait" 2>/dev/null | head -1)
  [ -n "$anak_f" ] || { sleep 1; tunggu=$((tunggu + 1)); }
done
[ -n "$anak_f" ] || { fork_ok=1; fork_detail="anak tidak pernah muncul di jendela FORKING"; }
[ ! -f "$waiter_pid_file" ] || { fork_ok=1; fork_detail="${fork_detail:-pidfile terbit padahal PID belum tercatat}"; }

kill -TERM "$induk_f" 2>/dev/null || true
rc_f=0; wait "$induk_f" 2>/dev/null || rc_f=$?
# rc WAJIB 143. Tanpa asersi ini, "anak hilang + tidak ada pidfile" juga benar
# kalau TERM diabaikan/tertunda dan induk kebetulan selesai normal — gerbang
# yang lulus tanpa sinyalnya pernah sampai tidak membuktikan apa pun.
[ "$rc_f" = 143 ] || { fork_ok=1; fork_detail="${fork_detail:-induk keluar $rc_f, seharusnya 143 (TERM tidak sampai di jendela FORKING)}"; }
tunggu=0
while [ "$tunggu" -lt 5 ] && kill -0 "$anak_f" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
! kill -0 "$anak_f" 2>/dev/null || { fork_ok=1; fork_detail="${fork_detail:-anak $anak_f YATIM: di-fork tapi belum tercatat, lalu ditinggalkan}"; }
[ ! -f "$waiter_pid_file" ] || { fork_ok=1; fork_detail="${fork_detail:-pidfile tertinggal}"; }
check "jendela FORKING: TERM antara fork dan penetapan PID -> rc143, anak tidak yatim" "$fork_ok" "$fork_detail"
matikan_penunggu

# --- 12y. DECOY ARGV: proses asing dengan argv yang MEMUAT pola tidak lolos
# Bukti konkret Reviewer: `python3 -c "..." "sleep 999" "$BUS_DIR/bin/bus-wait" "builder" "60"`
# lolos lewat pemeriksaan token-berdekatan sebelumnya karena pasangan
# path+role MEMANG ada berdampingan di argv itu, di posisi mana pun. Satu-
# satunya bentuk yang pernah ditelurkan bus-arm persis TIGA atau EMPAT token
# (dengan/tanpa interpreter ditampilkan `ps`); token tambahan apa pun ditolak.
decoy_ok=0; decoy_detail=""
matikan_penunggu
python3 -c "import time; time.sleep(60)" "sleep" "$BUS_DIR/bin/bus-wait" "builder" "60" &
decoy=$!
sleep 1
kill -0 "$decoy" 2>/dev/null || { decoy_ok=1; decoy_detail="proses decoy tidak hidup"; }
echo "$decoy" > "$waiter_pid_file"
out_decoy=$(arm_terbatas 8 builder 20 || true)
case "$out_decoy" in
  *"SUDAH ADA"*) decoy_ok=1; decoy_detail="${decoy_detail:-bus-arm menerima decoy sebagai penunggu sah: $out_decoy}" ;;
esac
kill -0 "$decoy" 2>/dev/null || { decoy_ok=1; decoy_detail="${decoy_detail:-proses decoy ikut terbunuh — pidfile basi tidak boleh bisa membunuh proses asing}"; }
kill "$decoy" 2>/dev/null; wait "$decoy" 2>/dev/null || true
check "decoy argv (path+role berdampingan di baris perintah asing) TIDAK lolos sebagai penunggu sah" "$decoy_ok" "$decoy_detail"
matikan_penunggu
rm -f "$waiter_pid_file"

# --- 12z. TIMEOUT=0 mode PERSISTEN ditolak, TANPA busy-loop ---------------
# Bukti Reviewer: probe menghasilkan 1 ARMED + 7 ARMED-ULANG dalam SATU detik.
timeout0_ok=0; timeout0_detail=""
matikan_penunggu
# BATAS WAKTU KERAS: kalau penjaga TIMEOUT=0 pernah dicabut lagi, panggilan
# LANGSUNG di sini akan busy-loop SELAMANYA di dalam command substitution —
# menggantung suite, bukan gagal merah yang terbatas.
out_t0=$(arm_terbatas 8 builder 0); rc_t0=$?
[ "$rc_t0" = 2 ] || { timeout0_ok=1; timeout0_detail="rc=$rc_t0, seharusnya 2 (ditolak)"; }
case "$out_t0" in *ARMED*) timeout0_ok=1; timeout0_detail="${timeout0_detail:-bus-arm sempat memasang penunggu walau timeout=0 di mode persisten}" ;; esac
[ "$(cacah_penunggu)" = 0 ] || { timeout0_ok=1; timeout0_detail="${timeout0_detail:-penunggu tersisa sesudah penolakan}"; }
# --sekali TETAP boleh memakai 0 — itu satu pemeriksaan instan yang sah, bukan
# mode persisten yang berulang tanpa jeda.
out_t0_sekali=$(arm_terbatas 8 builder 0 --sekali); rc_t0_sekali=$?
[ "$rc_t0_sekali" = 4 ] || { timeout0_ok=1; timeout0_detail="${timeout0_detail:-'--sekali' dengan timeout=0 ditolak juga (rc=$rc_t0_sekali), seharusnya diperbolehkan (rc=4, habis waktu instan)}"; }
check "TIMEOUT=0 mode persisten DITOLAK (rc=2, nol busy-loop); --sekali tetap boleh" "$timeout0_ok" "$timeout0_detail"
matikan_penunggu

# --- 12aa. SYMLINK vs path asli: tetap TEPAT SATU penunggu ---------------
# Bukti Reviewan: repo yang sama dibuka lewat symlink DAN path asli
# menghasilkan DUA waiter ARMED — BUS_DIR yang dihitung berbeda secara
# TEKSTUAL (symlink vs fisik) padahal menunjuk berkas fisik yang identik.
symlink_ok=0; symlink_detail=""
matikan_penunggu
symlink_dir="$BUS_DIR/tmp/alias-$$"
rm -f "$symlink_dir"
ln -s "$REPO_ROOT" "$symlink_dir" 2>/dev/null || { symlink_ok=1; symlink_detail="tidak bisa membuat symlink uji"; }
if [ -z "$symlink_detail" ]; then
  "$symlink_dir/.agent-bus/bin/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-symlink1.out" 2>&1 &
  sleep 2
  # BATAS WAKTU KERAS: kalau pengkanonan BUS_DIR pernah dicabut lagi, arm
  # kedua ini akan menelurkan penunggu KEDUA dan bertahan sebagai supervisor
  # persisten — menggantung suite, bukan gagal merah yang terbatas.
  arm_terbatas 15 builder 30 >"$BUS_DIR/tmp/arm-symlink2.out" 2>&1
  rc_sym=$?
  [ "$rc_sym" = 0 ] || { symlink_ok=1; symlink_detail="arm kedua (path asli) rc=$rc_sym, seharusnya 0"; }
  grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-symlink2.out" 2>/dev/null || {
    symlink_ok=1; symlink_detail="${symlink_detail:-arm kedua tidak melapor SUDAH ADA: $(cat "$BUS_DIR/tmp/arm-symlink2.out" 2>/dev/null)}"; }
  [ "$(cacah_penunggu)" = 1 ] || { symlink_ok=1; symlink_detail="${symlink_detail:-penunggu=$(cacah_penunggu), seharusnya 1 (symlink+path asli menghasilkan dua)}"; }
fi
rm -f "$symlink_dir"
check "repo dibuka lewat symlink DAN path asli: tetap TEPAT SATU penunggu (BUS_DIR dikanonikkan)" "$symlink_ok" "$symlink_detail"
matikan_penunggu

# --- 12ab. LIVE: kegagalan mengunci TIDAK menyinyali (gagal tertutup) -----
# PPID membuktikan KEPEMILIKAN, bukan SERIALISASI (temuan Reviewer). Kalau
# `ambil_kunci` gagal di jalur pembersihan LIVE, kill HARUS batal.
#
# `lockf`/`flock` BLOKIR saat kontensi biasa (dibuktikan langsung: `timeout 3
# lockf` pada kunci yang dipegang proses lain -> exit 124, tidak pernah
# gagal-cepat), jadi kegagalan `ambil_kunci` yang nyata hanya bisa dipicu lewat
# kegagalan `exec 9>` ITU SENDIRI. Dipicu DETERMINISTIK: lockfile dibuat lalu
# izinnya dicabut (chmod 000) SEBELUM anak diberi TERM — dibuktikan langsung
# `chmod 000 file; exec 9>file` -> Permission denied, exit 1.
ambilgagal_ok=0; ambilgagal_detail=""
matikan_penunggu
log_ambilgagal="$BUS_DIR/tmp/kill-log-ambilgagal.txt"
rm -f "$log_ambilgagal"
BUS_UJI_LOG_KILL="$log_ambilgagal" "$BIN/bus-arm" builder 40 >"$BUS_DIR/tmp/arm-ambilgagal1.out" 2>&1 &
induk6=$!
tunggu_pidfile 10 || true
anak6=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$anak6" || { ambilgagal_ok=1; ambilgagal_detail="penunggu tidak terpasang"; }

lockfile6="$BUS_DIR/tmp/waiter-builder.lock"
[ -e "$lockfile6" ] || : > "$lockfile6"
chmod 000 "$lockfile6" 2>/dev/null || { ambilgagal_ok=1; ambilgagal_detail="${ambilgagal_detail:-tidak bisa mencabut izin lockfile}"; }

kill -TERM "$induk6" 2>/dev/null || true
# BATAS WAKTU KERAS pada `wait`: kalau gagal-tertutup di sini pernah rusak
# jadi menggantung (mis. deadlock kunci internal), `wait` polos akan
# menahan seluruh suite tanpa batas. Poll dengan langit-langit eksplisit,
# paksa-bunuh kalau terlampaui, dan itu sendiri jadi kegagalan MERAH — bukan
# suite yang macet tanpa penjelasan.
rc6=0
tunggu6=0
while [ "$tunggu6" -lt 15 ] && kill -0 "$induk6" 2>/dev/null; do sleep 1; tunggu6=$((tunggu6 + 1)); done
if kill -0 "$induk6" 2>/dev/null; then
  ambilgagal_ok=1
  ambilgagal_detail="${ambilgagal_detail:-induk tidak keluar dalam ${tunggu6}s sesudah TERM saat kunci gagal — kemungkinan menggantung}"
  kill -9 "$induk6" 2>/dev/null || true
  wait "$induk6" 2>/dev/null || true
else
  wait "$induk6" 2>/dev/null || rc6=$?
fi
chmod 644 "$lockfile6" 2>/dev/null || true

# rc TIDAK diasersikan 143 di sini dengan sengaja: `ambil_kunci` yang gagal
# `return 1` di dalam bersihkan(), dan trap TERM meneruskan `exit 143`
# terlepas dari nilai balik bersihkan() — jadi rc semestinya tetap 143. Kalau
# BUKAN 143, itu justru sinyal cacat lain (trap error keluar dengan kode aneh).
[ "$rc6" = 143 ] || { ambilgagal_ok=1; ambilgagal_detail="${ambilgagal_detail:-induk keluar rc=$rc6, seharusnya tetap 143 walau kunci gagal didapat}"; }

# ASERSI UTAMA: TIDAK ADA percobaan kill sama sekali untuk anak ini — kunci
# gagal didapat, jadi jalur "gagal tertutup, tanpa sinyal" WAJIB dipakai.
if [ -f "$log_ambilgagal" ] && grep -q "KILL $anak6\$" "$log_ambilgagal" 2>/dev/null; then
  ambilgagal_ok=1
  ambilgagal_detail="${ambilgagal_detail:-trap tetap menyinyali $anak6 walau ambil_kunci gagal — PPID dipakai sebagai bukti serialisasi, padahal ia hanya bukti kepemilikan}"
fi
rm -f "$log_ambilgagal" "$lockfile6"
check "LIVE: ambil_kunci gagal -> TIDAK menyinyali sama sekali (gagal tertutup, bukan PPID-saja)" "$ambilgagal_ok" "$ambilgagal_detail"
matikan_penunggu

# --- 12ac. YATIM (SIGKILL induk) diganti, bukan diadopsi sebagai "sehat" --
# SIGKILL tidak bisa ditangkap trap apa pun. Bus-wait anaknya terus hidup,
# direparent kernel ke PID 1, dan pidfile masih menunjuknya — arm berikutnya
# yang HANYA memeriksa `penunggu_sah` akan melapor SUDAH ADA dan keluar,
# meninggalkan Builder tuli PERMANEN begitu penunggu yatim itu akhirnya keluar
# (tidak ada loop bus-arm yang mengawasinya untuk memasang penggantinya).
#
# Siklus penuh yang dibuktikan: SIGKILL induk -> arm berikutnya MENGGANTI
# yatim -> penunggu baru benar-benar disupervisi (anak LANGSUNG arm baru) ->
# pesan tetap membangunkannya -> siklus arm-ulang berikutnya tetap berfungsi.
yatim_ok=0; yatim_detail=""
matikan_penunggu
"$BIN/bus-arm" builder 40 >"$BUS_DIR/tmp/arm-yatim1.out" 2>&1 &
induk7=$!
tunggu_pidfile 10 || true
anak7=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$anak7" || { yatim_ok=1; yatim_detail="penunggu pertama tidak terpasang"; }

# SIGKILL: tidak bisa ditangkap, mensimulasikan induk yang benar-benar mati
# tanpa sempat membersihkan apa pun.
kill -9 "$induk7" 2>/dev/null || true
wait "$induk7" 2>/dev/null || true

tunggu=0
while [ "$tunggu" -lt 5 ] && [ "$(ps -o ppid= -p "$anak7" 2>/dev/null | tr -d ' ')" != 1 ]; do
  sleep 1; tunggu=$((tunggu + 1))
done
[ "$(ps -o ppid= -p "$anak7" 2>/dev/null | tr -d ' ')" = 1 ] || {
  yatim_ok=1; yatim_detail="${yatim_detail:-anak tidak direparent ke PID 1 dalam ${tunggu}s; prasyarat pengujian tidak terpenuhi}"
}
kill -0 "$anak7" 2>/dev/null || { yatim_ok=1; yatim_detail="${yatim_detail:-anak yatim sudah mati sebelum sempat diuji}"; }

# Arm KEDUA: harus MENGGANTI yatim itu, bukan melapor SUDAH ADA lalu diam.
arm_terbatas 15 builder 40 >"$BUS_DIR/tmp/arm-yatim2.out" 2>&1 &
induk7b=$!
tunggu=0
while [ "$tunggu" -lt 15 ] && kill -0 "$anak7" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$anak7" 2>/dev/null && { yatim_ok=1; yatim_detail="${yatim_detail:-yatim TIDAK diganti — masih hidup ${tunggu}s sesudah arm kedua}"; }
grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-yatim2.out" 2>/dev/null && {
  yatim_ok=1
  yatim_detail="${yatim_detail:-arm kedua melapor SUDAH ADA atas yatim tanpa supervisor — Builder akan tuli permanen begitu yatim itu keluar}"
}

anak7b=""
tunggu=0
while [ "$tunggu" -lt 15 ] && [ -z "$anak7b" ]; do
  anak7b=$(cat "$waiter_pid_file" 2>/dev/null || true)
  waiter_hidup "$anak7b" || anak7b=""
  [ -n "$anak7b" ] || { sleep 1; tunggu=$((tunggu + 1)); }
done
[ -n "$anak7b" ] || { yatim_ok=1; yatim_detail="${yatim_detail:-penunggu pengganti tidak pernah terpasang}"; }
[ "$anak7b" != "$anak7" ] || { yatim_ok=1; yatim_detail="${yatim_detail:-PID pengganti sama dengan yatim lama — bukan penggantian sungguhan}"; }
# CATATAN: `$induk7b` adalah PID pembungkus `arm_terbatas` (timeout/gtimeout),
# BUKAN bus-arm sesungguhnya — bus-arm sebenarnya jadi ANAK dari pembungkus
# itu. Bukti supervisi yang benar dibaca dari SUPERVISOR_FILE (klaim
# pid+nonce), bukan dari asumsi PPID langsung, dan itu justru sumber
# kebenaran yang SAMA yang dipakai kode produksinya sendiri.
supervisor_file="$BUS_DIR/tmp/supervisor-builder.pid"
_klaim=$(cat "$supervisor_file" 2>/dev/null || true)
_spid_baru=${_klaim%%:*}
case "$_spid_baru" in ''|*[!0-9]*) yatim_ok=1; yatim_detail="${yatim_detail:-klaim supervisor tidak terbaca atau rusak: '$_klaim'}" ;; esac
kill -0 "$_spid_baru" 2>/dev/null || { yatim_ok=1; yatim_detail="${yatim_detail:-PID di klaim supervisor ($_spid_baru) tidak hidup}"; }
_ppid_baru=$(ps -o ppid= -p "$anak7b" 2>/dev/null | tr -d ' ')
[ "$_ppid_baru" = "$_spid_baru" ] || {
  yatim_ok=1
  yatim_detail="${yatim_detail:-penunggu pengganti PPID=$_ppid_baru, seharusnya $_spid_baru (pid dari klaim supervisor, anak langsung darinya)}"
}

# Siklus BERIKUTNYA masih berfungsi: pesan membangunkan, arm-ulang berhasil.
"$BIN/bus-send" builder QUESTION "$HEAD_SHA" "$TASK" "sesudah penggantian yatim" >/dev/null 2>&1
tunggu=0
while [ "$tunggu" -lt 15 ] && kill -0 "$anak7b" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$anak7b" 2>/dev/null && { yatim_ok=1; yatim_detail="${yatim_detail:-penunggu pengganti tidak bangun oleh pesan}"; }
"$BIN/bus-read" builder >/dev/null 2>&1 || { yatim_ok=1; yatim_detail="${yatim_detail:-bus-read gagal sesudah penggantian yatim}"; }
"$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-yatim3.out" 2>&1 &
tunggu_pidfile 10 || true
[ "$(cacah_penunggu)" = 1 ] || { yatim_ok=1; yatim_detail="${yatim_detail:-arm-ulang sesudah penggantian yatim gagal: penunggu=$(cacah_penunggu)}"; }

check "SIGKILL induk: penunggu yatim (PPID=1) DIGANTI dengan supervisor baru, siklus berikutnya tetap hidup" "$yatim_ok" "$yatim_detail"
matikan_penunggu

# --- 12ad. DECOY: bus-wait standalone dengan induk HIDUP tetap DIGANTI ----
# Reproduksi persis Reviewer: `bus-wait builder 30` dijalankan langsung dari
# shell yang MASIH HIDUP (bukan lewat bus-arm sama sekali), pidfile diarahkan
# ke situ. PPID-nya BUKAN 1 (shell pemanggil masih hidup) — kalau buktinya
# masih PPID, bus-arm akan salah menyimpulkan "ada supervisor". Bukti yang
# BENAR (supervisor_hidup) menuntut KLAIM pid+nonce yang tervalidasi, dan
# standalone ini TIDAK PERNAH menulis klaim itu — jadi WAJIB tetap diganti.
decoy_live_ok=0; decoy_live_detail=""
matikan_penunggu
rm -f "$BUS_DIR/tmp/supervisor-builder.pid"
"$BIN/bus-wait" builder 40 >/dev/null 2>&1 &
standalone_parent=$!
sleep 1
standalone_wait=$(pgrep -P "$standalone_parent" -f "$BIN/bus-wait" 2>/dev/null | head -1)
[ -z "$standalone_wait" ] && standalone_wait=$standalone_parent
kill -0 "$standalone_wait" 2>/dev/null || { decoy_live_ok=1; decoy_live_detail="bus-wait standalone tidak hidup"; }
echo "$standalone_wait" > "$waiter_pid_file"
_ppid_standalone=$(ps -o ppid= -p "$standalone_wait" 2>/dev/null | tr -d ' ')
[ "$_ppid_standalone" != 1 ] || { decoy_live_ok=1; decoy_live_detail="${decoy_live_detail:-prasyarat gagal: PPID standalone kebetulan 1}"; }

# LATAR, BUKAN foreground `arm_terbatas`: bus-arm yang menang penggantian ini
# menunggu waiter-nya sendiri SAMPAI 30 detik (argumen timeout-nya) — kalau
# dibungkus `timeout 15` di FOREGROUND, timeout membunuh bus-arm itu SENDIRI
# di detik ke-15 SEMENTARA ia masih sah menunggu, trap TERM-nya BENAR
# membersihkan waiter yang BARU SAJA ia telurkan (persis yang seharusnya
# terjadi kalau supervisor sungguhan diminta berhenti) — dan test yang salah
# menyalahartikan perilaku BENAR itu sebagai "penggantian gagal".
"$BIN/bus-arm" builder 30 >"$BUS_DIR/tmp/arm-decoylive.out" 2>&1 &
supervisor_baru=$!
tunggu_pidfile 12 || true
grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-decoylive.out" 2>/dev/null && {
  decoy_live_ok=1
  decoy_live_detail="${decoy_live_detail:-bus-arm menerima standalone berinduk-hidup sebagai SUDAH ADA — PPID bukan-1 disalahartikan sebagai supervisor}"
}
tunggu=0
while [ "$tunggu" -lt 10 ] && kill -0 "$standalone_wait" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$standalone_wait" 2>/dev/null && { decoy_live_ok=1; decoy_live_detail="${decoy_live_detail:-standalone TIDAK diganti}"; }
[ "$(cacah_penunggu)" = 1 ] || { decoy_live_ok=1; decoy_live_detail="${decoy_live_detail:-penunggu=$(cacah_penunggu) sesudah penggantian}"; }
check "bus-wait standalone berinduk HIDUP (bukan bus-arm) tetap DIGANTI, bukan diterima sebagai SUDAH ADA" "$decoy_live_ok" "$decoy_live_detail"
kill "$standalone_parent" 2>/dev/null; wait "$standalone_parent" 2>/dev/null || true
kill "$supervisor_baru" 2>/dev/null; wait "$supervisor_baru" 2>/dev/null || true
matikan_penunggu

# --- 12ae. OWNER MATI-TAK-DIREAP (zombie): waiter tetap DIGANTI --------
# Reproduksi Reviewer: owner disupervisor di-SIGKILL lalu SENGAJA tidak
# di-`wait` oleh pemanggilnya (bisa tertinggal sebagai zombie di beberapa
# jalur OS). Yang dibuktikan: keputusan replace TIDAK bergantung pada status
# reap owner sama sekali — ia bergantung pada PPID WAITER SEBENARNYA, yang
# direparent kernel ke PID 1 SAAT KEMATIAN owner terjadi, terlepas dari kapan
# (atau apakah) owner-nya sendiri pernah di-reap oleh pemanggilnya.
zombie_ok=0; zombie_detail=""
matikan_penunggu
# Skrip pembungkus ditulis ke berkas terpisah, BUKAN `sh -c` inline: kutipan
# bersarang untuk meneruskan $BIN dan path pidfile lewat parameter posisi ke
# `sh -c` ternyata rapuh di bawah `set -u` (unbound variable) — menulis skrip
# nyata lebih jelas dan tidak butuh kutipan berlapis.
pembungkus_sh="$BUS_DIR/tmp/zombie-pembungkus.sh"
cat > "$pembungkus_sh" <<PEMBUNGKUS_EOF
#!/bin/sh
"$BIN/bus-arm" builder 40 >/dev/null 2>&1 &
echo \$! > "$BUS_DIR/tmp/zombie-owner.pid"
sleep 20
PEMBUNGKUS_EOF
sh "$pembungkus_sh" &
pembungkus=$!
tunggu=0
while [ "$tunggu" -lt 10 ] && [ ! -s "$BUS_DIR/tmp/zombie-owner.pid" ]; do sleep 1; tunggu=$((tunggu + 1)); done
owner=$(cat "$BUS_DIR/tmp/zombie-owner.pid" 2>/dev/null || true)
[ -n "$owner" ] || { zombie_ok=1; zombie_detail="owner tidak pernah tercatat"; }
tunggu_pidfile 10 || true
waiter_zombie=$(cat "$waiter_pid_file" 2>/dev/null || true)
waiter_hidup "$waiter_zombie" || { zombie_ok=1; zombie_detail="${zombie_detail:-waiter belum terpasang sebelum owner dibunuh}"; }

kill -9 "$owner" 2>/dev/null || true
# SENGAJA TIDAK `wait "$pembungkus"` di sini — pembungkus masih `sleep 20`,
# jadi owner yang baru dibunuh berpotensi tertinggal SEBAGAI ZOMBIE selama
# jendela itu, PERSIS skenario yang direproduksi Reviewer.
tunggu=0
while [ "$tunggu" -lt 10 ] && [ "$(ps -o ppid= -p "$waiter_zombie" 2>/dev/null | tr -d ' ')" != 1 ]; do
  sleep 1; tunggu=$((tunggu + 1))
done
[ "$(ps -o ppid= -p "$waiter_zombie" 2>/dev/null | tr -d ' ')" = 1 ] || {
  zombie_ok=1; zombie_detail="${zombie_detail:-waiter tidak direparent ke PID 1 dalam ${tunggu}s}"
}

# LATAR, bukan `arm_terbatas` foreground: supervisor pengganti yang MENANG
# menunggu waiter barunya sendiri sampai 40 detik (argumen timeout-nya) — kalau
# dibungkus `timeout` di FOREGROUND yang lebih pendek, timeout membunuh
# supervisor itu SENDIRI di tengah menunggu, dan trap TERM-nya BENAR
# membersihkan waiter yang baru saja ia telurkan (persis kasus decoy_live yang
# sama sebelumnya).
"$BIN/bus-arm" builder 40 >"$BUS_DIR/tmp/arm-zombie.out" 2>&1 &
pengganti=$!
tunggu_pidfile 12 || true
grep -q 'SUDAH ADA' "$BUS_DIR/tmp/arm-zombie.out" 2>/dev/null && {
  zombie_ok=1
  zombie_detail="${zombie_detail:-bus-arm menerima waiter dengan owner mati-tak-direap sebagai SUDAH ADA}"
}
tunggu=0
while [ "$tunggu" -lt 10 ] && kill -0 "$waiter_zombie" 2>/dev/null; do sleep 1; tunggu=$((tunggu + 1)); done
kill -0 "$waiter_zombie" 2>/dev/null && { zombie_ok=1; zombie_detail="${zombie_detail:-waiter lama TIDAK diganti}"; }
[ "$(cacah_penunggu)" = 1 ] || { zombie_ok=1; zombie_detail="${zombie_detail:-penunggu=$(cacah_penunggu) sesudah penggantian}"; }
check "owner mati-tak-direap (berpotensi zombie): waiter tetap DIGANTI lewat hubungan PPID, bukan status reap owner" "$zombie_ok" "$zombie_detail"
kill -9 "$owner" "$pembungkus" "$pengganti" 2>/dev/null; wait "$pembungkus" 2>/dev/null; wait "$pengganti" 2>/dev/null || true
rm -f "$BUS_DIR/tmp/zombie-owner.pid" "$pembungkus_sh"
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
