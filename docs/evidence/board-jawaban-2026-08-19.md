# JAWABAN BOARD REVIEW — skor segar 19 Agustus 2026 (malam)

Menjawab `BOARD-REVIEW-bikinfyp-shipping` (Fable, 19 Agu pagi, saat produksi di
75dceed). Sejak review itu ditulis, empat batch kerja mendarat — dokumen ini
menaikkan tier tiap baris **hanya lewat bukti yang bisa dibuka** (aturan §7
board: PASS tanpa objek bukti = ditolak).

**SHA basis (jawaban §6.1):** produksi saat dokumen ini ditulis = `e5f0213`,
commit terakhir `9fb7a51` (auto-deploy Render berjalan). Semua klaim di bawah
merujuk kode di `9fb7a51`; klaim "live di produksi" hanya untuk yang sudah
terverifikasi via header/health nyata.

## 0. Yang berubah sejak board menulis

| Klaim basi di board | Keadaan sekarang | Bukti |
|---|---|---|
| "job_prompts belum ada di produksi (0032 pending)" | 0030–0032 **terpasang di produksi** | `docs/evidence/migrasi-0030-0032.md` (dry-run → apply → idempoten → artefak DB → health) |
| "Ledger audit exit 1 — 2 hold belum direkonsiliasi" | Direkonsiliasi lewat **allowlist eksplisit per-job dengan alasan** (bukan heuristik) | `scripts/audit-ledger-sebelum-migrasi.mjs` (`SUDAH_DIREKONSILIASI`), exit 0 |
| "Playwright smoke belum ada" | Ada, deterministik, di CI | `scripts/smoke-interaksi.mjs`, `.github/workflows/ci.yml`; bukti anti-false-pass: HTML statis /onboarding memuat 0 kemunculan label terhidrasi |
| "Canary = tebak-tebakan tanpa arsip" | Canary 12 klip **sudah jalan** (otorisasi Brian), 8 temuan, 3 diperbaiki hari itu juga | `docs/evidence/canary-12/LAPORAN.md` + log 3 putaran + frame .jpg |
| "Gate keras hanya di strict; light bisa render degraded" | `SELALU_KERAS` = L-03/05/10/11/13/14/19/21/22 + T-01..03 + A-01/02 + S-04/05/09 **di kedua mode**; runtime menolak render naskah degraded | `lib/script-engine/validator.ts:349`; canary: 2 klip ditolak gate **sebelum uang keluar** (kopitang-a, arva-b — Rp0) |

## 1. Papan skor segar (0–10, mulai dari 0; tier V=bukti terbuka · C=klaim builder · N=belum bisa diverifikasi)

| Domain | Lama | Baru | Tier | Bukti / kenapa tidak lebih tinggi |
|---|---:|---:|---|---|
| Money safety | 8 | **9** | V | Health live: closed/false. Migrasi fail-closed lulus + rekonsiliasi eksplisit + indeks terminal unik 0031 + uji konkurensi pg. Bukan 10: settlement Midtrans sandbox belum pernah dieksekusi (baris sendiri). |
| Auth intent & failure path | 5 | **7** | C | Jalur gagal lengkap di kode: cookie next ter-encode, Google cancel bawa `next` balik (9 call site), replaceState pertahankan next, OTP hormati `?next=` (commit `9fb7a51`). Bukan 8: belum ada bukti browser nyata untuk skenario Google-cancel — masih unit+kode. |
| Mobile UI 375 | 6 | **7** | V | QA interaksi nyata di 375px + drawer + focus trap dua arah (`docs/evidence/mobile-qa/`). Bukan 8: sapuan 768/1024 dan click-through wizard 1–6 di atas Postgres belum. |
| Hydration/interaction canary CI | 4 | **8** | V | Smoke membuktikan hidrasi lewat perubahan CTA yang mustahil terjadi di HTML statis (diverifikasi: 0 kemunculan di HTML server), dan **sudah teramati LULUS di run CI nyata** (run 32182693249, job verify SUCCESS, log "SMOKE INTERAKSI LULUS"). Bukan 9: cakupan baru landing + /coba, interaksi dashboard belum; smoke CI jalan di server dev (production menolak SQLite — fail-closed yang benar), CSP production dijaga `tests/csp-produksi.test.ts`. |
| Content engine standard | 4 | **7** | V | Gate keras kedua mode (tes), snapshot admisi beku sejak lahir, standar-10 §A/§B di prompt + 12/12 di log, canary membuktikan gate menolak SEBELUM bayar. Bukan 8: temuan #4 (nama produk panjang mengalahkan penulis 3 putaran), #8 (intake tak memeriksa foto referensi), utang copy 116 varian. |
| Brand fidelity | 5 | **6** | V | `lib/merek.ts` satu sumber (lahir dari temuan canary #2/#3), QC-10 tiga-keadaan jujur; frame bukti: "SOMETHINC" & "KOPI TANG" utuh. Bukan 7: brand belum jadi field tepercaya di intake; "Gula ARAM" (label sedang salah eja) lolos — butuh QC label penuh berbasis visi. |
| Anti-slop produksi | 5 | **7** | V/C | Chest-up default, kosakata filter dgn oracle independen 0/360 false-block, negasi-orang positif, dan **shot-1 tanpa wajah kini default multi-shot talking_head + dijaga tes** (standar-10 §E; pengecualian sadar: 15 dtk satu-shot, fashion full-body, gaya rekam, peran template). Bukan 8: masih level prompt — bukti piksel butuh canary berikutnya. |
| Prompt/verdict archive | 3 | **8** | V | 0032 live (bukti migrasi); amplop validasi + verdict QC tersimpan per job. Bukan 9: belum ada satu job produksi pasca-0032 yang dibedah ujung-ke-ujung sebagai contoh. |
| NSFW rejection | 3 | **6** | V | **Terukur**: canary 1 penolakan provider dari 11 panggilan render (~9%) vs 6/10 (60%) sebelum pembersihan kosakata — di bawah target board (≤20%/≤35%). Bukan 7: sampel kecil (n=11), auto-refund belum dilatih di jalur job nyata (canary render langsung), KPI belum formal di dashboard. |
| Payments (Midtrans sandbox) | 2 | **2** | N | Tidak berubah — menunggu Brian (settlement sandbox). |
| Legal/PDP | 2 | **2** | N | Tidak berubah — butuh counsel (Brian). |
| DR/monitoring/incident owner | 2 | **2** | N | Tidak berubah — butuh keputusan owner (Brian). |
| Landing/pricing consistency | 4 | **6** | V | §3.1 ✅ CTA loading kini tautan yang berfungsi tanpa JS + masuk smoke. §3.2 ✅ SATU sumber janji waktu (`lib/janji-waktu.ts`) — guard test menemukan **5 janji lain** yang board tak lihat, semua disatukan. §3.5 ✅ "15–30 detik". §3.3: label "Hijaber/Gen-Z/Tanpa wajah" ternyata label **video showcase nyata** (isi mp4-nya memang itu), bukan picker kategori lama — tidak diubah, dicatat untuk keputusan Brian. §3.6: jawaban FAQ = mekanisme nyata (release hold via ledger). Bukan 7: §3.4 harga Rp12.000 = keputusan Brian yang tertahan COGS (lihat §2). |

**Skor kritis terendah: 2 (Payments / Legal / DR — ketiganya N, semuanya milik Brian, bukan engineering).**
**Terendah di domain engineering: 6.** Tidak ada blocker QC/keamanan-anak/keuangan terbuka.
**Critical false pass: 0** (kriteria kunci auditor — QC-10 berkata "TIDAK TERBUKTI" alih-alih pura-pura pass).

## 2. ALARM MARGIN — data canary vs harga landing (baru, penting)

> **Diperbarui 20 Agu — satuannya DETIK, bukan klip.** Pengukuran ulang per
> tier (docs/evidence/cogs-canary-2026-08-20.md) menghasilkan tarif per detik
> yang konsisten dengan angka di bawah: high_quality Rp554/detik, jadi 15 detik
> = Rp8.313 entah dirender sebagai satu klip panjang atau tiga klip pendek.
> Angka "Rp2.771" yang muncul di catatan 20 Agu adalah klip 5 detik pada tier
> yang SAMA — bukan tarif yang berbeda, bukan klip bisu.
>
> **Margin retail dipatok pada angka terukur: ~25%** (Rp3.000 dari Rp12.000),
> sesudah memotong frame buatan ±Rp650 dan QC vision ±Rp12 seperti hitungan di
> bawah. Angka 31% yang sempat saya tulis adalah margin KOTOR yang belum
> memotong keduanya, dan tidak dipakai untuk keputusan apa pun.

Canary mengukur **klip bersuara = Rp8.313** (bukan Rp2.771 seperti klip bisu).
Konsekuensi terhadap "Rp12.000 per video bersuara" di landing:

- **Retail /bikin (1 klip)**: COGS ≈ Rp8.313 + frame ±Rp650 + QC vision ±Rp12
  ≈ **Rp9.000** → margin ±Rp3.000/video (25%) — tipis tapi positif.
- **Campaign dashboard (2–4 klip bersuara)**: COGS **Rp17–34 ribu** → harga
  Rp12.000 **rugi per video**. Harga campaign memang dihitung terpisah per
  klip di server, tapi angka landing tidak boleh menjanjikan Rp12.000 seolah
  berlaku umum.

Ini persis §4.8 board (COGS per tier sebelum payments live) — sekarang
angkanya ADA, dari render nyata, tinggal keputusan harga. **Jangan nyalakan
payments sebelum keputusan ini.**

## 3. Status permintaan §4 board (gate yang diminta masuk plan)

| §4 | Status |
|---|---|
| 1. Content-standard gate Phase 1 | **Terpasang** (SELALU_KERAS kedua mode, degraded ditolak render, snapshot beku) — sisa: brand tepercaya di intake |
| 2. Rubrik canary +2 dimensi | **Terpasang** (canary-12-tinjau.ts: Bahasa & CTA 0–2, Scroll-stop 0–2 dgn feed pembanding bernama, 5 critical fail per klip) |
| 3. NSFW KPI | **Berkelanjutan**: `npm run laporan:nsfw` (SELECT-only atas jobs+audit produksi, target per format, exit 1 bila lewat). Jalur job 30 hari: 0 penolakan konten |
| 4. Arsip prompt sebelum canary | **Terpasang** (0032 live) |
| 5. Budget canary realistis | Terbukti: aktual Rp44.336 utk 12 klip (bersuara Rp8.313/klip) — dilaporkan apa adanya |
| 6. Latency KPI | Terukur per klip: 112–194 dtk → semua copy waktu kini satu sumber `lib/janji-waktu.ts` |
| 7. Reference eligibility di intake | **Belum** — temuan canary #8 (gibberish direproduksi dengan setia); kandidat gate-1 OCR |
| 8. COGS → keputusan harga | Angka siap (§2) — keputusan Brian |
| 9. Control plane | Sebagian: janji waktu + katalog paket + kesiapan CTA kini modul satu-sumber; JSON control-plane penuh belum |

## 4. Keputusan Max

**Public paid: HOLD** — tetap, dan memang belum diminta dibuka.
**Private beta: HOLD tipis.** Engineering P0 dari board §2 sudah naik tier
dengan bukti; yang menahan tinggal (a) tiga baris N milik Brian (§5) dan (b) keputusan harga §2 — run CI hijau
sudah teramati (verify SUCCESS di run 32182693249; satu-satunya job merah =
papan utang copy katalog yang memang sengaja merah, milik Brian/copywriter).

## 5. Butuh Brian (tidak berubah banyak, tapi kini dengan angka)

1. **Keputusan harga** dengan data §2 (Rp12.000 vs COGS nyata Rp9rb–34rb).
2. Midtrans sandbox settlement (payments naik dari 2/10 hanya lewat ini).
3. Kontak legal + incident owner sementara.
4. Reviewer-2 atas mp4 canary di `test_output/canary_12/`.
5. Keputusan §3.3: label showcase dipertahankan atau disamakan dgn set HDRV.
