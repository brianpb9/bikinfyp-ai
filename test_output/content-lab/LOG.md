# CONTENT LAB — LOGBOOK PER VERSI

Aturan (permintaan Brian 2026-08-07): SEMUA percobaan dicatat — yang gagal dan
yang berhasil — beserta resep, biaya, dan verdict. Tidak ada percobaan tanpa
jejak.

Bar kualitas (Brian): very smooth AI · tidak ada AI slop · VO seperti orang
sungguhan, tidak cepat, ada jeda · realisme.

---

## Resep (versi prompt)

| Resep | Commit | Isi |
|---|---|---|
| r1 | `58e73b2` | 1-shot 15 dtk (talking_head), candid framing, DEMO_ACTION per kategori, tanpa overlay teks harga/CTA, watermark visual MASIH ada |
| r2 | `f2ff06b` | r1 + watermark visual dihapus + VO "relaxed unhurried pace, natural pauses" + anti-slop negative (no morphing/warping/uncanny/oversmoothed/flicker) |
| r2.1 | `53c3a82` | r2 + foto referensi aman-orang (auto-crop foto ber-model → kain saja) |
| r3 | `fde7549` | r2.1 + fix catatan Brian 2026-08-07: anti tangan-ganda, label produk stabil, demo beauty di punggung tangan (bukan wajah), fashion background kamar |
| r4 | `b8f87c5` | r3 + harga dialog TERBILANG (terbilang.ts) + kemasan utuh fisik (anti pipet/tutup ganda) |

## Percobaan

| # | Varian (folder) | Resep | Persona / Produk | Hasil render | Biaya | Verdict |
|---|---|---|---|---|---|---|
| 1 | `hijaber-candid` | r1 | Hijaber / SKIN1004 | ✅ BytePlus, 1 karakter, swatch nyata, rak buku | ~Rp8rb | Max: ~8/10. Brian: masih ada AI slop (tangan kanan ganda saat pegang produk + sentuh muka) |
| 2 | `genz-r2` | r2 | Gen-Z / SKIN1004 | ✅ label CENTELLA tajam, ruang tamu | ~Rp8rb | Brian: tulisan produk suka hilang/kedip (label tidak stabil) |
| 3 | `ibu-r2` | r2 | Ibu / SKIN1004 | ✅ close-up aplikasi serum | ~Rp8rb | — (menunggu) |
| 4 | `_GAGAL-fashion-r2-mock` | r2 | Hijaber / Gamis Elzatta (foto ber-model) | ❌ BytePlus TOLAK semua foto ("may contain real person") → dev jatuh ke MOCK (video pan + teks besar). JANGAN dinilai — bukan output BytePlus | Rp0 | Insiden → melahirkan pipeline aman-orang |
| 5 | `fashion-r2b` | r2 | Hijaber / Gamis (crop kain manual) | ✅ try-on full-body, warna & lengan balon akurat | ~Rp8rb | — |
| 6 | `fashion-r2c-autocrop` | r2.1 | Hijaber / Gamis (foto model mentah → auto-crop) | ✅ bukti pipeline aman-orang end-to-end (3 foto di-crop otomatis) | ~Rp8rb | — |
| 7 | `avatar-experiment` | — | Wajah AI (frame render sendiri) sebagai referensi identitas | ❌ DITOLAK — "may contain real person" (detektor tak membedakan wajah asli vs AI) | Rp0 | Kesimpulan: referensi wajah = jalan buntu di BytePlus |
| 8 | (ff-test, tanpa folder) | — | Frame render sendiri sebagai first_frame (uji konsistensi 30 dtk) | ❌ DITOLAK — sama | Rp0 | Wajah AI dibatasi 15 dtk sampai ada solusi |
| 9 | `beauty-chindo` | r2.1 | Chindo / SKIN1004 | ✅ wajah K-beauty dewy, ruang makan | ~Rp8rb | — |
| 10 | `fashion-dress-genz` | r2.1 | Gen-Z / Neck Ruff Dress (Thenblank) | ✅ try-on dress hitam, hang tag "Thenblank" terbaca, ruang hidup | ~Rp8rb | — |
| 11 | `fashion-pria` | r2.1 | Pria / Jubah Elzatta | ✅ full-body pria MEMAKAI jubah, bordir emas akurat, rumah Indonesia autentik | ~Rp8rb | — |
| 12 | `ads-preview` | — | Aset kartu AI UGC Ads (hijaber + HP) | ✅ dipakai di halaman jenis | ~Rp6rb | Terpasang |
| 13 | `r3-verify-beauty` | r3 | Hijaber / SKIN1004 | ✅ anatomi BENAR (2 tangan, demo tetes di punggung tangan — fix tangan-ganda BEKERJA); label tajam di dtk 7 tapi rusak di dtk 10 (flicker label BERKURANG, belum tuntas — batas model) | ~Rp8rb | Max: anatomi lolos, label = isu terbuka |
| 14 | `food-lokal` | r3 | Lokal (Dina) / TaoKaenoi Seaweed | ⚠️ render bagus (senyum, snack hijau, ruang hidup) TAPI TEKS MEREK SALAH: "Hi Tempura" bukan "TaoKaenoi" — cuma 1 foto referensi (CENTELLA akurat dengan 3 foto) | ~Rp8rb | Pelajaran: foto referensi minimal 2-3 utk fidelitas merek |
| 15 | `gadget-genz` | r3 | Gen-Z (Zea) / Earphone Rexus EZ4 | ✅ pegang earphone, rak funko+buku, natural | ~Rp8rb | — |
| 16 | `home-ibu` (deskmat) | r3 | Ibu / Deskmat anime JJK | ❌ DITOLAK moderasi COPYRIGHT (artwork anime berlisensi Gojo&Geto) → dev jatuh ke mock. Pelajaran: produk ber-IP karakter bisa ditolak | Rp0 | Diganti #17 |
| 17 | `home-ibu-v2` | r3 | Ibu / Kursi gaming Rexus R45 | ✅ kursi hitam + logo & hang tag REXUS terbaca, latar kamar anak (pas persona ibu) | ~Rp8rb | — |
| 18 | `r4-verify-harga` | r4 | Hijaber / SKIN1004 | ✅ harga terucap benar "seratus lima puluh sembilan ribu rupiah", kemasan utuh | ~Rp8rb | Max: lolos, deploy `b8f87c5` |
| 23 | `r5-verify-tts` | r5 | Hijaber / SKIN1004 | ✅ END-TO-END: VO Gemini TTS (Aoede) menggantikan audio embedded, QC-10 label PASS (production pipeline lengkap) | ~Rp8rb | Deploy `0dce3f9` |

### Jalur 2.0 (adopsi sistem FYP model 2.0 — sore)

| # | Varian | Hasil |
|---|---|---|
| 19 | `chain-exp` | ✅ BUKTI KUNCI: Seedance 1.0 MENERIMA frame berwajah (yang menolak hanya dreamina 2.0) — rantai Seedream still→i2v jalan; wajah Salma terkunci; cacat: bingkai HP dari kata "iPhone still" (fixed) |
| 20 | `multishot-exp` | ✅ dreamina render "Shot 1..Hard cut..Shot 4" dalam 1 generate 15 dtk bersuara — cut sinematik + lip-sync + orang sama (macro pipet level iklan) |
| 21 | `tts-beauty-salma` (REVIEW #14) | ✅ jalur 2.0 penuh + VO Gemini TTS "Aoede"; wajah = Salma; ⚠️ label CENTELLA rusak di still Seedream ("CAILLLA") — fidelitas label jalur 2.0 < dreamina r2v |
| 22 | `tts-fashion-zea` (REVIEW #15) | ✅ avatar MEMAKAI dress produk (Seedream mendandani), full-body kamar, dress akurat; VO "Leda" |

**Insight pembagian jalur:** Jalur 2.0 unggul utk FASHION (garmen dipakai avatar, tanpa kebutuhan label teks) + suara terkunci per avatar (Gemini TTS `gemini-3.1-flash-tts-preview`); dreamina unggul utk produk BERLABEL (r2v multi-foto menjaga teks label) + lip-sync. TTS: harga otomatis terbilang via terbilang.ts.

## r13 — Fix akar 3 bug Brian (video Wardah 30dtk REVIEW #23): opener statis, label tak kebaca, VO putus di dtk 20

Brian nonton `23-beauty-wardah-hijaber-30dtk.mp4` dan lapor 3 masalah konkret (bukan spekulasi). Root cause + fix per item:

1. **"kenapa ada gambar wardah di depan?"** — shot pembuka hands_only diam ~2-3 dtk sebelum tangan "masuk" (model idle di seed image). Fix: prompt shot 1 diubah jadi "video starts ALREADY in motion... NOT a static product photo, no frozen opening beat" (`shot-planner.ts`).
2. **"masih ada tulisan yang ga kebaca (pakai sampe 10 foto referensi)"** — diuji: dari 6 foto folder lab-wardah, HANYA 3 valid (1 tekstur tanpa produk, 1 wajah model, 1 produk SALAH/beda varian dibuang — lihat item pembelajaran r10 soal kualitas>kuantitas). Extra reference images `MAX_IMAGES` dinaikkan 5→8 (dites langsung ke BytePlus API, diterima) supaya app tidak lagi memotong foto valid Brian secara diam-diam.
3. **"VO hanya sampai detik 20 padahal video 30 detik"** — kalkulasi kata/dtk skrip masih dikalibrasi buat audio embedded lama (~1.07 kata/dtk); Gemini TTS TERUKUR ~1.93 kata/dtk (skrip Wardah nyata: 38 kata = 19.72 dtk pas video 30 dtk = VO mati 10 dtk terakhir). Fix: batas kata tier bersuara `templates.ts`/`validator.ts` dinaikkan [10,22]→[20,34].

**Verifikasi render ulang (job `45fe92ad`, BytePlus asli, 3 foto kurasi, Rp16.676):**
- ✅ Bug #3 FIXED — audio jalan 0→28.5 dtk (dulu putus di 20 dtk dari 30 dtk; sisa 1.5 dtk senyap = ekor alami VO, bukan bug).
- ✅ Bug #1 FIXED SECARA PRAKTIS — frame ke-0 (1/30 dtk, seed image i2v — struktural, bukan bisa dihilangkan total) masih identik foto referensi, TAPI tangan sudah bergerak & memegang produk sejak 0.5 dtk (dulu diam ~2-3 dtk). Evidence: `frame_1.png` (t=0, statis) vs `frame_2.png` (t=0.5dtk, sudah bergerak).
- ⚠️ Bug #2 PARSIAL — shot 1 (0-15dtk, "product held to camera") label TAJAM & terbaca sempurna di semua sampel (evidence: `qc03_shot0_0.png`). TAPI shot 2 (15-30dtk, beat "demonstrating the product in use") label KETUTUP JARI + sudut kamera jauh dari label saat aksi pipet — QC-10 gagal ("token merek tidak terbaca di 8 frame") DAN QC-03 gagal (bottle look berbeda dari shot 1, evidence `qc03_shot1_0.png`). Root cause BARU ditemukan: prompt beat shot-2 hands_only ("Hands demonstrating the product in use...") TIDAK PERNAH punya instruksi "label facing camera" seperti shot 1 & closing beat — cacat desain prompt, bukan limitasi model. Fix diterapkan: tambah instruksi eksplisit "bottle stays angled so its label keeps facing camera... fingers never cover the label" ke beat tsb (`shot-planner.ts`).
- QC-09 gagal juga (skor 0.71) di `qc09_s0_1.png` — dicek manual: TIDAK ADA WAJAH di frame itu, cuma tangan+produk. False positive YuNet YANG SAMA seperti item #16 (kejadian ke-2, ambang masih belum diubah — dipantau).

Job job ini di-REFUND otomatis (benar, kredit balik ke user). Render verifikasi berikutnya (setelah fix shot-2) akan dicatat sebagai entri terpisah.

**Verifikasi RONDE 2 (job `6c58385b`, fix label shot-2 diterapkan, Rp16.676):**
- ✅ Fix shot-2 BEKERJA SECARA VISUAL — label "Wardah Lightening Serum Ampoule" tajam & tak lagi ketutup jari di kedua shot (evidence: `qc03_shot1_0.png`, `f0.55.png`). Regresi shot-2 dari ronde 1 (label ketutup jari) TERBUKTI teratasi.
- ❌ QC-10 TETAP FAIL — "token merek tidak terbaca di 8 frame sampel", padahal visual manusia 100% terbaca di semua 8 titik sampel yang sama.
- **ROOT CAUSE BARU (dibuktikan, bukan dugaan)**: dijalankan Tesseract PERSIS command yang dipakai `qc.ts` (`tesseract f0.55.png stdout -l eng --psm 11 tsv`, plus pass-2 threshold) langsung di frame sampel QC-10 (t=16.5dtk) yang manusia baca jelas "Wardah"/"Lightening" — HASIL OCR MURNI SAMPAH ("th", "O", "4m", "ria", dst, 0 token cocok) di KEDUA pass. Wordmark "Wardāh" pakai font geometris custom (macron di atas "a", huruf menyatu/kondensat) yang secara sistematis tidak terbaca Tesseract meski tajam & stabil di video. Ini LIMITASI OCR ENGINE terhadap font brand tertentu, BUKAN cacat generate AI (pola sama seperti item #16 QC-09 & item #17 QC-03 — heuristik under-validated bikin false-positive, kejadian ke-3 hari ini).
- QC-09 & QC-03 juga fail lagi di ronde ini (skor YuNet 0.63, antar_shot_max=25.2) — pola false-positif yang sama, belum digarap (di luar scope 3 bug yang dilaporkan Brian).
- **Keputusan Max**: TIDAK mengubah ambang/logika QC-10 sepihak — itu gate permanen yang Brian sendiri tetapkan ("AI SLOP JANGAN ADA DISINI JANGAN ADA DIKEMUDIAN HARI", r5). Perlu keputusan Brian: ganti/tambah OCR engine (mis. cloud Vision API utk wordmark bergaya) vs terima video ini lolos manual utk merek berfont custom vs opsi lain. Job direfund otomatis (benar).

## r16 — Product Proof Insert DIHAPUS TOTAL (Brian: "tidak ada lagi foto real produk... di video manapun")

Setelah r15 deploy (proof-insert diperluas ke hands_only + fix bug trim), Brian nonton render final dan komplain: frame terakhir video (yang sengaja diisi foto asli produk sebagai "jaminan label 100% benar") adalah foto yang sama yang dipakai jadi foto pembuka — dan Brian tegas: fitur "product proof insert" ini DIHAPUS TOTAL, BUKAN cuma foto tertentu, BUKAN cuma format hands_only — berlaku ke SEMUA video, semua format, permanen ("kan sudah saya bilang mau di video manapun" — instruksi standing yang berlaku umum).

**Dampak**: seluruh mekanisme r9 (talking_head, dari kemarin) DAN r15 (hands_only, hari ini) dicabut sepenuhnya:
- `shot-planner.ts`: `PRODUCT_PROOF_INSERT_SEC` & `reserveProof` dihapus — `perShot` balik ke `durationSec / numShots` polos untuk SEMUA format.
- `worker.ts` + `postgres/worker.ts`: blok penyisipan `buildProductProofClip` dihapus — `clipPaths` cuma dari `video.assets`, tanpa tambahan.
- `lib/media/product-proof-insert.ts` dihapus (file + fungsi `buildProductProofClip`, `trimShotsForProofInsert`).
- `VisualSpec.hasProofInsert` dihapus dari tipe & semua call site test.
- Test durasi hands_only 30/45dtk balik ke assert 15dtk/shot polos (bukan 14.25/14.5).

**Konsekuensi terbuka**: video sekarang 100% AI-generated lagi tanpa jaminan matematis — masalah "label kadang gibberish" (r5-r15) balik jadi murni probabilistik, andalan QC-10 (OCR) + prompt fidelity saja. Belum ada solusi pengganti untuk jaminan 100% — didiskusikan lagi kalau perlu.

**Yang TETAP dipertahankan dari r15** (tidak ditolak Brian, terbukti evidence-based independen): kalibrasi ulang ambang QC-09 (0.6→0.8, 4 false-positive terbukti + 2 wajah asli terkalibrasi), riset "ganti model tidak akan menyelesaikan" (masih valid sebagai temuan, cuma solusinya bukan proof-insert).

## r15 — "tulisannya masih jelek, ganti model?" — riset + jaminan matematis + 2 bug tersembunyi ditemukan

Brian tanya apa perlu ganti provider video-gen. Riset web (Aug 2026): limitasi rendering teks/label kecil berlaku LINTAS SEMUA model besar (Kling v3, Veo 3.1, Seedance 2.0) — bukan kelemahan BytePlus spesifik; tools e-commerce khusus pun mengonfirmasi ini "hard constraint" industri. Ganti model TIDAK akan menyelesaikan. Solusi nyata: perluas "Product Proof Insert" (r9, sudah terbukti jalan di talking_head — foto ASLI produk 1.5dtk disisipkan di ujung, jaminan matematis bukan probabilistik) ke hands_only juga.

**Bug tersembunyi #1 (ditemukan saat implementasi)**: provider BytePlus HANYA terima durasi bulat (`Math.ceil` di byteplus.ts) — shot yang diminta 14,25dtk (hasil reservasi 1,5dtk buat proof insert) SELALU pulang ~15,1dtk. Reservasi shot-planner jadi sia-sia, dan trim akhir compositor (motong dari BELAKANG ke durasi target) memakan HABIS klip proof yang seharusnya jadi jaminan. Video pertama (job `5a0cc48a`) lolos QC-10 tapi TERNYATA proof clip-nya tidak pernah muncul di video final — cuma kebetulan lolos. Fix: `trimShotsForProofInsert` — potong paksa tiap shot ke durasi rencana PERSIS SEBELUM concat. Diverifikasi manual (gabung ulang klip persis logika compositor): foto asli sekarang KONSISTEN muncul utuh di frame terakhir.

**Bug tersembunyi #2 (ditemukan saat verifikasi ulang)**: QC-09 (deteksi wajah YuNet, ambang 0.6) — 4 false-positive TERBUKTI hari ini di render hands_only bersih (skor 0.61/0.63/0.63/0.71, semua dicek manual = TIDAK ada wajah, cuma pola kulit tangan/buku jari kena salah baca). Dikalibrasi ulang pakai 2 foto wajah asli sungguhan (dari sesi Wajah AI hari ini): skor wajah nyata 0.91 & 0.93 — gap lebar ke false-positive tertinggi (0.71). Ambang dinaikkan 0.6→0.8, diverifikasi ulang: wajah asli tetap terdeteksi (faces=1), 4 frame false-positive semua sekarang faces=0.

**Verifikasi render (job `b4b5ae7f`, setelah fix trim + SEBELUM fix ambang QC-09)**: QC-10 PASS, QC-03 PASS, QC-05 (durasi) PASS persis 30.00dtk — HANYA QC-09 gagal (false-positive ke-4). Setelah fix ambang, semua 4 frame false-positive di hari ini diverifikasi ulang PASS. Render full end-to-end (semua fix + ambang baru) masih perlu 1x lagi buat bukti gate-hijau-total.

**Bonus**: dicek langsung ke API Ark (BytePlus ModelArk) pakai key produksi sendiri — `dreamina-seedance-2-5-260628` TERSEDIA & aktif (rilis 2026-06-30), belum diuji kualitasnya. Belum diputuskan ganti default.

## r14 — Fix akar 2 sisa keluhan (screenshot Brian: foto pembuka + "W" Wardah kepotong/"Ampule" typo)

Setelah r13 deploy, Brian screenshot video hasil r13 dan masih komplain 2 hal + minta cari foto referensi lebih bagus (5 kandidat dilampirkan). Investigasi menemukan 3 ROOT CAUSE BARU, dua di antaranya bug nyata di luar dugaan awal:

1. **BUG NYATA #1 (dev-only, tidak pernah kena user asli)**: `content-lab.ts` filter foto pakai regex `/\.(jpe?g|png)$/i` — TIDAK match `.webp`. Folder `lab-wardah` isinya 1 `.png` + 2 `.webp` tapi SEMUA render "3 foto kurasi" di r13 sebenarnya cuma kirim **1 foto** (dua `.webp` diam-diam ke-drop). Semua klaim "diuji dengan 3 foto" di catatan r13 harus dikoreksi — cuma valid untuk kasus 1 foto. Fix: regex ditambah `webp`.
2. **BUG NYATA #2 (PRODUKSI, kena SEMUA user asli!)**: Ternyata `MAX_IMAGES` backend sudah dinaikkan 5→8 di r13, TAPI halaman upload asli (`app/bikin/produk/page.tsx`) punya angka `5` HARDCODE terpisah (4 lokasi: cap pemilihan file, pesan error, label "(x/5)", tombol tambah foto) yang TIDAK PERNAH ikut naik. Artinya **user asli sampai sekarang masih mentok di 5 foto**, persis keluhan awal Brian ("kasih 10 kalau perlu") — fix backend r13 TIDAK PERNAH benar-benar sampai ke tangan user. Fix: satu konstanta `MAX_PHOTOS=8` dipakai di semua 4 lokasi (+ pesan error API `products/route.ts` yang juga masih hardcode "maksimal 5 foto").
3. **Root cause visual (bukan bug kode, bug pemilihan referensi)**: foto referensi #1 (primary = seed frame i2v) SELALU foto studio bg-putih terisolasi → frame pertama video SELALU terlihat seperti "foto katalog", walau tangan sudah bergerak sejak 0.5dtk (fix r13). Brian screenshot persis frame 0:00 dan bilang "foto ini ga penting". Fix: pakai foto TANGAN MEMEGANG produk (bukan studio) sebagai foto PERTAMA — 2 foto UGC asli dari Brian (background kain, natural) dipasang sebagai primary+extra kedua.
4. Screenshot kedua Brian: "W" Wardah kepotong tepi frame + teks jadi "Ampule" (bukan "Ampoule") — prompt shot demo TIDAK PERNAH eksplisit minta seluruh botol+label tetap DALAM frame, dan tidak ada instruksi "eja PERSIS sama". Fix: `IDENTITY_INSTRUCTION` (dipakai semua beat) ditambah "seluruh botol & label selalu penuh di dalam frame, tidak pernah kepotong" + "eja PERSIS sama, jangan diubah/typo".

**Verifikasi render (job `4cbcff19`, 4 foto unik — 2 UGC tangan Brian + 2 studio, gratis dari duplikat karena 2 dari 6 kandidat awal ternyata byte-identical):**
- ✅ Bug pembuka FIXED SECARA STRUKTURAL — frame ke-0 (t=0.00) SEKARANG langsung menampilkan tangan memegang produk (lantai keramik, cahaya natural), BUKAN lagi foto studio statis. Evidence: `frame_1.png`.
- ✅ Bug crop+typo FIXED — "Wardah" utuh & benar eja di margin penuh kedua sisi, di KEDUA shot (evidence: `frame_3.png` shot 1, `frame_5.png` shot 2 — background beda, tetap tidak kepotong).
- ⚠️ QC-10 & QC-09 tetap fail di gate otomatis — POLA SAMA seperti r13 ronde 2 (limitasi Tesseract font custom + YuNet false-positive), BUKAN regresi baru. Job REFUND otomatis (benar, kredit balik). Keputusan QC-10 dari r13 (OCR engine) masih terbuka, belum diputuskan Brian.

File dikasih langsung ke Brian buat ditonton (bukan lewat app karena masih ke-refund otomatis oleh QC-10).

## Koreksi review 2026-08-07 malam (creative-director)

17. Review formal (3 agent independen) menemukan skor terendah di "fidelitas produk" (3/10) dengan bukti "earphone berubah model" di gadget-genz frame_07s vs frame_10s. **Dicek ulang manual oleh Max: SALAH BACA** — itu earphone yang SAMA diputar di tangan (sisi driver metalik jadi terlihat), bukan produk berbeda. TIDAK dibangun check CV baru berdasarkan ini (pelajaran hari ini: check yang dikalibrasi tanpa kasus gagal tervalidasi = false-positive baru, sudah terjadi 2x di QC-09/QC-03). Skor 3/10 fidelitas produk dari review formal perlu dikoreksi turun bobotnya — root cause klaim itu tidak valid.

## Temuan lepas: QC-09 false positive (Tangan+VO)

16. Render Wardah 30 dtk (`b4d55260`) ditolak QC-09 ("wajah terdeteksi skor 0.63") — dicek manual: KEDUA frame yang jadi bukti sama sekali tidak ada wajah, cuma tangan+produk. False positive detektor YuNet (skor tipis di atas ambang 0.6, kemungkinan salah kira pola kulit jari). Kredit refund otomatis (benar). Belum diubah ambangnya (baru 1 kejadian) — dipantau, retry generate baru sebagai mitigasi langsung.

## r10 — Eksperimen terkontrol: 5 foto studio RESMI (bukan lifestyle) vs 3 foto lama

13. Brian: "bukan itu salah, maksud saya pastikan produknya tidak AI slop, foto referensi kamu harus banyak." Ditemukan: SEMUA tes r1-r9 pakai 3 foto YANG SAMA (lifestyle, angle mirip) — belum pernah dites foto benar-benar beragam/lebih banyak. Diunduh 5 foto STUDIO RESMI SKIN1004 (flat lay putih, straight-on, pro lighting) dari skin1004.com — kualitas jauh lebih baik dari 3 foto lama.
14. **Hasil: LEBIH BURUK.** Brand name yang sebelumnya SELALU benar ("CENTELLA") jadi salah ("SKNTELLA") dengan 5 foto beragam. Hipotesis: referensi yang gaya/pencahayaan/background-nya SANGAT beda (studio putih vs lifestyle) membingungkan conditioning model r2v, bukan membantu. "Lebih banyak/lebih bagus foto" TERBUKTI bukan solusi — bahkan kontraproduktif di kasus ini.
15. **Kesimpulan final**: Product Proof Insert (r9) adalah satu-satunya jaminan yang benar-benar bekerja — real pixel, bukan probabilitas. AI-generated mid-video tetap probabilistik dan TIDAK BOLEH dijadikan satu-satunya sumber kebenaran label.

## r9 — Product Proof Insert: jaminan label 100% (deploy `c3b8009`)

11. **"kamu harus perbanyak referensi foto produk"** (screenshot label gibberish BERULANG) — dijawab dengan bukti: produk sama, 3 foto, tetap gagal (sudah diuji r4-r8). Solusi permanen: **jaminan matematis, bukan prompt-tweak**. Wajah AI kini 13.5 dtk AI + 1.5 dtk FOTO ASLI produk (piksel nyata, zoom halus, letterbox) disisipkan di ujung sebelum CTA. Label 100% benar SELALU karena bukan hasil generate. Total tetap 15.0 dtk persis.
12. **Efek samping ditemukan saat verifikasi**: Gemini TTS sempat 503 ("high demand") dan menggagalkan job WALAU video BytePlus sudah sukses (~Rp8rb kebakar sia-sia, tanpa retry). Ditambahkan retry 3x backoff (2s/5s/10s) untuk 429/5xx.

## r7/r8 — Super HQ = presenter/lipsync premium + fix label AI-slop (deploy `76ce866`)

9. **"presenter/lipsync ya kita jual super hq itu 80rb-an, sisanya video+VO mulut nggak lipsync"** → Super HQ + Wajah AI = SATU-SATUNYA kombinasi berlip-sync asli (audio embedded dipertahankan, TIDAK diganti Gemini TTS); harga naik Rp49rb→Rp80rb. Semua kombinasi lain pakai gaya voice-over r6 (presenter tidak "bicara" sinkron). **Temuan bonus**: model Super HQ (non-mini) jauh lebih presisi label produk — REVIEW #19 label 100% benar + lip-sync terbukti.
10. **Screenshot label gibberish ("BNIGHTENING"/"CASSULE") → "apakah perlu lebih banyak referensi?"** Jawaban: TIDAK — limitasi model, bukan data (produk sudah pakai 2-3 foto). Fix r8: hanya wordmark besar dituntut tajam, teks kecil diarahkan blur alami. Hasil verifikasi tier HQ: PARSIAL (beberapa baris membaik, sebagian masih meleset) — Super HQ (r7) mengatasi lebih tuntas. Opsi belum dieksekusi: "product proof insert" (splice foto asli 0.5-1dtk) untuk fidelitas 100% di semua tier.

## r5 — TTS resmi + gate anti-slop (Brian, atas screenshot label rusak)

7. **"AI SLOP JANGAN ADA DISINI JANGAN ADA DIKEMUDIAN HARI"** — label rusak (screenshot "CAILLLA", "Hi Tempura") dinyatakan TIDAK DAPAT DITERIMA permanen → **QC-10** (baru): OCR 8 titik + upscale mencari token merek asli produk; gagal di semua frame = video ditolak otomatis, tidak pernah sampai ke user. Diuji terhadap 4 video nyata sebelum deploy — 2 bagus lolos, 2 rusak ditolak.
8. **"TTS PAKE INI BAGUS, UBAH SEMUA VIDEO KITA"** → Gemini TTS (`gemini-3.1-flash-tts-preview`) jadi suara RESMI semua video production (bukan lagi eksperimen lab) — voice terkunci per avatar, menggantikan audio embedded yang acak.

## Catatan global Brian (2026-08-07 pagi)

### Ronde masukan ke-2 (siang, atas 12 video REVIEW-MP4)

5. **Pengucapan HARGA** (masalah utama semua video): "Rp299.000" dibaca ngaco — harga di dialog wajib TERBILANG ("dua ratus sembilan puluh sembilan ribu rupiah") → r4: `lib/script-engine/terbilang.ts` (hanya pola harga; kode produk SKIN1004/EZ4 aman), verifikasi #18.
6. **Slop struktur kemasan** (screenshot botol serum berpipet/tutup ganda) → r4: instruksi "packaging physically intact, one cap one dropper" + negative anti kemasan-berubah/duplikat.

1. **AI slop anatomi**: tangan kanan pegang produk + tangan kanan KEDUA muncul pegang muka → r3: demo beauty pindah ke punggung tangan (tidak menyentuh wajah sambil pegang produk), negative "no extra hands / duplicated limbs".
2. **Label produk tidak stabil** (tulisan hilang-muncul) → r3: instruksi "label stays sharp, steady, readable" + negative anti label-flicker. (Batas model — dipantau per render.)
3. **Fashion**: tanpa teks di layar (yang bertext = mock #4, bukan BytePlus) + background pindah ke DALAM KAMAR → r3.
4. **Suara**: semua video BER-suara (AAC, level normal, diverifikasi RMS + diputar via speaker) — masalah di pemutar preview, bukan file. Putar dengan QuickTime/HP.

## Pembelajaran provider (fakta keras)

- BytePlus menolak SEMUA gambar input berwajah manusia fotorealistis (foto asli MAUPUN AI), di mode reference_image DAN first_frame → identitas wajah lintas-generate tak bisa dikunci; konsistensi hanya via deskriptor teks.
- Rasio gambar referensi wajib 0.40–2.50; sisi minimal ~300px.
- Moderasi konten stokastik — render yang ditolak kadang lolos dengan skrip berbeda.
- 1 klip = 2–15 dtk; r2v minimal 4 dtk.
