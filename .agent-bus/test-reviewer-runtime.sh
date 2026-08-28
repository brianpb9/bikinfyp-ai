#!/bin/sh
# Fault-injection test for poison handling, hard-crash recovery, bounded
# failures, exact response ordering, and immediate re-arm. The public
# entrypoint re-runs in a disposable clone and never targets the live bus.
set -u

BUS_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT=$(dirname "$BUS_DIR")
if ! "$BUS_DIR/bin/run-bus-test-isolated" --verify "$REPO_ROOT"; then
  "$BUS_DIR/bin/run-bus-test-isolated" .agent-bus/test-reviewer-runtime.sh "$@"
  exit $?
fi
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
TEST_OWNER="worker-$(printf '%s' "$REPO_ROOT" | git hash-object --stdin | cut -c1-16)"
export AGENT_BUS_OWNER_ID="$TEST_OWNER"
FAKE_SHA=deadbeefdeadbeefdeadbeefdeadbeefdeadbeef
ACTIVE_PID=''
BOUNDED_PID=''
FAILURES=0

inbox_count() {
  count=0
  for file in "$BUS_DIR/inbox/$1"/*.json; do
    [ -e "$file" ] || break
    count=$((count + 1))
  done
  printf '%s\n' "$count"
}

read_builder() { # read_builder <task>
  "$READ" builder --task "$1" --owner "$TEST_OWNER"
}

routing_matches() { # routing_matches <request-file> <read-output>
  _request=$1
  [ -f "$_request" ] || _request="$BUS_DIR/archive/$(basename "$_request")"
  node - "$_request" "$2" <<'NODE'
const fs = require("fs");
const request = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const response = JSON.parse(process.argv[3].split(/\r?\n/, 1)[0]);
const fields = ["task_id", "owner_id", "worker_id", "origin_branch", "origin_worktree", "origin_repo_id", "origin_repo_path"];
if (!fields.every((field) => response[field] === request[field])) process.exit(1);
if (response.reply_to_id !== request.id) process.exit(1);
NODE
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

# Membunuh SATU PROSES saja tidak cukup, dan itu ketahuan dari jalan nyata:
# runtime yang berhasil arm menelurkan bus-wait, dan membunuh induknya saja
# meninggalkan bus-wait hidup memegang fd log — jalan test pada dd5c68a
# akhirnya MENGGANTUNG, bukan melaporkan gagal. Test regresi yang menggantung
# tidak melaporkan apa pun.
bunuh_pohon() {
  akar_pid=$1
  anak_pids=$(ps -eo pid=,ppid= 2>/dev/null | awk -v r="$akar_pid" '$2 == r { print $1 }')
  for anak_pid in $anak_pids; do bunuh_pohon "$anak_pid"; done
  kill -9 "$akar_pid" 2>/dev/null || true
}

jalankan_terbatas() {
  # $1 = berkas penampung rc, $2.. = perintah
  batas_keluaran=$1
  shift
  "$@" >> "$BUS_DIR/tmp/codex-reviewer-selftest.log" 2>&1 &
  batas_pid=$!
  # Dicatat sebagai STATE PEMBERSIHAN, bukan variabel lokal. Kalau suite
  # menerima INT/TERM atau keluar selagi invocation ini masih hidup, proses itu
  # beserta bus-wait turunannya akan tertinggal di mesin — persis risiko yang
  # case 6 ada untuk menutupnya. (Temuan Reviewer 21 Agu.)
  BOUNDED_PID=$batas_pid
  batas_i=0
  while [ "$batas_i" -lt 60 ] && kill -0 "$batas_pid" 2>/dev/null; do
    sleep 0.1
    batas_i=$((batas_i + 1))
  done
  if kill -0 "$batas_pid" 2>/dev/null; then
    # Masih hidup sesudah batas waktu = runtime kedua BERHASIL arm. Itu
    # kegagalannya, dan dicatat sebagai ARMED.
    bunuh_pohon "$batas_pid"
    wait "$batas_pid" 2>/dev/null || true
    printf 'ARMED\n' > "$batas_keluaran"
  else
    wait "$batas_pid" 2>/dev/null
    printf '%s\n' "$?" > "$batas_keluaran"
  fi
  BOUNDED_PID=''
}

stop_bounded() {
  [ -n "$BOUNDED_PID" ] || return 0
  # Supervisor dicabut DULU: kalau `start` yang regresi sempat men-submit job
  # launchd, membunuh prosesnya lebih dulu hanya membuat launchd
  # menghidupkannya kembali.
  remove_clone_supervisor
  bunuh_pohon "$BOUNDED_PID"
  wait "$BOUNDED_PID" 2>/dev/null || true
  BOUNDED_PID=''
}

stop_active() {
  if [ -n "$ACTIVE_PID" ] && kill -0 "$ACTIVE_PID" 2>/dev/null; then
    kill "$ACTIVE_PID" 2>/dev/null || true
    wait "$ACTIVE_PID" 2>/dev/null || true
  fi
  ACTIVE_PID=''
}

# Label launchd milik clone ini, dihitung sama persis dengan runtime.
# Dipakai pembersihan: kalau penjaga bersarang regresi, `start` benar-benar
# men-submit job launchd untuk clone sekali pakai ini, dan launchd akan terus
# MENGHIDUPKANNYA KEMBALI setiap kali prosesnya dibunuh. Terbukti dua kali saat
# menulis case 6: job com.bikinfyp.codex-reviewer.<id-clone> tertinggal hidup
# di mesin pengembang sesudah clone-nya sendiri dihapus.
clone_launch_label() {
  clone_repo_id=$(printf '%s' "$REPO_ROOT" | git hash-object --stdin 2>/dev/null | cut -c1-12)
  [ -n "$clone_repo_id" ] || return 1
  printf 'com.bikinfyp.codex-reviewer.%s\n' "$clone_repo_id"
}

remove_clone_supervisor() {
  command -v launchctl >/dev/null 2>&1 || return 0
  clone_label=$(clone_launch_label) || return 0
  launchctl remove "$clone_label" >/dev/null 2>&1 || true
}

CLEANED=0
cleanup() {
  [ "$CLEANED" = 0 ] || return 0
  CLEANED=1
  stop_bounded
  stop_active
  remove_clone_supervisor
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
# TRAP EXIT DIPISAH DARI TRAP SINYAL, dan handler sinyal KELUAR.
#
# Temuan Reviewer 21 Agu, dan ia benar: `trap cleanup EXIT INT TERM HUP` tidak
# menghentikan skrip sesudah menangani INT/TERM/HUP — shell melanjutkan ke
# perintah berikutnya. Kalau sinyal tiba saat `jalankan_terbatas` sedang hidup,
# cleanup membunuh prosesnya lalu suite MELANJUTKAN dan menelurkan invocation
# nested berikutnya beserta supervisornya — proses baru SESUDAH pembersihan.
# Pembersihan yang diikuti kelanjutan bukan pembersihan.
#
# Statusnya 128+signo, jadi pemanggil bisa membedakan dibunuh dari gagal.
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM
trap 'cleanup; exit 129' HUP

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

# MODE PROBE SINYAL — dipakai case 0 di bawah, dan HANYA oleh case itu.
#
# Menguji handler sinyal yang SUNGGUHAN membutuhkan proses yang benar-benar
# menerima sinyal saat sebuah invocation bounded masih hidup. Karena itu suite
# ini menjalankan SATU salinan dirinya sendiri dalam mode ini, lalu mengirimnya
# TERM dari luar.
#
# Penandanya tiga berkas, dan yang ketiga adalah inti pengujiannya:
#   probe-ready      : bounded invocation sudah hidup, silakan kirim sinyal
#   probe-bounded.pid: PID yang wajib ikut mati
#   probe-continued  : HANYA tertulis kalau trap membersihkan LALU MELANJUTKAN.
#                      Kehadirannya = cacat yang dilaporkan Reviewer.
if [ "${AGENT_BUS_SELFTEST_SIGNAL_PROBE:-}" = "1" ]; then
  start_runtime 5
  wait_for "probe: runtime armed" '[ -s "$PID_FILE" ]' 100 || exit 9
  # Berdiri sendiri dan berumur panjang, persis seperti bus-wait turunan
  # invocation nested yang berisiko tertinggal.
  "$BUS_DIR/bin/bus-wait" reviewer 3600 >/dev/null 2>&1 &
  BOUNDED_PID=$!
  printf '%s\n' "$BOUNDED_PID" > "$BUS_DIR/tmp/probe-bounded.pid"
  : > "$BUS_DIR/tmp/probe-ready"
  # Menunggu dalam potongan satu detik, BUKAN `sleep 300` tunggal.
  # /bin/sh macOS adalah bash mode POSIX, dan bash menunda handler sinyal
  # sampai perintah foreground yang sedang berjalan selesai. `kill -TERM`
  # hanya mengenai shell-nya, bukan `sleep`-nya, jadi dengan satu sleep panjang
  # trap baru jalan 300 detik kemudian — dan test-nya salah menuduh cacat yang
  # tidak ada. Ditemukan saat menulis case ini.
  probe_tunggu=0
  while [ "$probe_tunggu" -lt 300 ]; do
    sleep 1
    probe_tunggu=$((probe_tunggu + 1))
  done
  : > "$BUS_DIR/tmp/probe-continued"
  exit 0
fi

printf 'reviewer runtime self-test\n'

# Case 0: sinyal saat invocation bounded hidup -> bersih DAN BERHENTI.
rm -f "$BUS_DIR/tmp/probe-ready" "$BUS_DIR/tmp/probe-continued" "$BUS_DIR/tmp/probe-bounded.pid"
AGENT_BUS_SELFTEST_SIGNAL_PROBE=1 /bin/sh "$SELF" >> "$BUS_DIR/tmp/codex-reviewer-selftest.log" 2>&1 &
probe_pid=$!
if wait_for "probe siap menerima sinyal" '[ -e "$BUS_DIR/tmp/probe-ready" ]' 300; then
  probe_bounded=$(cat "$BUS_DIR/tmp/probe-bounded.pid" 2>/dev/null || echo "")
  probe_runtime=$(cat "$PID_FILE" 2>/dev/null || echo "")
  kill -TERM "$probe_pid" 2>/dev/null || true
  probe_i=0
  while [ "$probe_i" -lt 100 ] && kill -0 "$probe_pid" 2>/dev/null; do sleep 0.1; probe_i=$((probe_i + 1)); done
  probe_rc=0
  if kill -0 "$probe_pid" 2>/dev/null; then
    probe_rc=HIDUP
    bunuh_pohon "$probe_pid"
  else
    wait "$probe_pid" 2>/dev/null
    probe_rc=$?
  fi
  sleep 0.5
  probe_lanjut=no; [ -e "$BUS_DIR/tmp/probe-continued" ] && probe_lanjut=yes
  probe_bounded_hidup=no
  [ -n "$probe_bounded" ] && kill -0 "$probe_bounded" 2>/dev/null && probe_bounded_hidup=yes
  probe_runtime_hidup=no
  [ -n "$probe_runtime" ] && kill -0 "$probe_runtime" 2>/dev/null && probe_runtime_hidup=yes

  # Menuntut 143 PERSIS, bukan sekadar "bukan HIDUP" (temuan Reviewer 21 Agu).
  # Kontraknya menyebut handler sinyal keluar 128+signo; asersi yang menerima
  # status apa pun akan meluluskan mutasi `trap 'cleanup; exit 0' TERM`, yang
  # menyamarkan interupsi sebagai kesuksesan. Status itulah satu-satunya cara
  # pemanggil membedakan "dibunuh" dari "selesai".
  if [ "$probe_lanjut" = no ] && [ "$probe_bounded_hidup" = no ] && \
     [ "$probe_runtime_hidup" = no ] && [ "$probe_rc" = 143 ] && [ ! -e "$LOCK_DIR" ]; then
    printf 'PASS  TERM saat bounded hidup: bersih, berhenti, exit 143\n'
  else
    printf 'FAIL  trap sinyal: lanjut=%s bounded_hidup=%s runtime_hidup=%s rc=%s (wajib 143) lock=%s\n' \
      "$probe_lanjut" "$probe_bounded_hidup" "$probe_runtime_hidup" "$probe_rc" \
      "$([ -e "$LOCK_DIR" ] && echo ada || echo tidak)"
    FAILURES=$((FAILURES + 1))
  fi
else
  FAILURES=$((FAILURES + 1))
  kill -TERM "$probe_pid" 2>/dev/null || true
fi
# Pembersihan defensif SESUDAH asersi: kalau probe memang meninggalkan sesuatu,
# itu sudah dicatat sebagai kegagalan di atas — tapi case berikutnya tidak boleh
# ikut merah karena sisa yang sama.
rm -f "$BUS_DIR/tmp/probe-ready" "$BUS_DIR/tmp/probe-continued" "$BUS_DIR/tmp/probe-bounded.pid"
[ -n "${probe_runtime:-}" ] && kill -0 "$probe_runtime" 2>/dev/null && bunuh_pohon "$probe_runtime"
[ -n "${probe_bounded:-}" ] && kill -0 "$probe_bounded" 2>/dev/null && bunuh_pohon "$probe_bounded"
remove_clone_supervisor
rm -rf "$STATE_DIR"; rm -f "$PID_FILE"; rm -rf "$LOCK_DIR"


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
  staging_response=$(read_builder RUNTIME-SELFTEST-STAGING)
  case "$staging_response" in
    *'"type":"PASS"'*'"task":"RUNTIME-SELFTEST-STAGING"'*) printf 'PASS  partial staging state is recovered without message loss\n' ;;
    *) printf 'FAIL  partial staging state did not receive PASS\n'; FAILURES=$((FAILURES + 1)) ;;
  esac
  if routing_matches "$staging_path" "$staging_response"; then
    printf 'PASS  Reviewer verdict retains exact request owner/origin and reply identity\n'
  else
    printf 'FAIL  Reviewer verdict rewrote or dropped request routing identity\n'; FAILURES=$((FAILURES + 1))
  fi
else
  FAILURES=$((FAILURES + 1))
fi
stop_active
wait_for "runtime cleanup after staging recovery" '[ ! -e "$LOCK_DIR" ]' 100 || FAILURES=$((FAILURES + 1))

# Case 3: valid JSON with invalid shapes and a syntactically valid unknown SHA
# are terminal poison, not queue locks. The Reviewer must archive/drop each and
# continue to the valid READY queued behind them.
null_poison_path=$(BUS_FROM=builder "$SEND" reviewer QUESTION "" RUNTIME-SELFTEST-NULL-POISON poison)
printf 'null\n' > "$null_poison_path"
array_poison_path=$(BUS_FROM=builder "$SEND" reviewer QUESTION "" RUNTIME-SELFTEST-ARRAY-POISON poison)
printf '[]\n' > "$array_poison_path"
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
  response=$(read_builder RUNTIME-SELFTEST-VALID)
  case "$response" in
    *'"type":"PASS"'*'"task":"RUNTIME-SELFTEST-VALID"'*)
      if [ -f "$BUS_DIR/archive/$(basename "$null_poison_path")" ] && \
         [ -f "$BUS_DIR/archive/$(basename "$array_poison_path")" ]; then
        printf 'PASS  null/array/SHA poison dropped; next valid review completed\n'
      else
        printf 'FAIL  non-object poison was not archived before valid review\n'
        FAILURES=$((FAILURES + 1))
      fi
      ;;
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
    first=$(read_builder RUNTIME-SELFTEST-HANG)
    second=$(read_builder RUNTIME-SELFTEST-NEXT)
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
read_builder "$retry_task" >/dev/null
BUS_FROM=builder "$SEND" reviewer READY_FOR_REVIEW "$HEAD_SHA" "$retry_task" retry >/dev/null
start_runtime 5
if wait_for "same-SHA retry after older response" '[ "$(inbox_count builder)" -ge 1 ]'; then
  retry_response=$(read_builder "$retry_task")
  case "$retry_response" in
    *'"type":"PASS"'*'"task":"RUNTIME-SELFTEST-RETRY"'*) printf 'PASS  later READY is not suppressed by an older response\n' ;;
    *) printf 'FAIL  later same-SHA READY was suppressed or misanswered\n'; FAILURES=$((FAILURES + 1)) ;;
  esac
else
  FAILURES=$((FAILURES + 1))
fi
stop_active
wait_for "runtime cleanup after case 5" '[ ! -e "$LOCK_DIR" ]' 100 || FAILURES=$((FAILURES + 1))

# Case 6: PENJAGA BERSARANG, dijalankan terhadap RUNTIME-nya sendiri.
#
# Case 1 memanggil "$SELF" — skrip test ini — jadi yang diuji di sana adalah
# penjaga isolasi milik test, BUKAN penjaga bersarang milik runtime. Temuan
# Reviewer 21 Agu: penjaga runtime karena itu tidak pernah dieksekusi satu kali
# pun oleh suite ini. Case ini memanggil "$RUNTIME" langsung.
#
# SKENARIO-nya dipilih dari reproduksi, bukan dikarang. Dengan pidfile ATAU
# lock masih utuh, dd5c68a sudah menolak (lock-lah yang menahannya), jadi
# skenario itu tidak membuktikan apa pun tentang penjaga. Yang benar-benar
# melahirkan duplikat adalah KEDUA catatan hilang sementara prosesnya hidup —
# keadaan sesudah crash-cleanup yang balapan, `stop` setengah jalan, atau
# penghapusan manual isi tmp/ (yang justru dilarang handover karena pernah
# terjadi).
#
# Direproduksi pada dd5c68a, di clone terpisah, sebelum perbaikan:
#
#   canonical=2544 (armed); rm pidfile + lock
#   "$RUNTIME" run  ->  "armed pid=3092"   <-- DUA runtime hidup bersamaan,
#                                              keduanya memantau inbox yang sama
#
# KEDUA invocation dijalankan DI LATAR dengan batas waktu, bukan di depan.
# Alasannya ditemukan saat menulis case ini: pada runtime yang belum diperbaiki,
# nested `run` BERHASIL arm lalu memblokir di bus-wait selamanya — jadi versi
# foreground-nya tidak gagal, ia MENGGANTUNG. Test regresi yang menggantung
# tidak melaporkan apa pun. Runtime kedua yang masih hidup sesudah batas waktu
# ITULAH kegagalannya, dan ia dicatat sebagai rc=ARMED.
start_runtime 5
if wait_for "idle runtime before nested-guard regression" '[ -s "$PID_FILE" ] && [ -s "$LOCK_DIR/pid" ]'; then
  nested_canonical=$ACTIVE_PID
  # Kedua catatan dihapus: inilah keadaan yang membuat seluruh pemeriksaan
  # berbasis pidfile/lock diam, dan hanya tabel proses yang masih tahu.
  rm -f "$PID_FILE"
  rm -rf "$LOCK_DIR"

  jalankan_terbatas "$BUS_DIR/tmp/nested-run-rc" "$RUNTIME" run
  nested_run_rc=$(cat "$BUS_DIR/tmp/nested-run-rc")
  jalankan_terbatas "$BUS_DIR/tmp/nested-start-rc" "$RUNTIME" start
  nested_start_rc=$(cat "$BUS_DIR/tmp/nested-start-rc")
  sleep 1

  nested_pidfile=no; [ -e "$PID_FILE" ] && nested_pidfile=yes
  nested_lock=no; [ -e "$LOCK_DIR" ] && nested_lock=yes

  # Kanonik BESERTA seluruh keturunannya tidak dihitung: satu runtime yang sehat
  # tampil sebagai beberapa proses (subshell command-substitution dan pipeline
  # mewarisi command line induknya). Yang dicari adalah runtime KEDUA.
  #
  # Keturunan SKRIP INI juga tidak dihitung, dan itu bukan kehati-hatian
  # berlebihan: needle-nya ikut masuk argv awk di bawah, jadi proses awk itu
  # sendiri cocok dengan polanya sendiri. Tanpa pengecualian ini penghitung
  # selalu melaporkan satu runtime hantu — jebakan yang sama persis dengan yang
  # ditemukan di other_runtime_pids.
  nested_procs=$(ps -eo pid=,ppid=,command= 2>/dev/null | awk -v needle="$RUNTIME run" -v canon="$nested_canonical" -v self="$$" '
    { induk[$1] = $2; baris[$1] = $0; urut[NR] = $1 }
    END {
      n = 0
      for (i = 1; i <= NR; i++) {
        p = urut[i]
        if (index(baris[p], needle) == 0) continue
        if (p == canon || p == self) continue
        q = p; dikenal = 0; d = 0
        while (d < 64 && (q in induk)) {
          q = induk[q]; d++
          if (q == canon || q == self) { dikenal = 1; break }
          if (q <= 1) break
        }
        if (dikenal) continue
        n++
      }
      print n
    }')

  if [ "$nested_run_rc" = 7 ] && [ "$nested_start_rc" != 0 ] && [ "$nested_start_rc" != ARMED ] && \
     kill -0 "$nested_canonical" 2>/dev/null && \
     [ "$nested_pidfile" = no ] && [ "$nested_lock" = no ] && [ "$nested_procs" = 0 ]; then
    printf 'PASS  nested run/start refused without records; no duplicate runtime\n'
  else
    ps -eo pid=,ppid=,command= 2>/dev/null | grep -F -- "$RUNTIME run" | grep -v grep
    printf 'FAIL  nested guard: run_rc=%s start_rc=%s pidfile=%s lock=%s runtime_lain=%s canonical_alive=%s\n' \
      "$nested_run_rc" "$nested_start_rc" "$nested_pidfile" "$nested_lock" "$nested_procs" \
      "$(kill -0 "$nested_canonical" 2>/dev/null && echo yes || echo no)"
    FAILURES=$((FAILURES + 1))
  fi

  # PEMBERSIHAN WAJIB, bukan opsional: kalau penjaga regresi, invocation di atas
  # meninggalkan runtime kedua yang hidup DAN — pada mesin ber-launchctl —
  # sebuah job launchd milik clone ini. Keduanya harus mati bersama test, kalau
  # tidak kegagalan test menjadi kebocoran ke mesin pengembang.
  # Urutannya penting: cabut supervisor DULU, baru bunuh prosesnya. Terbalik,
  # launchd langsung menghidupkannya kembali dan pkill jadi sia-sia.
  remove_clone_supervisor
  sleep 0.5
  pkill -f "$RUNTIME run" 2>/dev/null || true
  rm -f "$BUS_DIR/tmp/nested-run-rc" "$BUS_DIR/tmp/nested-start-rc"
  ACTIVE_PID=''
else
  FAILURES=$((FAILURES + 1))
fi
stop_active
rm -rf "$LOCK_DIR"

printf '%s\n' "runtime self-test failures=$FAILURES"
[ "$FAILURES" -eq 0 ]
