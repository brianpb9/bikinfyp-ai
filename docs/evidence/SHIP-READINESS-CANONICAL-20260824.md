# Shipping readiness canonical — 24 Agustus 2026

TASK=`SHIP-READINESS-CANONICAL-C9C12-RECONCILE-20260824`

## Putusan

**SHIPPING_READINESS = 58/100.**

Ini satu-satunya skor current yang dapat dipertanggungjawabkan. Baseline
accepted setelah seluruh task yang diterima pada 24 Agustus adalah:

```text
ACCEPTED_BASELINE_HEAD=0b2985cb6bab0bd101ad90a8230c28ba8e948aab
LATEST_PRODUCT_CODE_SHA=e1e80c052ee7d77339239af09f83eb2b37649289
LATEST_PRODUCT_TREE=9955de4c9daf0704322e29f95ec662442702a9cf
BRANCH=work/p0-product-truth-20260820
WORKTREE_PADA_INSPEKSI=tracked-clean; bootstrap untracked preserved/excluded
```

Commit yang menambahkan dokumen ini tentu mempunyai SHA/tree berbeda; angka di
atas membedakan baseline evidence yang sudah diterima dari exact tree produk
yang diuji, bukan membuat referensi diri yang berubah setiap kali dokumen
dikoreksi.

Skor tidak naik sesudah managed staging deploy karena bukti deployment justru
menemukan web runtime tidak punya tesseract (`klasifikasi.mampu=false`), belum
ada valid-product end-to-end canary, dan external gates produksi tetap HOLD.
`R2A-KONTRAK.md` menetapkan ceiling gelombang product-truth **55–58**, sedangkan
work order `SHIP-80-20260821` menetapkan code-only maksimum 70 dan mensyaratkan
Founder/external gates untuk 80. Tidak ada bukti baru yang membatalkan batas
itu. Public paid dan private beta tetap **HOLD**. Refresh production 24 Agu
juga menemukan kedua service masih `autoDeploy=yes`, bertentangan dengan
release control committed yang mensyaratkan off; drift P1 ini sendiri adalah
alasan HOLD sampai ditutup oleh release owner dan diverifikasi read-only.

## Ledger skor — memakai basis board, bukan rubrik baru

Basis domain tetap 13 baris 0–10 pada
`docs/evidence/board-jawaban-2026-08-19.md`. Tidak ada bobot atau redistribusi
baru. Ledger requirement-by-requirement tetap memakai angka raw board:

| Requirement/domain board | Raw /10 | Keadaan bukti current |
|---|---:|---|
| Money safety | 9 | Bukti live historis ada; accepted tree kini deployed ke staging saja, belum production/current paid E2E |
| Auth intent & failure path | 7 | Kode/unit; browser Google-cancel production belum ada |
| Mobile UI 375 | 7 | Bukti 375 historis; 768/1024 dan wizard Postgres belum lengkap |
| Hydration/interaction canary CI | 8 | CI historis terverifikasi; dashboard production belum dicakup |
| Content engine standard | 7 | Local gates kuat dan accepted tree hidup di staging; valid-product E2E/production belum ada |
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

Cap 58 diperlukan karena sebagian bukti board bertingkat C/N, managed staging
menemukan classifier incapable dan belum mempunyai valid-product E2E, serta
external gates produksi belum tersedia. Deployment exact-SHA memperkuat level
bukti tree produk, tetapi tidak otomatis menaikkan shipping score.

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
| `P0-E8-REFERENCE-ELIGIBILITY-ROLLBACK-20260824` | `4e91cf2fa0882eb6421a745fd990f15427b105cc` | rollback/CAS exact E8 |
| `P0-E1-POLICY-QUARANTINE-REVERT-20260824` | `3d00a6c8a739bef6d74051f42f089e93af8985c6` | E1 policy dikembalikan ke state accepted |
| `P0-E8-ALL-UPLOADS-LABEL-BRAND-GATE-20260824` | `90e2b05568a48975b3e93d2356fc7e94b0320448` | E8 gate semua upload |
| `P0-C9-UNSOUND-PROOF-QUARANTINE-20260824` | `739276b542e0cb009165199f7598e6f0dd52d1ce` | proof C9 yang unsound dibuang seluruhnya |
| `P0-C3C4-CANONICAL-API-REASON-CODES-20260824` | `03f1ea011b737c067ecf26ebc64c34f8b5f1ada3` | canonical E4/E8 codes; agregat tetap partial |
| `P1-W1-DISPOSABLE-PG-GATE-REMEDIATION-20260824` | evidence `09cddfbb5940f2d6d72a3624c0ea2ff6d2f7a410`; code `b6bc116b1640fd561c982349262e5e070fa07f64` | W1 PostgreSQL disposable 25/25; money 11/11; D2 4/4; cleanup terjamin |
| `P1-FULL-DISPOSABLE-PG-ZERO-SKIP-20260824` | evidence `9e1d13d5544d8a996998283d9cc8496848848a6b`; code `de1a6ef53bdfb4de14d01e8c13cc223a54cddd61` | full 1.119: 1.115 PASS, 0 fail, 4 gated skip; retry serializable stabil; tsc/build/catalog PASS |
| `P0-C12-ADMISSION-REFERENCE-SNAPSHOT-20260824` | evidence `2073ba84fe179c9fde82bdd7b27027c4cec88ca3`; code `57d1a34883f68088d7f5cd8d5f4ffa736acfc54e` | tiga admission memasang manifest reference job-owned; cleanup known-loser dan pruning successful-retry aman; targeted 56/56, W1 28/28, full 1.133: 1.090 PASS / 0 fail / 43 skip |
| `P1-C9-PROMO-OUTPUT-COUNTEREXAMPLE-20260824` | evidence `0b2985cb6bab0bd101ad90a8230c28ba8e948aab`; code `e1e80c052ee7d77339239af09f83eb2b37649289` | actual compositor frame W2 gain/removal dan W1 change; affected 19/19, W1 29/29, full 1.135: 1.091 PASS / 0 fail / 44 skip |

Yang **tidak boleh dihitung**:

- E1 implementation `b98fda49...` dikarantina lewat `3d00a6c...` karena
  mengandung keputusan kebijakan Founder; tree akhirnya kembali ke parent
  accepted.
- Tiga commit proof C9 `36dddc0...`, `a4a087...`, `40dcb65...` tidak sound dan
  dikarantina lewat `739276b...`; tree quarantine sama dengan accepted E8.
- Setiap `CHANGES_REQUESTED`, local full suite, atau commit yang kemudian
  direvert bukan PASS shipping dan mendapat nol poin.

### Rekonsiliasi accepted C12 dan C9

**C12.** Code `57d1a348...` / evidence `2073ba84...` adalah state accepted
terakhir. Retail SQLite, retail PostgreSQL, dan organization PostgreSQL
memasang ordered job-owned reference manifest pada admission bersama snapshot
produk. Preparation failure, known rollback, insufficient balance, duplicate
loser, dan retry exhaustion membersihkan key hanya sesudah database
authoritative membuktikan tidak ada winner; commit/network/CAS ambiguity tidak
memicu delete. Sesudah successful retry, pruning membandingkan target tracked
dengan manifest committed dan hanya menghapus surplus, termasuk jalur
PostgreSQL `40001`. Ini menutup local admission-time identity gap untuk job
baru, bukan seluruh C12: legacy fallback/treatment dan reason code proposal
`REFERENCE_IDENTITY_CHANGED` tetap belum canonical.

**C9.** Code `e1e80c0...` / evidence `0b2985cb...` membuktikan actual admission
→ HTTP mutation → worker → production compositor output. W2 gain/removal
memberi crop frame berbeda dan substantif; W1 E7 change juga menghasilkan
frame compositor substantif. Exact compositor input dan OCR/pixel hashes
membuktikan core prompt tetap admission-bound sementara promo before/deadline
dibaca live. Koreksi penting: `promo_stock_left` juga dibaca live tetapi tidak
dipakai `formatPromoOverlayText()`, sehingga stock saat ini **inert** dan tidak
boleh diklaim dirender. Bukti memilih nol policy; Founder harus memilih
`PROMO_POLICY=SNAPSHOT` (Reviewer recommendation) atau `LIVE_INTENTIONAL`.

Kedua slice kode itu kini termasuk dalam exact SHA `4a1d258...` yang hidup di
staging. Ini menaikkan evidence level deployment untuk tree tersebut, tetapi
tidak menutup status agregat C9/C12 atau mengubah skor **58/100**. Tidak ada
legacy media audit, payment/legal/incident/DR, production E2E, atau
operational-cycle evidence baru.

## Verified, local-only, dan external/missing

### Verified

- Exact-SHA Reviewer PASS dan bus history untuk task pada tabel di atas.
- Current source/diff untuk E4/E8 canonical code dan matrix current state.
- Latest local full suite authoritative pada accepted C9 evidence
  `0b2985cb...`: **1.135 total / 1.091 pass / 0 fail / 44 skip / 0 cancelled /
  0 todo**. Empat skip adalah test QCF1 yang sudah ada: artefak historis PALSU
  `/tmp/bikinfyp-audit.r8g5CW/c-no-face-2.5.png` tidak tersedia; tiga di
  antaranya juga memerlukan opt-in eksplisit untuk panggilan Gemini berbayar.
  Empat puluh skip lain adalah gate PostgreSQL generic tanpa `UJI_PG_URL` (D2,
  money/reconciler, dan W1); gate W1 dijalankan terpisah terhadap database
  disposable dan lulus **29/29**. Task tidak mengizinkan panggilan berbayar
  maupun membuat artefak pengganti. Ini membuktikan hasil lokal Builder, bukan
  eksekusi dependency-backed pihak kedua.
- Exact evidence C9 yang sama mencatat affected **19/19**, W1 **29/29**,
  `tsc --noEmit`, build, dan audit katalog semuanya PASS. Database PostgreSQL
  loopback disposable dibuat, dimigrasi, lalu dihapus dengan
  `DROP ... WITH (FORCE)` dan residue katalog nol.
- Accepted C12 evidence `2073ba84...` mencatat targeted **56/56**, W1
  **28/28**, money **11/11**, full **1.133 total / 1.090 pass / 0 fail / 43
  skip**, TypeScript/build/catalog PASS, retry/prune PostgreSQL PASS, dan
  residue nol. Cleanup hanya menghapus target tracked sesudah non-winner
  dibuktikan authoritatively; commit/network/CAS ambiguity mempertahankan key.
  Setelah commit sukses, pruning hanya menghapus surplus yang tidak ada pada
  manifest committed, termasuk retry `40001`, sehingga winner tetap utuh.
- `git diff --check` dan dependency-free checks dapat diulang tanpa network.
- Artefak staging 22 Agu memiliki provenance tersanitasi. Refresh read-only
  24 Agu mengonfirmasi deployment lama itu masih live; keduanya tidak
  membuktikan current accepted tree telah di-deploy.

Latest staging evidence yang authoritative adalah bundle managed
`docs/evidence/P0-03/managed-staging-exact-sha-20260824/`. Web dan worker live
di exact accepted `4a1d258155b128fee0fcd5a6143198f36a558163`, `autoDeploy=no`,
tidak suspended, dan health 200 tiga kali berurutan. Semua 35 migrasi hidup.
Probe menjawab secara managed bahwa web punya ffmpeg/ffprobe tetapi tidak punya
tesseract, sehingga `mampu=false`. Bukti ini menggantikan snapshot read-only
lama sebagai keadaan current, tetapi jawaban negatif classifier dan ketiadaan
valid-product E2E menahan skor di 58/100.

Production juga mempunyai refresh read-only tersanitasi di
`docs/evidence/P0-03/production-20260824/`, dengan provenance di `MANIFEST.md`
dan ringkasan di
`docs/evidence/P0-03/PRODUCTION-CONTROL-PLANE-READONLY-REFRESH-20260824.md`.
Web dan worker live pada SHA lama yang sama,
`00ee62efd86ae7e10453a2a1896e63b62228aa4d`; health HTTP 200 mengikat
`build_sha` itu serta melaporkan intake closed, Duitku sandbox, dan
`payments_live=false`. `/api/meta` publik menjawab 401. Tiga URL legal menjawab
200 dengan body non-kosong, tetapi availability bukan counsel signoff. Bukti
production ini juga menemukan **P1 release-control drift**: web dan worker
melaporkan `autoDeploy=yes`, sedangkan `render.production.yaml:16,:107` dan
`PRODUCTION_PROVISIONING_RUNBOOK.md:21` mewajibkan off. Ini unresolved
production configuration/control gap; ia tidak menutup external gates atau
menaikkan skor 58/100.

### Local-only

- Dokumen evidence commit sesudah deployed `4a1d258...`; tree produk yang
  dikandung `4a1d258...` sendiri sudah verified-managed di staging.
- Full npm/tsx, TypeScript, catalog, dan test dengan PostgreSQL disposable yang
  hanya dijalankan Builder. Aggregate generic latest memiliki 40 skip
  environment PostgreSQL; gate W1 yang relevan dijalankan terpisah 29/29 pada
  PostgreSQL loopback disposable. Empat skip lain adalah klasifikasi QCF1 di
  atas. Tidak satu pun skip itu boleh disamarkan sebagai deployment proof.
- Presence kredensial di laptop tidak membuktikan pasangan staging, approval
  merchant, settlement, atau kesiapan produksi.

### External/missing — pemeriksaan presence saja, nilai tidak pernah dicetak

| Input/gate | Presence/status yang diamati | Kesimpulan yang diizinkan |
|---|---|---|
| Render CLI + config | present | akses control-plane mungkin ada; bukan izin deploy |
| PostgreSQL staging | akses read-only agregat sementara terbukti dan allow-list dipulihkan kosong | DB half tersedia; audit media tetap memerlukan R2 staging yang terbukti berpasangan |
| R2 effective | endpoint/bucket empty; key id/secret nonempty | tidak ada pasangan DB+bucket yang sah untuk audit; jangan hubungkan silang |
| Duitku effective | merchant/api key nonempty; production=false; sandbox/test authority granted | bounded sandbox webhook/replay may proceed; merchant approval, production activation, real-money settlement, and go-live remain unproven/HOLD |
| Midtrans effective | rollback keys nonempty | jalur rollback sesuai ADR; bukan gateway current atau bukti settlement |
| `PAYMENTS_GO_LIVE` | false | paid public tetap tertutup |
| Ops alert | Resend key nonempty; alert destination empty | monitoring aktif belum dapat dianggap mengirim alert |
| Legal | privacy/terms/refund pages ada tetapi source menyatakan counsel review belum final | PDP/legal sign-off missing |
| Incident/DR | tidak ditemukan incident owner/runbook canonical atau drill current | external/owner evidence missing |
| Production release control | web+worker teramati `autoDeploy=yes`; committed blueprint/runbook mensyaratkan off | unresolved P1 config/control gap; HOLD sampai release owner mematikan keduanya dan bukti read-only immutable mengonfirmasi off |

Koreksi status penting: baris Payments pada board 19 Agu menyebut Midtrans
sandbox. Itu benar secara historis, tetapi current gateway decision memilih
**Duitku sebagai primary target, Midtrans rollback**
(`docs/adr/0001-gateway-duitku-midtrans-rollback.md`). Duitku sandbox/test sudah
diotorisasi; tidak satu pun gateway boleh dinilai production-live sebelum
syarat ADR dan Founder go-live terpenuhi.

## P0/P1 yang belum selesai dan batas kewenangan

| Gap | Status | Owner/authority | Artefak penutup yang dibutuhkan |
|---|---|---|---|
| P0-B2 runtime classification web | **VERIFIED_MANAGED: incapable**; prior Docker build failed at build-time `AUTH_SECRET`; secret-safe web and dedicated-worker runtime boundary now implemented and locally proven, pending exact-SHA review | Review code, then repeat managed staging build/canary with contemporaneous raw captures | `secret-safe-web-build-20260824/`: secretless build + 1,187-test proof; no managed capability/canary result yet. Prior interval-level evidence remains incomplete |
| P0-B3 angka legacy C10 | partial credential/data | Data/Release owner | DB aggregate access proven; still needs paired staging R2 and sanitized legacy audit JSON |
| T43 / P0-B4 action / P0-B5 / A1..A7 | Founder authority versioned for in-scope technical enforcement/admission; implementation coverage still partial | Reviewer dispatches bounded remaining scope | exact boundary evidence; legacy treatment remains undecided; do not infer implementation from authority |
| C2 `TYPE_MISMATCH` | local implementation, belum bounded-approved | Builder setelah scope approval | route/admission boundary + canonical code + counterexamples |
| C5 `CATEGORY_UNKNOWN`/manual review | product policy + local | Founder lalu Builder | policy manual-review tertulis dan boundary test |
| C3/C4 E1/worker enforcement | partial | Reviewer bounded task within T43; OCR policy remains Founder boundary | exact route/worker tests; E4/E8 saja sudah canonical |
| C6 OCR fail-open vs fail-closed | policy conflict | Founder | keputusan policy dan acceptance matrix selaras |
| C7 E1 resolver | dikarantina | Reviewer bounded task lalu Builder | rollback contract within scoped T43 authority + independent exact-SHA proof |
| C8 admission A1..A7 | partial | Reviewer bounded task lalu Builder | fail-closed boundary sebelum hold/enqueue di seluruh A1..A7; authority exists, implementation does not |
| C9 promo admission→output | partial; rendered behavior accepted | Founder policy | pilih `PROMO_POLICY=SNAPSHOT` (Reviewer recommendation) atau `LIVE_INTENTIONAL`; core prompt sudah admission-bound, tetapi before/deadline live dan stock live namun inert di formatter |
| C12 aggregate | partial; local admission-time identity slice closed | legacy/reason-code authority still required | new jobs sudah admission-bound; T43 technical authority exists, tetapi legacy fallback/treatment dan proposal `REFERENCE_IDENTITY_CHANGED` tidak boleh diputuskan Builder |
| C1/C13 seluruh E/A/W positif | partial/external | QA/Release | satu trace end-to-end exact evidence, bukan resolver-only test |
| Duitku production + price/COGS | sandbox/test authorized; production external/HOLD | Brian + Payments owner | sandbox webhook/replay may run now; merchant approval, final price/COGS, production activation, real-money settlement, and explicit `PAYMENTS_GO_LIVE` remain required |
| Legal/PDP | external | Brian + counsel | signed/versioned approval dan halaman tanpa placeholder |
| Monitoring/DR | external/owner | Brian + incident owner | owner, alert delivery, runbook, restore/incident drill report |
| Production auto-deploy drift | P1 external configuration/control | Release owner + Render production administrator | authorized disable pada web+worker, lalu sanitized read-only artifact `autoDeploy=no`/off untuk kedua service dan bukti tidak ada deploy tak terotorisasi |

Re-audit pada accepted baseline `0b2985cb...` membaca matriks canonical, daftar
P0/P1 di atas, dan bus history melalui C12 PASS/DONE, C9 rendered-output
PASS/DONE, serta bounded task rekonsiliasi docs ini. Sesudah rekonsiliasi ini
diterima, hasilnya:

`APPROVED_TECHNICAL_SCOPE_REMAINS = true`.

`BOUNDED_IMPLEMENTATION_TASK_CURRENTLY_QUEUED = false`.

T43 memberi authority untuk technical enforcement/admission in-scope, sehingga
Reviewer harus memilih bounded slice berikutnya dari A1–A7/P0-B4/P0-B5 tanpa
menunggu perintah `continue`. Authority bukan implementasi dan tidak memilih
legacy treatment, OCR policy, reason-code contract, atau desain A/B/C. C12
tidak membutuhkan task admission-manifest baru: slice itu sudah accepted.
Builder tidak boleh memilih promo policy, legacy treatment, mengubah reason
code, deploy, atau payments hanya karena kandidat itu tertulis.

### Founder actions yang diperlukan sekarang

Managed staging exact-SHA sudah dijalankan; authority T43 untuk enforcement
teknis in-scope sudah diterima dan direkam, tetapi enforcement belum
diimplementasikan. Keduanya bukan lagi permintaan approval terbuka. Record
immutable berada di
`docs/evidence/P0-03/managed-staging-exact-sha-20260824/FOUNDER-DECISION-UGC-AUTHORITY-UNBLOCK.md`.
Keputusan/bukti eksternal yang masih diperlukan:

1. Tetapkan `PROMO_POLICY=SNAPSHOT` (Reviewer recommendation) atau
   `PROMO_POLICY=LIVE_INTENTIONAL`; keputusan ini harus menjelaskan before
   price/deadline dan apakah stock yang saat ini live namun inert tetap inert.
2. Tetapkan treatment legacy dan urutan rollout yang belum ditentukan oleh
   authority enforcement teknis T43.
3. Tetapkan `RELEASE_OWNER`.
4. Berikan `APPROVE DISABLE PRODUCTION AUTODEPLOY` untuk web dan worker; setelah
   tindakan terotorisasi, wajib ada refresh read-only yang membuktikan off.
5. Putuskan price/COGS.
6. Tetapkan incident owner.
7. Tetapkan counsel/legal approver.
8. Gunakan authority Duitku sandbox/test yang sudah ada untuk bounded
   webhook/replay testing. Secara terpisah, merchant approval, production
   activation, real-money settlement, dan `PAYMENTS_GO_LIVE` tetap external/HOLD.

## Critical path 48 jam

Urutan ini exact terhadap dependency; waktu adalah window target, bukan janji
bahwa pihak eksternal akan selesai.

| Window | Aksi/gate | Exact artifact untuk membuka tranche berikutnya |
|---|---|---|
| Selesai 24 Agu | Deploy **accepted exact SHA** ke staging web+worker; jalankan migrasi staging sesuai blueprint | `managed-staging-exact-sha-20260824/`: deploy IDs, exact SHA web/worker, migrasi, health, classifier negatif, control-state cleanup |
| 0–2 jam berikutnya | Founder menetapkan promo policy, treatment legacy, price/COGS, release owner, incident owner, dan counsel contact; release owner mematikan auto-deploy production web+worker setelah authority | satu decision record versioned + sanitized read-only post-change artifact yang menunjukkan kedua service off dan tidak ada deploy tak terotorisasi |
| 4–8 jam | Audit legacy read-only memakai Postgres staging dan bucket R2 yang dibuktikan berpasangan | JSON signed/timestamped: total, no-photo, corrupt-column, approved, per-reason, failed-to-inspect; nol nilai credential |
| 6–18 jam | Dengan T43 technical authority yang sudah ada, Reviewer menerbitkan bounded task enforcement E1/admission; legacy treatment tetap dipisahkan sampai diputuskan | accepted exact SHA + route/worker boundary tests + independent dependency-backed run; tidak ada deploy otomatis |
| 18–24 jam | Deploy ulang accepted remediation ke staging dan jalankan positive/negative product trace | exact deploy SHA + trace C1/C3/C4/C6/C7/C8/C10/C13, zero-cost assertions, rollback/list/audit evidence |
| 0–24 jam paralel | Dengan authority yang sudah ada, jalankan Duitku sandbox webhook/replay; secara terpisah kejar merchant approval, counsel, dan incident preparation | redacted sandbox result + valid/invalid/duplicate/out-of-order webhook proof; merchant approval reference terpisah; signed legal approval; runbook+alert delivery |
| 24–36 jam | Sesudah approval dan otorisasi biaya, satu controlled production E2E OTP→topup→render→QC→delivery/refund dengan approved pricing | timestamped trace IDs, ledger reconciliation, QC audio/frame artifacts, delivery and controlled refund, exact deployed SHA |
| 36–48 jam | Independent release review dan Founder gate | Reviewer PASS atas artifact bundle + Founder `PAYMENTS_GO_LIVE`/intake decision; jika satu artifact hilang, HOLD tetap |

### Tranche skor

- **58 → maksimum code-only 70:** deployment exact-SHA sendiri sudah terbukti,
  tetapi kenaikan memerlukan remediation classifier/admission dan valid-product
  staging E2E yang accepted. Ini ceiling, bukan kenaikan otomatis 12 poin.
- **70 → 80:** hanya sesudah Duitku production/settlement/webhook/replay,
  keputusan biaya/harga, satu E2E production-like lengkap, dan intake live
  terverifikasi seperti work order `SHIP-80`.
- **80 → 100:** tidak dapat dibuka oleh sprint kode saja.

## Syarat eksplisit untuk 80 dan 100

`80/100` baru sah bila semuanya ada:

1. exact accepted SHA deployed dan terverifikasi pada web+worker;
2. bounded T43 enforcement diimplementasikan dan accepted; treatment legacy
   diputuskan dan audit legacy nyata selesai;
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

`NEXT_AUTONOMOUS_ACTION = AWAIT_EXPLICIT_POLICY_OR_EXTERNAL_AUTHORITY_RUNTIME_ARMED`.

Reviewer harus mengonsumsi DONE task ini. Sesudah itu loop boleh memilih task
baru hanya jika Founder memberikan decision artifact atau Reviewer menerbitkan
bounded approval baru. Tidak ada deploy, audit remote, paid call, secret readout,
atau policy decision yang boleh diasumsikan dari dokumen ini. Builder dan
Reviewer tetap armed; menunggu authority bukan mematikan runtime.

## Consistency checks slice ini

- Parser dependency-free membaca 13 nilai `Baru` langsung dari source board:
  `ROWS=13`, `SUM=77`; 13 row ledger dokumen ini juga `SUM=77`.
- Semua accepted code/evidence SHA pada tabel adalah ancestor
  `ACCEPTED_BASELINE_HEAD` atau identik dengannya, termasuk C12
  `57d1a348...`/`2073ba84...` dan C9 `e1e80c0...`/`0b2985cb...`.
- `git diff 4e91cf2..3d00a6c` kosong (E1 quarantine) dan
  `git diff 90e2b05..739276b` kosong (C9 proof quarantine).
- Dependency-free SHA ancestry, Markdown link-target, score-token, stale-phrase,
  and checksum checks PASS; `git diff --check` PASS. Slice ini hanya mengubah
  canonical readiness, canonical path/case matrix, dan evidence rekonsiliasi.
- Tidak ada npm/full suite yang diulang: task docs-only, dan hasil package
  lokal tidak akan mengubah tier evidence atau score.
