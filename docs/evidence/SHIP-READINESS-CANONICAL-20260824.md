# Shipping readiness canonical — 24 Agustus 2026

TASK=`SHIP-READINESS-CANONICAL-RECONCILE-20260824`

## Putusan

**SHIPPING_READINESS = 58/100.**

Ini satu-satunya skor current yang dapat dipertanggungjawabkan. Basis kode
setelah seluruh task yang diterima pada 24 Agustus adalah:

```text
BASIS_HEAD=03f1ea011b737c067ecf26ebc64c34f8b5f1ada3
BASIS_TREE=fd9a974972afade2f3373fd11e9f1549b2764037
BRANCH=work/p0-product-truth-20260820
WORKTREE_PADA_INSPEKSI=clean
```

Commit yang menambahkan dokumen ini tentu mempunyai SHA/tree berbeda; angka di
atas sengaja mengikat tree produk yang dinilai, bukan membuat referensi diri
yang berubah setiap kali dokumen dikoreksi.

Skor tidak naik karena task 24 Agustus masih local-only dan belum di-deploy.
`R2A-KONTRAK.md` menetapkan ceiling gelombang product-truth **55–58**, sedangkan
work order `SHIP-80-20260821` menetapkan code-only maksimum 70 dan mensyaratkan
Founder/external gates untuk 80. Tidak ada bukti baru yang membatalkan batas
itu. Public paid dan private beta tetap **HOLD**.

## Ledger skor — memakai basis board, bukan rubrik baru

Basis domain tetap 13 baris 0–10 pada
`docs/evidence/board-jawaban-2026-08-19.md`. Tidak ada bobot atau redistribusi
baru. Ledger requirement-by-requirement tetap memakai angka raw board:

| Requirement/domain board | Raw /10 | Keadaan bukti current |
|---|---:|---|
| Money safety | 9 | Bukti live historis ada; perubahan sesudahnya belum deployed |
| Auth intent & failure path | 7 | Kode/unit; browser Google-cancel production belum ada |
| Mobile UI 375 | 7 | Bukti 375 historis; 768/1024 dan wizard Postgres belum lengkap |
| Hydration/interaction canary CI | 8 | CI historis terverifikasi; dashboard production belum dicakup |
| Content engine standard | 7 | Local gates kuat; accepted 24 Agu belum deployed |
| Brand fidelity | 6 | E4/E8 canonical; E1/worker dan OCR policy masih partial |
| Anti-slop produksi | 7 | Campuran bukti terbuka dan prompt/local-only |
| Prompt/verdict archive | 8 | Migrasi historis live; belum ada trace production current end-to-end |
| NSFW rejection | 6 | Canary n=11 historis; KPI job production belum cukup |
| Payments | 2 | External/missing; go-live false |
| Legal/PDP | 2 | External/missing; halaman masih menandai counsel review belum final |
| DR/monitoring/incident owner | 2 | External/missing; owner dan drill belum terbukti |
| Landing/pricing consistency | 6 | Copy historis; keputusan harga/COGS Founder belum ada |
| **RAW TOTAL** | **77/130** | **Board basis, bukan skor canonical current** |

Koreksi aritmetika: 13 angka source board berjumlah **77**, bukan 79. Klaim
79/130 yang sempat muncul saat rekonsiliasi ditolak oleh penjumlahan langsung
`9+7+7+8+7+6+7+8+6+2+2+2+6=77`.

Perhitungan dua tahap yang menghasilkan tepat current `/100`:

```text
RAW_BOARD_NORMALIZED = 77 / 130 × 100 = 59.23 ≈ 59/100
R2A_EVIDENCE_CEILING = 58/100
CANONICAL_REPORTED_SCORE = min(59, 58) = 58/100
```

Cap 58 diperlukan karena sebagian bukti board bertingkat C/N, bukti live sudah
tua, dan accepted changes sesudahnya belum hidup di staging/produksi. Perubahan
24 Agustus memperkuat isi domain, tetapi tidak menaikkan shipping score sampai
artefak deployment dan external gates tersedia.

## Bukti yang diterima, dikarantina, dan tidak diterima

PASS berikut berasal dari Reviewer independen atas exact SHA. Untuk banyak
slice Reviewer dapat memeriksa source/diff/counterexample, tetapi worktree
isolated Reviewer tidak mempunyai `node_modules`; klaim suite TypeScript/npm
Builder karena itu tetap **local-only**, bukan eksekusi independen.

| Task diterima pada hari operasional 24 Agu (Asia/Jakarta) | Accepted SHA | Dampak yang boleh diklaim |
|---|---|---|
| `P0-C9-JOB-PRODUCT-METADATA-SNAPSHOT-20260823` | `3f1c4665ba49cbb0c02a91f57950e7ff5fd92f6a` | snapshot metadata job W1/W2 |
| `P0-C12-HTTP-MUTATION-RESUME-PROOF-20260823` | `59c398c4c8b1e24df7878933544c80b38a8a87ef` | bukti E5/E9→resume |
| `P1-LABEL-GATE-STRUCTURAL-DRIFT-20260824` | `f194fde072dc5570d96913fd52524ec697580fe9` | guard label gate |
| `P0-C9-HTTP-PRODUCT-MUTATION-RESUME-20260824` | `5593015c96e807f7de30e169b092b69abfb3260d` | bukti E3/E7→resume |
| `P1-SCRIPT-CATALOG-VALIDATION-20260824` | `17fb324ff231951d4fed9cddc7248ccc5bd4e7a5` | katalog 132/132 local; parser/reviewer source accepted |
| `P0-E4-ADDITIONAL-PHOTO-LABEL-GATE-20260824` | `52ce68d4c7494de19bc2cf4cbe5a30afff5f3e5a` | E4 setiap blob |
| `P0-E8-REGISTERED-BRAND-GATE-20260824` | `02071aab920ac18a96995f0b5df908a3ea454b5b` | E8 registered-brand gate |
| `P0-E4-REJECTED-REFERENCE-ROLLBACK-20260824` | `e25799d8a07df056ad8602db29801e438570de66` | rollback exact E4 |
| `P0-E8-REFERENCE-ELIGIBILITY-ROLLBACK-20260824` | `4e91cf2fa0882eb6421a745131c1745a4046357fc` | rollback/CAS exact E8 |
| `P0-E1-POLICY-QUARANTINE-REVERT-20260824` | `3d00a6c8a739bef6d74051f42f089e93af8985c6` | E1 policy dikembalikan ke state accepted |
| `P0-E8-ALL-UPLOADS-LABEL-BRAND-GATE-20260824` | `90e2b05568a48975b3e93d2356fc7e94b0320448` | E8 gate semua upload |
| `P0-C9-UNSOUND-PROOF-QUARANTINE-20260824` | `739276b542e0cb009165199f7598e6f0dd52d1ce` | proof C9 yang unsound dibuang seluruhnya |
| `P0-C3C4-CANONICAL-API-REASON-CODES-20260824` | `03f1ea011b737c067ecf26ebc64c34f8b5f1ada3` | canonical E4/E8 codes; agregat tetap partial |

Yang **tidak boleh dihitung**:

- E1 implementation `b98fda49...` dikarantina lewat `3d00a6c...` karena
  mengandung keputusan kebijakan Founder; tree akhirnya kembali ke parent
  accepted.
- Tiga commit proof C9 `36dddc0...`, `a4a087...`, `40dcb65...` tidak sound dan
  dikarantina lewat `739276b...`; tree quarantine sama dengan accepted E8.
- Setiap `CHANGES_REQUESTED`, local full suite, atau commit yang kemudian
  direvert bukan PASS shipping dan mendapat nol poin.

## Verified, local-only, dan external/missing

### Verified

- Exact-SHA Reviewer PASS dan bus history untuk task pada tabel di atas.
- Current source/diff untuk E4/E8 canonical code dan matrix current state.
- Latest local full suite yang tercatat pada accepted slice C3/C4:
  `1118 total / 1078 pass / 40 skip / 0 fail`; ini membuktikan tidak ada fail
  di mesin Builder, bukan eksekusi pihak kedua.
- `git diff --check` dan dependency-free checks dapat diulang tanpa network.
- Artefak staging 22 Agu memiliki provenance tersanitasi, tetapi hanya
  membuktikan deployment lama yang diamati saat itu.

Latest staging evidence yang authoritative adalah pengambilan read-only 22 Agu:
web `5fe53f27436d917d5232e23ef6c6e624eb00428a`, worker
`78d8468` (keduanya commit 4 Agu). Terhadap jangkar awal P0-03 `8cd2888`, web
tertinggal 323 commit dan worker 327 commit. `/api/health` web hanya menjawab
`{"ok":true,"intake":"open"}`; absence blok classification berarti probe
belum deployed, bukan runtime dinyatakan mampu/tidak mampu. Bukti ini tidak
memberi credit pada current HEAD.

### Local-only

- Seluruh perubahan setelah SHA staging lama, termasuk accepted task 24 Agu.
- Full npm/tsx, TypeScript, catalog, dan test dengan PostgreSQL disposable yang
  hanya dijalankan Builder. Skip 40 pada full terbaru tidak boleh menjadi PASS;
  mayoritas adalah gate PostgreSQL yang environment-nya tidak tersedia.
- Presence kredensial di laptop tidak membuktikan pasangan staging, approval
  merchant, settlement, atau kesiapan produksi.

### External/missing — pemeriksaan presence saja, nilai tidak pernah dicetak

| Input/gate | Presence/status yang diamati | Kesimpulan yang diizinkan |
|---|---|---|
| Render CLI + config | present | akses control-plane mungkin ada; bukan izin deploy |
| `DATABASE_URL`/`UJI_PG_URL` efektif | empty/missing | audit staging dan independent PG gate tidak bisa dijalankan dari sesi ini |
| R2 effective | endpoint/bucket empty; key id/secret nonempty | tidak ada pasangan DB+bucket yang sah untuk audit; jangan hubungkan silang |
| Duitku effective | merchant/api key nonempty; production=false | key lokal ada, approval/settlement/go-live tidak terbukti |
| Midtrans effective | rollback keys nonempty | jalur rollback sesuai ADR; bukan gateway current atau bukti settlement |
| `PAYMENTS_GO_LIVE` | false | paid public tetap tertutup |
| Ops alert | Resend key nonempty; alert destination empty | monitoring aktif belum dapat dianggap mengirim alert |
| Legal | privacy/terms/refund pages ada tetapi source menyatakan counsel review belum final | PDP/legal sign-off missing |
| Incident/DR | tidak ditemukan incident owner/runbook canonical atau drill current | external/owner evidence missing |

Koreksi status penting: baris Payments pada board 19 Agu menyebut Midtrans
sandbox. Itu benar secara historis, tetapi current decision adalah **Duitku
aktif, Midtrans rollback** (`docs/adr/0001-gateway-duitku-midtrans-rollback.md`).
Tidak satu pun keduanya boleh dinilai live sebelum syarat ADR terpenuhi.

## P0/P1 yang belum selesai dan batas kewenangan

| Gap | Status | Owner/authority | Artefak penutup yang dibutuhkan |
|---|---|---|---|
| P0-B2 runtime classification web | external/deploy | Founder/Release owner | deploy exact SHA + sanitized deploy/health probe yang menampilkan kapabilitas |
| P0-B3 angka legacy C10 | credential/data | Data/Release owner | JSON audit read-only dengan `DATABASE_URL` dan R2 yang terbukti berpasangan |
| T43 / P0-B4 action / P0-B5 / A1..A7 | Founder decision | Brian | keputusan tertulis A/B/C, treatment legacy, dan urutan rollout |
| C2 `TYPE_MISMATCH` | local implementation, belum bounded-approved | Builder setelah scope approval | route/admission boundary + canonical code + counterexamples |
| C5 `CATEGORY_UNKNOWN`/manual review | product policy + local | Founder lalu Builder | policy manual-review tertulis dan boundary test |
| C3/C4 E1/worker enforcement | partial | Founder untuk admission policy; Builder sesudahnya | policy + exact route/worker tests; E4/E8 saja sudah canonical |
| C6 OCR fail-open vs fail-closed | policy conflict | Founder | keputusan policy dan acceptance matrix selaras |
| C7 E1 resolver | dikarantina | Founder lalu Builder | T43-compatible rollback contract + independent exact-SHA proof |
| C8 admission A1..A7 | partial | Founder T43 | fail-closed boundary sebelum hold/enqueue di seluruh A1..A7 |
| C9 resume inventory/reason | partial; proof lama unsound | Builder, butuh bounded task baru | structural inventory yang sound + `SNAPSHOT_IMMUTABLE` bila disetujui |
| C12 reason code | partial | Builder, butuh bounded task baru | canonical `REFERENCE_IDENTITY_CHANGED` + route/worker proof |
| C1/C13 seluruh E/A/W positif | partial/external | QA/Release | satu trace end-to-end exact evidence, bukan resolver-only test |
| Duitku + price/COGS | external/Founder | Brian + Payments owner | approval, keputusan harga, settlement/webhook/replay report |
| Legal/PDP | external | Brian + counsel | signed/versioned approval dan halaman tanpa placeholder |
| Monitoring/DR | external/owner | Brian + incident owner | owner, alert delivery, runbook, restore/incident drill report |

`APPROVED_LOCAL_WORK_REMAINS = false` setelah task dokumen ini. Matrix memang
mencatat kandidat local, tetapi tidak ada task bounded berikutnya yang sudah
disetujui dan bebas keputusan kebijakan. Builder tidak boleh mengubah C2/C5,
E1, OCR, reason-code contract baru, deploy, atau payments hanya karena kandidat
itu tertulis.

## Critical path 48 jam

Urutan ini exact terhadap dependency; waktu adalah window target, bukan janji
bahwa pihak eksternal akan selesai.

| Window | Aksi/gate | Exact artifact untuk membuka tranche berikutnya |
|---|---|---|
| 0–2 jam | Founder menetapkan T43, price/COGS, release owner, incident owner, dan counsel contact | satu decision record versioned: opsi A/B/C, treatment legacy, harga, scope beta, nama owner, izin deploy/staging audit |
| 2–6 jam | Deploy **accepted exact SHA** ke staging web+worker; jalankan migrasi staging sesuai blueprint | sanitized manifest berisi deploy IDs, exact SHA web/worker, migration exit, `/api/health` HTTP/status termasuk classification/DB/Redis readiness |
| 4–8 jam | Audit legacy read-only memakai Postgres staging dan bucket R2 yang dibuktikan berpasangan | JSON signed/timestamped: total, no-photo, corrupt-column, approved, per-reason, failed-to-inspect; nol nilai credential |
| 6–18 jam | Jika T43 mengizinkan, Reviewer menerbitkan bounded task untuk E1/admission dan treatment legacy | accepted exact SHA + route/worker boundary tests + independent dependency-backed run; tidak ada deploy otomatis |
| 18–24 jam | Deploy ulang accepted remediation ke staging dan jalankan positive/negative product trace | exact deploy SHA + trace C1/C3/C4/C6/C7/C8/C10/C13, zero-cost assertions, rollback/list/audit evidence |
| 0–24 jam paralel | Duitku approval dan sandbox settlement/webhook/replay; counsel dan incident preparation | merchant approval reference; redacted settlement report; valid/invalid/duplicate/out-of-order webhook proof; signed legal approval; runbook+alert delivery |
| 24–36 jam | Sesudah approval dan otorisasi biaya, satu controlled production E2E OTP→topup→render→QC→delivery/refund dengan approved pricing | timestamped trace IDs, ledger reconciliation, QC audio/frame artifacts, delivery and controlled refund, exact deployed SHA |
| 36–48 jam | Independent release review dan Founder gate | Reviewer PASS atas artifact bundle + Founder `PAYMENTS_GO_LIVE`/intake decision; jika satu artifact hilang, HOLD tetap |

### Tranche skor

- **58 → maksimum code-only 70:** hanya sesudah accepted changes benar-benar
  deployed dan staging artifact di atas lulus. Ini ceiling, bukan kenaikan
  otomatis 12 poin.
- **70 → 80:** hanya sesudah Duitku production/settlement/webhook/replay,
  keputusan biaya/harga, satu E2E production-like lengkap, dan intake live
  terverifikasi seperti work order `SHIP-80`.
- **80 → 100:** tidak dapat dibuka oleh sprint kode saja.

## Syarat eksplisit untuk 80 dan 100

`80/100` baru sah bila semuanya ada:

1. exact accepted SHA deployed dan terverifikasi pada web+worker;
2. T43 dan treatment legacy diputuskan, audit legacy nyata selesai;
3. Duitku production approved; settlement, signature invalid/valid, duplicate,
   late/out-of-order, wrong amount, expired/cancelled/unknown, dan rekonsiliasi
   order↔payment↔ledger lulus;
4. price/COGS disetujui Founder dan `PAYMENTS_GO_LIVE` diberikan eksplisit;
5. satu E2E OTP→topup→render→QC audio/frame→delivery/refund lulus pada deployed
   SHA, dengan intake live terverifikasi;
6. tidak ada P0 fail-open pada jalur Retail yang dibuka.

`100/100` baru sah bila, selain seluruh syarat 80:

1. C1–C13 PASS di seluruh E1–E9, A1–A7, W1/W2 yang diwajibkan matrix;
2. seluruh P0/P1 ditutup tanpa BLOCKED/PARTIAL dan tanpa proof quarantine;
3. legal/PDP counsel sign-off final, incident owner/runbook/alert delivery,
   backup/PITR restore dan incident drill terbukti;
4. dashboard/mobile/auth browser coverage production lengkap, bukan unit-only;
5. prompt/QC/NSFW/product-fidelity mempunyai sample production representatif,
   benchmark bernama, KPI window, dan independent review;
6. payment dan worker stabil satu settlement/operational cycle penuh dengan
   rekonsiliasi nol selisih.

## Next autonomous action

`NEXT_AUTONOMOUS_ACTION = IDLE_COMPLETE_AWAIT_EXTERNAL_GATES`.

Reviewer harus mengonsumsi DONE task ini. Sesudah itu loop boleh memilih task
baru hanya jika Founder memberikan decision artifact atau Reviewer menerbitkan
bounded approval baru. Tidak ada deploy, audit remote, paid call, secret readout,
atau policy decision yang boleh diasumsikan dari dokumen ini.

## Consistency checks slice ini

- Parser dependency-free membaca 13 nilai `Baru` langsung dari source board:
  `ROWS=13`, `SUM=77`; 13 row ledger dokumen ini juga `SUM=77`.
- Semua 13 accepted SHA pada tabel adalah ancestor `BASIS_HEAD`.
- `git diff 4e91cf2..3d00a6c` kosong (E1 quarantine) dan
  `git diff 90e2b05..739276b` kosong (C9 proof quarantine).
- `git diff --check` PASS dan satu-satunya path yang diubah slice ini adalah
  dokumen evidence ini.
- Tidak ada npm/full suite yang diulang: task docs-only, dan hasil package
  lokal tidak akan mengubah tier evidence atau score.
