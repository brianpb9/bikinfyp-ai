# .agent-bus — repo-local message bus (Claude Code Builder ↔ Codex Reviewer)

A minimal, auditable, file-based message bus. No database, network transport,
or package installs — POSIX `sh`, standard Unix tools, Git, and the Node.js
runtime already required by this application. Node's `JSON.stringify` preserves
all control characters and Unicode without inventing another JSON encoder.
The same three scripts behave identically whether Claude Code or Codex runs
them, because all state is plain files in this repo.

## Layout

```
.agent-bus/
  README.md            # this file (committed)
  bin/bus-send         # write a message      (committed)
  bin/bus-wait         # block until one arrives, DO NOT consume (committed)
  bin/bus-read         # consume the oldest message (committed)
  test-bus.sh          # self-test            (committed)
  inbox/builder/       # messages TO the builder   (gitignored runtime state)
  inbox/reviewer/      # messages TO the reviewer  (gitignored runtime state)
  archive/             # consumed messages         (gitignored runtime state)
  tmp/                 # staging for atomic writes (gitignored runtime state)
```

Inboxes, archive and tmp are **runtime state, not source**. They are
gitignored; only `.gitkeep` files are committed so the directories exist in a
fresh clone. The scripts also `mkdir -p` what they need, so a missing
directory is never an error.

## Message format

One JSON file per message. Filename:

```
<unix_ms>-<from>-<type>.json
```

The millisecond prefix is fixed-width, so plain glob order is age order —
"oldest message" needs no timestamp parsing. `bus-send` allocates that prefix
through one atomic, bus-global monotonic sequence. This preserves send order
across roles and message types even on macOS, whose `date` lacks millisecond
formatting, and across clock rollback.

Flat JSON, no nesting. Every new message carries durable routing identity:

```json
{"id":"...","ts":"<iso8601>","from":"builder|reviewer","to":"builder|reviewer",
 "type":"TASK|READY_FOR_REVIEW|CHANGES_REQUESTED|PASS|DONE|QUESTION|FOUNDER_DECISION_REQUIRED",
 "sha":"<40-char git sha or empty>","task":"<task id>","task_id":"<task id>",
 "owner_id":"<write owner>","worker_id":"<same write owner>",
 "origin_branch":"<branch or DETACHED>","origin_worktree":"<physical path>",
 "origin_repo_id":"<Git-common-dir identity>","origin_repo_path":"<physical common dir>",
 "reply_to_id":"<request id or empty>","body":"<free text>"}
```

The first routed message for a task durably binds that `task_id` to one
`owner_id`; a conflicting sender exits 7 without publishing. Distinct physical
worktrees/branches may share one transport. The Reviewer remains one global
consumer and copies the request's routing identity into its verdict.

### Atomic writes

`bus-send` never writes into an inbox directly. It writes the complete file
into `.agent-bus/tmp/` and then `mv`s it into the inbox. Both are on the same
filesystem, so the rename is atomic: a reader either sees no file or sees the
whole message. It can never observe a half-written one.

## Message types

| Type | From | Meaning |
|---|---|---|
| `TASK` | reviewer | Assign approved bounded work to one routed owner. |
| `READY_FOR_REVIEW` | builder | Work is committed at `sha`; reviewer should review that exact commit. **sha required.** |
| `CHANGES_REQUESTED` | reviewer | Review of `sha` found problems; `body` says what must change. **sha required.** |
| `PASS` | reviewer | `sha` reviewed and accepted. **sha required.** |
| `DONE` | either | This task is finished; no further action expected on the bus. |
| `QUESTION` | either | A blocking question the other side must answer before work continues. |
| `FOUNDER_DECISION_REQUIRED` | either | Outside both agents' mandate — stop and escalate to Brian. |

### SHA_BINDING

For `READY_FOR_REVIEW`, `CHANGES_REQUESTED` and `PASS`, the `sha` must be a
40-character lowercase hex object that `git cat-file -e <sha>` confirms exists
in this repo. Anything else exits **3** and no message is written. This is what
stops a reviewer from reviewing "the latest code" instead of a named commit:
every verdict is bound to an object that actually exists.

### STALE SHA PROTECTION

`bus-read` prints a `STALE=true|false` line after the JSON:

* `STALE=false` — the message's `sha` is HEAD or an ancestor of HEAD
  (`git merge-base --is-ancestor <sha> HEAD`), or the message carries no sha.
* `STALE=true` — the sha exists but is **not** on the current line of history:
  the branch was rebased, amended, reset, or the commit lives elsewhere. The
  verdict in that message refers to code that is no longer what HEAD contains.

Stale messages are **flagged, never deleted**. Deciding what a stale verdict is
worth is a human/agent judgement, not something the bus should silently make.

## Role separation

* The builder writes only to `inbox/reviewer/`.
* The reviewer writes only to `inbox/builder/`.
* Neither role may post into its own inbox.

`bus-send` enforces this. `from` defaults to the *other* role (there are only
two), and can be pinned explicitly with the `BUS_FROM` environment variable —
useful in scripts and required by the self-test. If `from == to`, `bus-send`
exits **6** and writes nothing.

## Usage

```sh
# send (from builder, to reviewer)
AGENT_BUS_OWNER_ID=builder-a .agent-bus/bin/bus-send reviewer READY_FOR_REVIEW "$(git rev-parse HEAD)" P0-03 "Slice 1 done, tests green"

# a message with no commit attached
.agent-bus/bin/bus-send builder QUESTION "" P0-03 "Should retries be idempotent?"

# block until something arrives (does NOT consume)
.agent-bus/bin/bus-wait builder 600 --task P0-03 --owner builder-a

# consume the oldest message (prints JSON + STALE=..., then archives it)
.agent-bus/bin/bus-read builder --task P0-03 --owner builder-a

# persistent task/owner-scoped wake lifecycle
.agent-bus/bin/bus-arm builder --task P0-03 --owner builder-a
```

`AGENT_BUS_TASK_ID` and `AGENT_BUS_OWNER_ID` provide equivalent Builder
selector defaults; explicit flags win. A scoped scan skips every other file
without moving, rewriting, or archiving it. `bus-read` locks the inbox only for
selection plus archive rename, so concurrent readers archive a match exactly
once.

Legacy messages with none of the routing fields are never silently assigned to
a scoped owner. Only an explicit unscoped migration read may consume them.
Partial routing metadata fails closed with exit 8. A Reviewer response to a
legacy request is quarantined as `legacy-unclaimed-<request-id>`.

### Why wait and read are separate

`bus-wait` deliberately does not consume. Waking up and handling a message are
two different events; if they were one command, a crash between "the command
returned" and "the agent acted on it" would lose the message permanently. With
the split, an interrupted agent restarts, calls `bus-wait` again, and the
message is still there. Nothing is removed from an inbox until `bus-read`
explicitly archives it.

### Exit codes

| Code | Meaning |
|---|---|
| 0 | success |
| 2 | usage error, invalid role, or invalid type |
| 3 | SHA_BINDING violation (`bus-send`) |
| 4 | timeout with no message (`bus-wait`) |
| 5 | inbox empty (`bus-read`) |
| 6 | ROLE_SEPARATION violation, `from == to` (`bus-send`) |
| 7 | task already belongs to another owner (`bus-send`) |
| 8 | routing selector or ownership rejected (`bus-read`/`bus-wait`) |
| 9 | archive collision; existing history is never overwritten (`bus-read`) |

## Lifecycle of one message

1. Builder commits, then `bus-send reviewer READY_FOR_REVIEW <sha> <task> <body>`.
2. The file lands atomically in `.agent-bus/inbox/reviewer/`.
3. Reviewer's `bus-wait reviewer` returns, printing the path and the JSON.
   The file is still in the inbox.
4. Reviewer runs `bus-read reviewer`: JSON + `STALE=…` are printed and the file
   moves to `.agent-bus/archive/`. The inbox is now empty; the audit trail is not.
5. Reviewer replies with `bus-send builder PASS|CHANGES_REQUESTED <sha> …`.
6. Only the matching Builder's scoped `bus-wait builder --task … --owner …`
   returns. Earlier messages for other owners remain byte-for-byte untouched.

`archive/` is the append-only audit trail of everything both sides consumed.

## Wake mechanism — stated honestly, per side

The two sides do **not** wake the same way, and the two mechanisms are not
equally proven.

### Claude Code (builder) — verified mechanism

Run the wait as a **backgrounded Bash tool call**:

> Bash tool, `command: .agent-bus/bin/bus-wait builder 3600 --task P0-03 --owner builder-a`, `run_in_background: true`

The command keeps running across turns. When a message arrives, `bus-wait`
exits, and the Claude Code harness re-invokes Claude with the completed
command's output. **No human needs to type anything** for Claude to resume.
This is a documented property of the harness's background-task notification,
and the blocking/return behaviour of `bus-wait` itself was exercised by
`test-bus.sh` (cases 5, 6, 9).

### Codex (reviewer) — persistent non-interactive runtime

Empirical test on Codex CLI 0.144.1 proved that completion of a foreground
shell tool does **not** wake an already-idle interactive turn. The native Codex
surface for unattended work is `codex exec`.

Start the repo-local wrapper once:

```sh
.agent-bus/bin/codex-reviewer-runtime start
.agent-bus/bin/codex-reviewer-runtime status
```

It keeps the existing transport and lifecycle intact:

1. `bus-wait reviewer` blocks;
2. the oldest message is staged, then archived with `bus-read`;
3. a detached Git worktree outside the live checkout is checked out at the
   exact message SHA, then
   `codex exec --ignore-user-config --sandbox read-only` performs the review
   there with the SHA and task also bound in its prompt;
4. a JSON schema constrains the result to `PASS`, `CHANGES_REQUESTED`, or
   `FOUNDER_DECISION_REQUIRED` and binds it to the same SHA/task;
5. the wrapper sends it with the existing `bus-send` and immediately waits
   again.

Personal Codex MCP/config entries are deliberately excluded from this unattended
role; reviewer reasoning effort is then set explicitly to `high`. Each review
also runs in its own process group with a 15-minute default wall-clock limit
(`CODEX_REVIEWER_TIMEOUT_SECONDS` can override it), so one hung tool cannot
block the queue forever.

The external worktree deliberately cannot inherit mutable `node_modules` from
the live checkout. Package downloads run offline; when exact dependencies are
not present, the Reviewer must mark the affected test unavailable instead of
silently testing another SHA's dependency tree.

On macOS, `start` submits the loop to `launchd`; this is necessary because the
Codex tool harness cleans up detached shell process groups after tool completion.
Other platforms fall back to `nohup` and should use their normal process
supervisor for machine-level durability.

The launchd label contains a stable hash of the repository path, and lifecycle
commands verify the submitted script path before removing a job. Separate clones
and detached review worktrees therefore cannot stop each other's Reviewer.

Runtime state, PID, exact-SHA worktree, and logs live under ignored
`.agent-bus/tmp/`. A staged message survives a Reviewer subprocess failure and
is retried. Recovery recognizes the message in either inbox or archive, stale
locks are reclaimed after a hard crash, and an existing response in the Builder
inbox/archive prevents duplicate delivery after a restart. That match is also
bound to bus sequence: an older infrastructure response does not suppress a
later explicit retry of the same SHA and task.

An attempt counter is persisted with the staged message. After three failed or
timed-out Codex invocations, the runtime sends a SHA-bound
`CHANGES_REQUESTED` infrastructure failure, clears that state, and re-arms so a
deterministic failure cannot starve later reviews.

## Self-test

```sh
sh .agent-bus/test-bus.sh
sh .agent-bus/test-reviewer-runtime.sh
```

Both public test entrypoints clone the current HEAD locally, overlay staged and
unstaged `.agent-bus` changes, and run only inside that disposable repository.
They can therefore run while the persistent Reviewer is armed without racing
or mutating its inbox, state, worktree, supervisor, or Git object database.

Covers: round-trip in both directions, invalid role/type rejection,
SHA_BINDING, ROLE_SEPARATION, prompt return when a message is waiting, timeout
exit 4, empty-inbox exit 5, STALE flagging for HEAD / ancestor / non-ancestor
shas, mixed-type ordering, JSON controls/Unicode, and crash-safety (the message
survives `bus-wait`). The runtime fault test covers unknown-SHA poison, SIGKILL
with a detached child, partial staging recovery, orphan reaping, bounded
failure, non-destructive active-runtime refusal, same-SHA retry correlation,
and re-arm to the next queued SHA.

The inner suites retain active-state/inbox guards as defense in depth and
remove only their isolated archived messages afterwards.

## Siklus hidup penunggu Builder (WAJIB)

Ditulis sesudah cacat nyata 21 Agu: `bus-wait` SENGAJA keluar saat pesan datang
— itulah yang membangunkan Builder — lalu tidak ada yang memasangnya kembali.
Akibatnya sesudah `DONE`, Builder tuli terhadap pesan Reviewer berikutnya.

### 1. Aturan start
Tindakan runtime PERTAMA setiap sesi Builder — dan ini BUKAN cuplikan shell
biasa, sengaja ditulis tanpa blok kode `sh` supaya tidak ada yang menyalinnya
mentah ke terminal. WAJIB dijalankan sebagai **panggilan Bash tool milik
Claude sendiri, dengan `run_in_background: true`** — TIDAK PERNAH shell `&`,
`nohup`, `setsid`, atau pelepasan manual apa pun (lihat Aturan 3: kenapa
pelepasan memutus bangun-otomatis, dan REGRESI NYATA yang pernah terjadi
karenanya di bawah). Tunggu keluaran `ARMED pid=...` sebelum melanjutkan.

Perintahnya: `.agent-bus/bin/bus-arm builder --task <task> --owner <owner>`

### 2. Aturan siklus hidup — PASANG DULU, BARU KIRIM

Panggil `bus-arm builder --task … --owner …` (sebagai panggilan Bash tool `run_in_background`,
sama seperti Aturan 1) **SEBELUM** `bus-send`, bukan sesudahnya:

    1. .agent-bus/bin/bus-arm builder --task … --owner … # dulu — Bash tool, run_in_background:true
    2. .agent-bus/bin/bus-send reviewer …  # baru

Urutannya dibalik pada 22 Agu, temuan Reviewer, dan ia menemukan DUA hal
sekaligus lewat satu pengamatan:

1. Kontrak lama (kirim dulu, arm belakangan) membuka JENDELA NYATA: Reviewer
   bisa membalas di antara keduanya, dan balasan itu tiba saat nol penunggu.
   Pesannya tidak hilang — ia menunggu di inbox — tapi tidak ada yang
   dibangunkan, jadi Builder diam sampai ada yang menyadarinya.
2. Kontrak lama juga membuat peringatan "nol penunggu" di `bus-send` berbunyi
   di ALUR NORMAL: penunggu sebelumnya memang sudah keluar karena pesan
   Reviewer yang baru saja membangunkan Builder. Alarm yang berbunyi setiap
   siklus yang benar akan diabaikan orang dalam sehari, dan kembali senyap.

Dengan urutan arm-dulu, peringatan itu hanya berbunyi saat Builder BENAR-BENAR
tuli. Diuji sebagai siklus kanonik penuh (`test-bus.sh` kasus 20).

Keadaan mantap yang wajib diakhiri dengan penunggu terpasang:

- sesudah `CHANGES_REQUESTED` diproses dan submission baru dikirim;
- sesudah `PASS` diproses;
- sesudah `DONE` dipancarkan;
- sesudah pertukaran `QUESTION`/`DISPUTE` selesai;
- keadaan lain mana pun yang masih mungkin menerima pesan Reviewer.

JANGAN memeriksa dulu apakah penunggu sudah ada. Selalu panggil `bus-arm`;
penjaga idempotennya yang memiliki pencegahan duplikat. Pidfile basi gagal
dengan aman: ia dibersihkan lalu penunggu baru dipasang.

Penjaga itu memeriksa IDENTITAS, bukan sekadar `kill -0` (perbaikan 22 Agu).
Alasannya: `kill -0` menerima PID DAUR ULANG, jadi proses asing yang kebetulan
memakai PID di pidfile membuat `bus-arm` melapor "SUDAH ADA" lalu keluar tanpa
memasang apa pun — Builder tuli, laporannya berkata sebaliknya. Sekarang baris
perintah PID itu harus benar-benar `bus-wait <role>` milik bus INI. Dan pidfile
basi tidak pernah dipakai untuk mengirim sinyal, jadi ia juga tidak bisa
membunuh proses asing.

### 3. Aturan kepemilikan sesi
JANGAN melepas penunggu dengan `nohup`/`setsid` sekadar agar ia bertahan saat
terminal ditutup. Penunggu HARUS dimiliki sesi Claude Builder yang aktif,
karena selesainya perintah latar belakang itulah yang membangunkan harness
secara otomatis. Melepasnya memutus bangun-otomatis — persis kemampuan yang
seluruh bus ini ada untuk menyediakannya.

Konsekuensi yang diterima: terminal ditutup -> penunggu ikut mati -> sesi
Builder berikutnya memasang yang baru lewat aturan start di atas.

### 4. Apa yang MEKANIS, dan apa yang tidak — dengan alasannya

Aturan di atas pernah gagal dua kali dengan cara yang sama: ia hanya instruksi,
dan instruksi tidak menjalankan dirinya sendiri. Sebagian sudah dipindahkan ke
runtime; sebagian TIDAK BISA, dan bagian itu ditulis di sini apa adanya supaya
tidak ada yang mengira sudah beres.

MEKANIS sekarang (dijaga `.agent-bus/test-bus.sh` — 44 kasus per 22 Agu; nomor
kasus TIDAK dikutip lagi di sini karena mereka bergeser tiap penambahan, cari
lewat isi tabel di bawah, bukan nomor):

| Cacat | Dulu | Sekarang |
|---|---|---|
| habis waktu | `bus-wait` keluar 4, `bus-arm` meneruskannya lalu berhenti; nol penunggu, TULI PERMANEN | `bus-arm` memasang ulang sendiri; hanya kedatangan pesan yang mengakhirinya |
| PID daur ulang | `kill -0` menerima proses asing; `bus-arm` menolak memasang | identitas ARGV PERSIS diperiksa (bukan substring/glob — lihat baris "decoy argv" di bawah); pidfile basi diabaikan, proses asing tidak disentuh |
| pidfile basi saat dibunuh | tidak ada trap; berkas basi tertinggal | trap TERM/INT/EXIT, dan `\|\| true` di setiap trap supaya `set -e` tidak memotong sebelum kode keluar sinyal tercapai |
| keadaan tuli tidak terlihat | senyap total | `bus-send` DARI builder memperingatkan ke stderr kalau nol penunggu |
| periksa-lalu-telur tidak atomik | dua `bus-arm` serentak sama-sama lolos pemeriksaan lalu menelurkan penunggu GANDA | bagian kritis dikunci OS-backed (`lockf` Darwin / `flock` Linux, dipilih dari `uname`, BUKAN `mkdir` — versi mkdir-based sempat dicoba dan punya balapan yang sama satu lapis lebih dalam) |
| pembersihan pidfile tanpa kepemilikan | satu instance menghapus registrasi instance lain | setiap penghapusan memverifikasi isinya milik sendiri, di bawah kunci yang sama |
| jendela balasan | Reviewer bisa membalas antara `bus-send` dan `bus-arm` | kontrak dibalik: arm DULU, baru kirim |
| jendela pra-exec / pra-token | pidfile diterbitkan sebelum identitas anak terlihat | jabat tangan token SIAP: bus-wait memancarkan token SEBELUM pemindaian pesan pertama; pidfile terbit hanya sesudahnya |
| kunci ikut diwarisi penunggu | fd kunci tidak ditutup di anak; penunggu berumur panjang menahan kunci sepanjang hidupnya, mengunci seluruh siklus tunggu | `9>&-` saat menelurkan bus-wait |
| kill sebelum identitas terbukti | PID yang tercatat status LIVE bisa sudah dituai/didaur-ulang tepat sebelum trap berbunyi | setiap titik kill diverifikasi PPID==$$ (atau `penunggu_sah` untuk penggantian yatim) TEPAT sebelum sinyal, bukan berdasar status yang tercatat |
| kegagalan kunci saat membersihkan | PPID dipakai sebagai bukti SERIALISASI, padahal ia cuma bukti kepemilikan | gagal-tertutup: kalau kunci tidak didapat, TIDAK menyinyali sama sekali |
| decoy argv | pencocokan substring/glob — proses asing dengan argv yang MEMUAT pola bus-wait di mana pun lolos | bentuk argv PENUH divalidasi (interpreter opsional, path skrip PERSIS, role PERSIS, satu timeout numerik, tanpa token ekstra) — pencocokan STRING berjangkar, bukan word-splitting (aman untuk path berspasi) |
| TIMEOUT=0 mode persisten | busy-loop tanpa batas (fork/tulis/hapus tanpa jeda) | ditolak (rc 2) di mode persisten; `--sekali` tetap boleh. Bentuk nol berawalan-nol (`00`, `08`, ...) JUGA ditolak — `08` bahkan meledakkan aritmetika shell (dibaca sebagai oktal tidak sah) |
| BUS_DIR tidak dikanonikkan | repo yang sama dibuka lewat symlink DAN path fisik menghitung BUS_DIR berbeda secara tekstual -> DUA penunggu | `pwd -P` di semua tool bus (bus-arm, bus-wait, bus-send, bus-read, codex-reviewer-runtime, run-bus-test-isolated) |
| penunggu yatim diterima sebagai sehat | SIGKILL induk (tak bisa ditangkap trap) meninggalkan bus-wait hidup + pidfile menunjuknya; PPID SAJA bukan bukti supervisi (proses standalone berinduk shell hidup juga lolos) | kepemilikan supervisor POSITIF: klaim `pid:nonce` (PID + waktu-mulai proses) ditulis di bawah kunci yang sama dengan pidfile, dan diverifikasi lewat HUBUNGAN — PPID waiter yang sebenarnya harus PERSIS sama dengan pid yang diklaim, bukan sekadar "ada klaim yang hidup di suatu tempat" |

TIDAK BISA MEKANIS, dan ini batas yang sudah dibuktikan, bukan dugaan:

Kanal bangun Builder adalah **notifikasi selesainya background task milik
harness Claude**. Penunggu hidup di dalam pohon proses task itu:

    bus-wait  <-  bus-arm  <-  zsh (background task harness)  <-  claude

Konsekuensinya berpasangan, dan tidak ada jalan tengah:

- penunggu yang DIMILIKI task harness akan dibunuh saat task itu dipanen di
  akhir giliran (terbukti: notifikasi `killed` / exit 143 berulang);
- penunggu yang DILEPAS (`setsid`/`nohup`/`&`) bertahan melewati akhir giliran,
  tapi TIDAK punya kanal apa pun untuk membangunkan sesi — ia keluar diam-diam
  dan tidak ada yang tahu.

Karena itu memasang ulang lewat `bus-read` atau lewat runtime Reviewer yang
persisten JUSTRU MERUSAK: keduanya menghasilkan penunggu tak-terlacak, dan
penjaga idempoten lalu melapor "SUDAH ADA" sehingga `bus-arm` milik sesi —
satu-satunya yang bisa membangunkan — tidak pernah terpasang. Kanalnya mati
sementara laporannya sehat. Itu lebih buruk daripada cacat aslinya.

Yang tersisa untuk sesi: MEMBUAT background task-nya. Hanya sesi yang bisa.

Yang membuat sisa itu tidak berbahaya: pesan TIDAK PERNAH hilang. `bus-wait`
tidak mengonsumsi; hanya `bus-read` yang mengarsipkan. Jeda tanpa penunggu
adalah soal LATENSI, bukan kehilangan — pesan menunggu di inbox sampai dibaca.
Dijaga kasus 19.
