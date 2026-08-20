# Handover — Codex Reviewer Persistent Runtime

Tanggal: 21 Agustus 2026 (Asia/Jakarta)  
Status: **ACCEPTED — runtime tetap armed**  
SHA runtime yang diterima Reviewer: `2ed45fe5ff4299389d523b259a9d344cf7f9009b`

## Keputusan teknis

Codex CLI interaktif tidak menyediakan primitive native untuk membangunkan turn
yang idle dari penyelesaian proses filesystem. `notify` hanya outbound dan
`resume` tetap membutuhkan invocation baru. Primitive unattended yang tersedia
adalah `codex exec`.

Runtime terkecil yang terbukti persisten pada mesin ini adalah:

```text
launchd (repo-scoped supervisor)
  -> codex-reviewer-runtime
    -> bus-wait reviewer
      -> bus-read reviewer
        -> detached exact-SHA worktree
          -> codex exec (read-only, high reasoning, ephemeral)
            -> bus-send builder PASS | CHANGES_REQUESTED | FOUNDER_DECISION_REQUIRED
              -> langsung bus-wait reviewer lagi
```

Transport `.agent-bus` yang sudah ada tetap dipakai. Tidak ada queue, database,
cloud service, atau transport kedua.

## Bukti acceptance

- Pending message awal `READY_FOR_REVIEW a7eaf22` dikonsumsi sebagai
  `1787248506000-builder-READY_FOR_REVIEW`.
- Reviewer melakukan review independen dan mengirim
  `1787249715000-reviewer-CHANGES_REQUESTED` ke Builder.
- Claude Builder terbukti terbangun otomatis dari respons itu dan menjalankan
  `bus-read`; tidak ada relay Brian.
- Fault loop berikutnya menghasilkan temuan nyata, bukan rubber stamp:
  crash orphan, urutan pesan, bounded retry, staging commit-marker, destructive
  test guard, dan race test-vs-live-bus semuanya ditemukan lalu diperbaiki.
- Final Reviewer response:
  `1787254770000-reviewer-PASS`, terikat ke SHA `2ed45fe` dan task
  `RUNTIME-ACCEPTANCE-1`.
- Builder kemudian mengirim `1787254784000-builder-DONE`; Reviewer mengarsipkan
  DONE otomatis dan mencatat `re-arming`.
- Setelah DONE: kedua inbox kosong, runtime masih hidup, dan waiter baru aktif.
- Pesan manusia selama final loop setelah setup: **0**.

Tes terakhir, dijalankan saat Reviewer kanonik tetap armed:

```text
bus self-test:      13 kasus, 0 gagal
runtime fault-test: 5 kasus, 0 gagal
live PID:           tidak berubah
live lock:          tidak berubah
live state checksum: tidak berubah
```

Kedua suite mutatif berjalan di clone temporer `--no-hardlinks`, memakai token
per-run yang terikat ke root clone, dan tidak dapat menyentuh inbox, state,
supervisor, worktree, atau object database live. File `.agent-bus` baru yang
belum di-stage membuat test fail-closed; staged dan unstaged changes di-overlay
terhadap satu `SOURCE_SHA`.

## Operasi harian

Dari root repository:

```sh
./.agent-bus/bin/codex-reviewer-runtime status
./.agent-bus/bin/codex-reviewer-runtime start
./.agent-bus/bin/codex-reviewer-runtime stop
```

Log:

```sh
tail -f .agent-bus/tmp/codex-reviewer-supervisor.log
tail -f .agent-bus/tmp/codex-reviewer.log
```

Tes aman dijalankan walaupun Reviewer sedang armed:

```sh
sh .agent-bus/test-bus.sh
sh .agent-bus/test-reviewer-runtime.sh
```

Jangan menghapus manual `.agent-bus/tmp/codex-reviewer-current`, PID, lock, atau
exact-SHA worktree. Gunakan perintah `stop`; startup berikutnya akan melakukan
recovery state dan orphan process yang tervalidasi.

## Komponen utama

- `.agent-bus/bin/codex-reviewer-runtime` — persistent loop, lifecycle,
  exact-SHA worktree, recovery, retry, verdict delivery.
- `.agent-bus/bin/codex-review-exec.mjs` — process-group isolation dan timeout
  untuk satu invocation `codex exec`.
- `.agent-bus/bin/bus-send` — JSON lossless dan urutan global di bawah OS lock.
- `.agent-bus/bin/run-bus-test-isolated` — isolasi suite mutatif dari bus live.
- `.agent-bus/reviewer-verdict.schema.json` — kontrak verdict terstruktur.
- `.agent-bus/test-bus.sh` dan `.agent-bus/test-reviewer-runtime.sh` — transport
  serta fault-injection coverage.

## Batasan yang disengaja

- Exact-SHA Reviewer memakai sandbox read-only dan tidak mewarisi
  `node_modules` mutable dari checkout live. Bila dependency SHA itu tidak
  tersedia, Reviewer harus menyatakan tes tidak tersedia, bukan memakai versi
  lain atau mengunduh package.
- Default review timeout 900 detik dan maksimum tiga attempt. Setelah itu
  runtime mengirim `CHANGES_REQUESTED` infrastructure failure dan melanjutkan
  queue agar satu SHA tidak melakukan starvation.
- Supervisor macOS memakai label repo-scoped
  `com.bikinfyp.codex-reviewer.a4c4c9e34f1c`. Clone/worktree lain tidak boleh
  menghentikan runtime kanonik.

## Commit runtime

```text
ba06986 infra: add persistent Codex reviewer runtime
4e0a5a4 fix: supervise Codex reviewer with launchd
39ca695 fix: run SHA-bound reviewer through codex exec
0c51cd5 fix: pass Codex runtime binaries to launchd
ee62d20 fix: harden persistent Codex reviewer loop
15ebdff chore: isolate reviewer at high reasoning
837ed63 fix: make Codex reviewer runtime crash-safe
e6932b6 fix: make reviewer staging atomic
4cce3b0 test: protect live reviewer from fault suite
2ed45fe test: isolate agent bus fault suites
```
