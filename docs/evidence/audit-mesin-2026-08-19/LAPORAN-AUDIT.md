# AUDIT MESIN KONTEN — 19 Agu 2026 (read-only)

Metode: 3 agen eksplorasi kode independen + 1 trace generation Super HQ lokal nyata
(LLM hidup, tanpa Seedance) + query read-only DB production. Bukti = file:line,
baris DB, log run. Artefak trace: `trace-b6-scripts.json`, `trace-b6-shots.json`.

Vonis per item: WIRED / PRESENT-NOT-ENFORCED (PNE) / MISSING.

## A. Lapisan pengetahuan

| # | Item | Vonis | Bukti kunci |
|---|---|---|---|
| A1 | `knowledge/rules/standard-10.md` | WIRED §A+§B saja | dibaca `standar-10-teks.ts:24`, injeksi VERBATIM ke writer `llm.ts:134` + Idea Stage `ide.ts:346`; §C–H tidak pernah diinjeksi |
| A1 | `knowledge/formats/*.json` (8 file) | WIRED di Idea Stage saja | `format-katalog.ts:58`; planner NOL cabang untuk 8 id itu |
| A1 | `knowledge/rules.md` (aturan bahasa prompt teruji) | PNE — mati | hanya dibaca test; isinya disalin-tangan ke `llm.ts`/`shot-planner.ts` |
| A1 | `docs-sumber/*` (3 file) | tidak dibaca runtime | disalin-tangan ke `lib/templates.ts` (bisa hanyut diam-diam) |
| A2 | STANDARD-10-ugc v2 | sebagian (lihat A1) | prompt di `llm.ts:139` KLAIM 6 baris dicek mesin; validator cuma menegakkan 3 (S-04/05/09) |
| A2 | MASTER-UGC-ADS / MASTER-UGC-AFFILIATE | MISSING | tidak ada di repo; hanya di skill `.claude/` di luar app, tidak pernah dibaca runtime |
| A3 | Format | 4 nyata di planner (`hands_only/talking_head/tvc/ads`), `vo_broll` PNE (typed tanpa cabang); 8 format knowledge = prompt-only; **5 format baru (day_vlog dst) MISSING — 0 kemunculan repo-wide**; UI konsumen cuma 2 pilihan (`bikin/gaya/page.tsx:16-26`) | |
| A4 | Mode (14, kontrak kamera/talent) | MISSING sebagai sumbu — label bebas | `llm.ts:52-57` "mode cuma metadata tampilan"; planner tidak pernah membacanya; sumbu nyata satu-satunya = `RECORDING_STYLES` (6, dashboard-only) |
| A5 | Mekanik | 12 WIRED (pairing + penalti CGI ditegakkan kode `ide.ts:515-525`); `audio_shift` MISSING | |
| A5 | Anti-repeat per brand | PNE — TIDAK berbasis DB | `mekanikBaruDipakai` tidak pernah disuplai (`index.ts:601-607` tanpa field itu); `scripts` tidak punya kolom mechanic (`schema.sql:134`) |

## B. Kebenaran pipeline (trace nyata Super HQ, contentType ads, produk fixture skincare)

**B6 — hasil run (log asli tersimpan):**
- Idea Stage jalan: 12 kandidat dinilai, terbaik `anomaly_pov` skor **66 < ambang 75** → FYP Gate GAGAL 2 putaran → naskah ditulis TANPA ide; top-3 dikembalikan di `ideKandidat` (ada di payload; TIDAK dirender UI mana pun — lihat D14). Biaya tercatat: 18 panggilan, 18.945 tok masuk / 31.070 keluar.
- Writer varian-1 ditolak validator 2× (L-21 "hiding"; S-09 13 kata/6 dtk) → template cadangan ikut ditolak (A-01/A-02/L-05/S-09) → `script_source=degraded` dengan `passed:false`. Varian 2–3: `llm`, lolos. Rute generate menyaring `passed` → degraded tidak keluar (blokirnya IMPLISIT, bukan cek `=== "degraded"`).
- Segments memuat role/start/end/text/visual_direction (start_state/framing/camera/action/product_state/expression ada di skema penulis; lihat trace-b6-scripts.json).
- **Prompt provider final (shot 1)**: ✅ chest-up framing, ✅ EXACTLY ONE person, ✅ kunci identitas label (ejaan persis), ✅ margin frame penuh; ❌ blok bahasa hanya 1 lapis dari 4 (klausa "casual Indonesian" di shot bicara saja), ❌ "no English dialogue" TIDAK ADA, ❌ kunci ukuran-asli produk (§C.10) TIDAK ADA, ❌ frasa CTA tidak dikomposisi builder (hanya gema teks segmen), ❌ shot-1 no-face tidak berlaku (hanya talking_head multi-shot, 4 pengecualian, prompt-only tanpa cek pasca-render).
- **DEFECT BARU (dari trace)**: prompt final memuat literal `"undefined, undefined"`, dan `negativePrompt` diawali `"undefined, "` — interpolasi variabel bocor di `shot-planner.ts` jalur format `ads`. Terkirim apa adanya ke provider.

**B7 — Story OS Ads: MISSING.** Nol kemunculan Button-first/friction/spike/witness/bridging sebagai konsep struktur (grep semua varian ID/EN). Penulis Ads = HOOK→BODY→CTA polos (`llm.ts:118-125`); satu-satunya tuntutan khusus Ads = kalimat CTA persis (`llm.ts:314-316`). Pengganti terdekat: 12 mekanik + tuntutan setup→tension→payoff di Idea Stage (`ide.ts:339`) — kritik LLM, hard saat jalan, tapi **opsional & tier-gated** (super_hq/org saja; gagal = lanjut tanpa ide, `index.ts:592-594`).

**B8 — Tabel gerbang × jalur** (semua jalur masuk 1 validator; `SELALU_KERAS` `validator.ts:349-355` membuat mode "light" tidak lebih longgar):

| Gate | P1 generate | P2 approve | P3 /api/jobs | P4 render-cell |
|---|---|---|---|---|
| L-03 CTA per content_type | HARD | HARD | HARD | HARD |
| L-05 anggaran kata | HARD | HARD | HARD | HARD |
| L-19 device | HARD (komentar di kode BASI bilang warning) | HARD | HARD | HARD |
| L-21 pemicu — level skrip | HARD | HARD | HARD | HARD |
| L-21 pada PROMPT FINAL + negatif | n/a | n/a | n/a | SPLIT: negasi-orang HARD (`worker.ts:444`), kosakata WARN-only (`worker.ts:436`); `vo_broll` skip total |
| Kunci bahasa 4 lapis / no-English | MISSING | MISSING | MISSING | MISSING (klaim `penegakan:"kode"` di `standar-10.ts:51` SALAH; L-22 cuma tolak non-Latin — skrip full Inggris LOLOS) |
| brand-confirmed | MISSING | MISSING | MISSING | MISSING (dibaca hanya saat render utk downgrade QC-F1) |
| QC-F1 PASS utk referensi | n/a | n/a | n/a | HARD sbg gerbang referensi / job TIDAK gagal (`worker.ts:179-183`) |
| script_source=degraded diblokir | implisit (filter passed) | MISSING | MISSING | MISSING — `bacaJejak` membawa nilainya, TIDAK ADA cabang `==="degraded"` di jalur produksi |

## C. Frame / referensi / fidelitas

| # | Item | Vonis | Bukti |
|---|---|---|---|
| C9 | brand-confirmed at intake | MISSING total | **PROD: 53 produk, 0 punya `raw_meta.brand`** (query 19 Agu); tak satu rute pun menulisnya; migrasi `0033_products_brand` baru ada LOKAL-uncommitted (head prod = `0032_job_prompts`); worker pun tidak SELECT `p.brand` |
| C10 | Klasifier promo-graphic vs foto produk | MISSING | hanya gerbang keterbacaan OCR (`label-terbaca.ts:59`) yang (a) DILEWATI jalur utama wizard (`POST /api/products` tidak memanggilnya) dan (b) fail-open saat tesseract error; wizard blok berdasarkan JUMLAH foto, bukan kelayakan |
| C11 | QC-F1 tri-state + `bolehJadiReferensi()` | WIRED sempit | hanya `hands_only` × (super_hq ∨ org) (`worker.ts:101-109`); worker SQLite tidak punya QC-F1; verdict "diarsip" dgn diselundupkan ke `job_prompts.model_params` (best-effort warn), TIDAK ADA pembaca; kolom qc_f1 yang dijanjikan komentar `worker.ts:513` tidak pernah dibuat |
| C12 | Paket CAST-REF | disk lokal `${STORAGE_DIR}/castref/` — **0 paket ada**; kunci per kategori-persona, BUKAN per 19 avatar; paket statis 19 avatar×4 img di `public/avatars/hdrv/` ada tapi `referenceImages` **tidak pernah dikonsumsi** (identitas via teks, krn BytePlus tolak wajah) |

## D. Permukaan output

- D13 dashboard campaign: WIRED utk segments per-shot + caption + hook + baris `N/12 baris standar` (`campaign/page.tsx:52-61`); `script_source` dirender hanya bila ≠ llm; **mode/format tidak digemakan di kartu hasil; skor FYP absen di campaign**.
- D14: retail `bikin/hasil` = video saja (91 baris; tanpa segmen/mode/format/ide/skor). Skor FYP tampil di `/video` (dari `fyp_snapshots`, 19 baris di prod) dan di `bikin/skrip` (dihitung client-side). **Top-3 ide saat gate gagal: MISSING di semua UI** — payload dibuat (`index.ts:668-677`), rute dashboard menghapusnya eksplisit (`campaign/generate/route.ts:172-181`), rute retail mengirimnya tapi nol komponen membacanya. Persis terjadi di trace kami: gate gagal (66), 3 kandidat mati di console.warn.

## E. Observabilitas

- `job_prompts`: WIRED live (arsip SEBELUM panggilan provider, `worker.ts:398-406`; urutan benar — prompt terblokir tetap terarsip). TAPI write-only, `ide_id/ide_skor` selalu NULL, **PROD: 0 baris** (tabel apply 18 Agu; belum ada job sejak itu — intake closed).
- fyp-gate-log: file JSONL di storage (`ide.ts:868`), write-only, tanpa pembaca, disk Render tidak awet. (Skor FYP retail yang awet = tabel `fyp_snapshots`.)
- NSFW: WIRED benar — alasan provider verbatim masuk `audit_log` (`jobs.ts:54`), refund hold 1 transaksi (`jobs.ts:66-72`, terlindung indeks unik 0031). ⚠️ `laporan-nsfw.mjs` regex `(sensitive|risk_level|content polic|nsfw)` TIDAK menangkap string BytePlus nyata "may contain real person" → KPI penolakan UNDER-REPORT persis di kelas kegagalan yang memotivasi CAST-REF.

## VONIS

**PARTIALLY WIRED — mesinnya satu tulang punggung yang nyata (validator tunggal keras di 4 jalur, Idea Stage + FYP Gate hidup, NSFW-refund rapi), dibungkus lapisan dokumen dan label yang lebih besar dari implementasinya.** Tiga jurang terbesar dokumen-vs-sistem: **(1) Kontrak bahasa & visual yang diklaim "ditegakkan kode" tidak ada di kode** — kunci bahasa 4 lapis, "no English dialogue", ukuran-asli produk §C.10, sumbu 14 mode, 14+5 format, MASTER-UGC-ADS/AFFILIATE: semuanya label, dokumen di luar repo, atau prompt 1 lapis; skrip full bahasa Inggris hari ini lolos semua gerbang. **(2) Rantai fidelitas merek putus di mata rantai pertama** — tidak ada rute yang menulis brand (53 produk prod, 0 brand), sehingga QC-F1 permanen UNVERIFIED di satu-satunya jalurnya, CAST-REF 0 paket, klasifier kelayakan foto tidak ada, dan render berbayar jalan dengan referensi tak terverifikasi tanpa memberi tahu siapa pun. **(3) Observabilitas write-only** — top-3 ide, arsip prompt, fyp-gate-log semuanya diproduksi lalu dibuang tanpa pembaca, plus regex laporan NSFW yang tidak menangkap string penolakan sebenarnya. Yang kuperbaiki pertama: mata rantai (2) — satu penulisan `brand` di intake (migrasi 0033 sudah disiapkan sesi lain, belum dicommit) menghidupkan kembali seluruh investasi QC-F1/CAST-REF yang sudah dibangun; sesudah itu bug "undefined" di prompt final (defect aktif yang terkirim ke provider hari ini) dan sinkronisasi klaim `standar-10.ts` dengan kenyataan supaya dokumen berhenti berbohong pada pembacanya sendiri.

---

# TINDAK LANJUT (eksekusi berurutan atas perintah Brian, 19 Agu malam)

Tiap butir: tes reproduce-then-fix (merah dulu, lalu hijau) + bukti.

## [C9] Merek di intake — SELESAI

- Reproduksi: `tests/brand-intake.test.ts` — 4 dari 5 MERAH pada kode lama (POST/PATCH membuang field brand; `usulMerekDariNama` masih mengusulkan "wajah").
- Perbaikan: `validBrand()` (`lib/product-validation.ts`), tulis merek ke `raw_meta.brand` di `POST /api/products` + `PATCH /api/products/[id]` (merge jsonb — `og` hasil scrape tidak tertimpa), usulan merek di respons `POST /api/products/extract`, kolom "Merek di label" di wizard `app/bikin/produk`, `pgSetProductBrand()` untuk jalur Postgres, kata anatomi ditambahkan ke `GENERIC_PRODUCT_WORDS`.
- Koordinasi: migrasi `0033_products_brand.sql` + kolom `products.brand` di `lib/db.ts` TIDAK disentuh (milik sesi lain; dikonfirmasi yatim oleh sesi hazel-35 — perlu keputusan Brian: commit atau discard). `merekTepercaya()` membaca `raw_meta.brand` sebagai fallback, jadi kedua jalur hidup berdampingan.
- Backfill produksi: 44 dari 53 produk terisi merek dari review manual nama (SKIN1004, SKINTIFIC, Wardah, CORKCICLE, Anessa, Beplain, ECINOS, YIQII, Barber Daily, Ikan Paus, JJ Glow), tercatat di `audit_log` sebagai `product.brand_backfill`. **0 → 44.** Sisa 9 = nama tak bermerek ("Produk baru", "Shopee Indonesia", "[ Beli 5 box dapat 10") → ditanyakan ke pengguna saat produk dibuka lagi.
- Bukti fungsional QC-F1 (frame nyata `glad2glow_watsons.png`, model vision sungguhan):
  - DENGAN merek → **PASS**, `temuan {bentukSama:true,tutupSama:true,warnaSama:true,tataLetakLabelSama:true,merekTerbaca:true}`, `bolehJadiReferensi: true`.
  - TANPA merek → **UNVERIFIED**, alasan "tidak punya merek tepercaya untuk diperiksa pada frame hero", `bolehJadiReferensi: false`.
  - Artinya rantai yang sebelumnya mati (audit: "permanen UNVERIFIED") kini bisa mencapai PASS.
- CAST-REF: paket belum bisa dibangun malam ini — Gemini image menjawab HTTP 503 "high demand" lalu timeout pada 7 percobaan berturut. Ini pemadaman penyedia, bukan cacat kode; diulang saat layanan pulih.

## [B6/B8] Kunci bahasa, ukuran asli, dan gerbang prompt akhir — SELESAI

- **KOREKSI AUDIT**: temuan `"undefined, undefined"` di prompt akhir adalah **artefak harness audit**, bukan bug produksi — harness mengoper `category` sebagai string, bukan objek `CreatorCategory`. Diverifikasi ulang dengan kategori asli: 0 `undefined` di 3 format. Sebagai gantinya `planShots()` kini MELEMPAR pada kategori cacat, supaya kesalahan pemanggil semacam itu tidak pernah diam-diam masuk prompt berbayar.
- Reproduksi: `tests/prompt-akhir-kunci-bahasa.test.ts` — 18 tes, semuanya MERAH pada kode lama (modul gerbang belum ada; prompt tanpa kunci bahasa/ukuran).
- Perbaikan perakit prompt (`lib/media/shot-planner.ts`): kunci bahasa **4 lapis** (header "Every spoken word is Indonesian" + penanda per shot "(Bahasa Indonesia)" + label "Indonesian dialogue" + penutup "no English speech") dan kunci **ukuran asli §C.10** (`true small size ... normal conversational distance`) di TIAP shot. "no English speech" sengaja di prompt positif — `frasaNegatifBersih()` akan membalik maknanya bila ditaruh di blok negatif.
- Gerbang baru `lib/media/gerbang-prompt.ts` dipanggil worker tepat sebelum penyedia (sesudah arsip prompt, urutan lama dipertahankan). Semua temuan KERAS: BAHASA, UKURAN, L-21-NEGASI, dan **L-21-KOSAKATA yang dulu hanya warn-only**.
- Blast radius kosakata-keras diukur sebelum dinyalakan: **0 dari 81** kombinasi (9 produk termasuk sabun mandi/shower gel/handuk × 3 kategori × 3 format) terblokir — yang menyelamatkan bukan pelunakan aturan melainkan `tutupiNama()`.
- `vo_broll` tetap dilewati, dan alasannya kini tertulis di gerbang + diverifikasi: format itu tidak memanggil penyedia video sama sekali (visualnya foto pengguna yang di-pan ffmpeg), jadi tidak ada penyaring yang bisa menolaknya.

## [A2] Honesty pass standar 10/10 — SELESAI

- Reproduksi: `tests/standar-10-klaim-penegakan.test.ts` — tiap baris yang mengaku `penegakan:"kode"` WAJIB membuktikan menolak input pelanggar. 2 MERAH pada kode lama.
- Baris 1 ("Anomali di frame pertama") diturunkan `kode` → `belum`: `anomaliTanpaKata()` ada dan punya unit test, tapi TIDAK dipanggil validator maupun Idea Stage — fungsi yang tak pernah dijalankan tidak menegakkan apa pun.
- Baris 9 kini benar-benar `kode` untuk kedua bagiannya: batas kata (S-09) + kunci bahasa 4 lapis di gerbang prompt akhir.
- Prompt penulis (`llm.ts`) diperbaiki: "Six of those twelve lines are checked MECHANICALLY" (padahal mendaftar empat, salah satunya tidak diperiksa apa pun) → "Four", dengan baris 1 ditandai sebagian (skema saja) dan baris 2 dijelaskan diperiksa di tahap ide, bukan pada keluaran penulis. Tes menahan agar angka klaim tidak boleh melebihi jumlah baris yang terbukti.
- Dua komentar validator yang basi (L-19 `validator.ts:738`, L-21 `validator.ts:769`) — keduanya berbunyi "PERINGATAN, BUKAN ERROR" padahal `SELALU_KERAS` sudah membalikkannya — ditulis ulang: perilaku hari ini di depan, sejarah alasannya dipertahankan di bawah.

Gate setelah 1–3: `tsc` bersih, **665 tes lolos, 0 gagal** (dari 631 sebelum sesi ini).

## [D13/D14 + E15] Berhenti membuang hasil kerja — SELESAI

- Reproduksi: `tests/ide-tidak-dibuang.test.ts` — 3 dari 6 MERAH pada kode lama (rute membuang top-3, UI tidak membacanya, tidak ada pembaca fyp-gate-log).
- `job_prompts.ide_id/ide_skor` kini TERISI: skor FYP Gate + identitas ide (`mechanic/format`) dititipkan ke snapshot admisi (`SnapshotAdmisi.ideSkor/ideId`) yang memang sudah ikut tersimpan di `scripts.validation_result`, lalu worker membacanya lewat `bacaJejakIde()` (toleran: baris lama/korup → null, arsip tidak boleh menggagalkan render berbayar) dan meneruskannya ke `pgSimpanArsipPrompt`. Dua kolom yang disediakan migrasi 0032 berhenti selalu-NULL.
- `app/api/dashboard/campaign/generate/route.ts` tidak lagi menghapus hasil Idea Stage: `ide_skor`, `ide_borderline`, `ide_kandidat` (top-3 + skor + sebab gagal), plus gema `mode` (dari segmen) dan `format` (dari template).
- UI `app/dashboard/(app)/campaign/page.tsx`: baris "Format · Mode · Skor ide N/100 (lulus tipis)" di tiap kartu, dan saat gate gagal muncul panel "Belum ada ide yang lolos gerbang — lihat 3 ide terbaik" berisi skor, mekanik, one-liner, dan sebab gagal per kandidat.
- Pembaca `scripts/laporan-fyp-gate.mjs` (fyp-gate-log tetap JSONL sesuai keputusan asli; yang diperbaiki: ada yang membacanya). Dijalankan pada log nyata: **5 penilaian, 0 lulus (skor 63–73, ambang 75)**, dimensi paling sering jatuh `story_pull` (2×), lalu `scroll_stop`/`distinctiveness`/`payoff`/`nativeness` masing-masing 1×.

## [E15] KPI penolakan NSFW — SELESAI

- Reproduksi: `tests/laporan-nsfw-pola.test.ts` — 3 MERAH: pola lama tidak menangkap string BytePlus asli "may contain real person" (verbatim di `lib/config.ts`, spike 17 Agu).
- Pola diperlebar (`may contain real person`, `content_filter`, `prohibited content`, `moderation`, `flagged`) dan dijaga DUA ARAH: 5 alasan kegagalan infrastruktur nyata dari `audit_log` produksi (pipeline upgrade, "belum resumable dari state …", QC retry, gerbang prompt) diuji TIDAK ikut terhitung.
- KPI dihitung ulang pada log produksi yang sama — **sebelum: 0, sesudah: 0 dari 24 kegagalan terminal**. Angkanya tidak berubah karena korpus produksi saat ini memang nol penolakan konten: 24 kegagalan seluruhnya infrastruktur (9 "pipeline upgrade", 14 "belum resumable", 1 QC). Jadi yang diperbaiki adalah alat ukurnya, bukan angkanya — dan itu terbukti lewat fixture string penyedia asli, bukan lewat klaim.

Gate setelah 1–5: `tsc` bersih, **683 tes lolos, 0 gagal**.
