# Alur Mutu — cara membuktikan video kita benar

Dibangun 13–14 Agustus 2026. Ditulis karena sistemnya sekarang tersebar di
delapan berkas dan tidak ada gunanya kalau cuma saya yang tahu urutannya.

**Aturan pokok:** tidak ada yang disebut "terbukti" tanpa video nyata yang
lolos **dua pemeriksa independen**. Kode yang lulus tes bukan bukti; prompt
yang terlihat benar bukan bukti.

---

## Kenapa dibangun begini

Sebelas cacat struktural ditemukan dalam dua hari. **Nol** di antaranya
ditemukan oleh tes sebelum tesnya ditulis. Semuanya ketahuan dengan menonton
video, atau karena sebuah alat menolak jalan.

Lima di antaranya punya bentuk yang sama persis: **prompt yang bertentangan
sendiri**, bukan larangan yang kurang keras. Misalnya beat meminta "packshot
produk saja" sementara baris lain meminta "orang yang sama seperti shot lain" —
model menyelesaikan kontradiksi dengan mengarang, dan arangannya selalu lebih
dramatis daripada yang kita mau. Memperkuat larangan sudah dicoba empat kali
dengan uang sungguhan dan gagal empat kali. Yang berhasil selalu: **membuat
permintaannya koheren**.

Kalau nanti menemukan cacat visual baru, baca prompt shot itu UTUH lebih dulu
dan cari dua perintah yang tak bisa benar bersamaan. Itu jauh lebih sering
jawabannya daripada "modelnya kurang bagus".

---

## Perintah yang dipakai sehari-hari

```bash
# Render + buktikan template tertentu (paling sering dipakai)
RENDER_CONFIRM=YA RENDER_ONLY=tvc-jam-tiga npx tsx scripts/render-katalog.ts

# Seluruh sisa katalog. Tanpa RENDER_ONLY/RENDER_BATCH artinya SEMUA yang
# belum terbukti — setelah perubahan yang menyentuh semua prompt, itu 33.
RENDER_CONFIRM=YA RENDER_BATCH=5 npx tsx scripts/render-katalog.ts

# Papan nilai — dihitung dari bukti, bukan diketik
npx tsx scripts/papan-nilai.ts

# Cabut bukti yang videonya kependekan / dimensinya campuran
npx tsx scripts/audit-kelengkapan.ts

# Isi sidik prompt untuk render lama yang belum punya (menyelamatkan bukti
# yang sudah dibayar dari aturan kesegaran)
npx tsx scripts/isi-sidik-bukti.ts
```

`RENDER_CONFIRM=YA` wajib: skrip ini mengeluarkan uang sungguhan
(~Rp2.771–8.313 per klip).

---

## Lima lapis pemeriksaan

| Lapis | Di mana | Melihat apa | Butuh apa |
|---|---|---|---|
| QC-11 visi | `lib/media/qc-vision.ts` | orang, tangan, anatomi, teks — 8 frame | GEMINI_API_KEY |
| QC-11 lokal | `qcSubjekLokal` di `lib/media/qc.ts` | wajah utama — 2 frame/detik | tidak ada (YuNet lokal) |
| Kelengkapan | `scripts/audit-kelengkapan.ts` + `npm test` | durasi vs template | ffprobe |
| Keseragaman | sama | dimensi antar shot | ffprobe |
| Piksel di CI | `tests/bukti-katalog-piksel.test.ts` | 33 video, gratis, tiap commit | tidak ada |

Bukti hanya tercatat kalau **lapis 1 dan 2 dua-duanya lulus**. Satu pemeriksa
tidak pernah cukup: tiga video lolos pemeriksa visi lalu ditolak pemeriksa
lokal, dan sebaliknya pemeriksa lokal pernah menuduh video bersih karena
bug-nya sendiri.

**Yang BELUM dijaga, dan jangan diklaim aman:**
- teks kecil label — model mengarangnya dan berubah antar shot; dua putaran
  perbaikan prompt gagal. Ditutup sebagian oleh packshot foto asli (1 shot
  dari 6).
- tangan/anatomi di antara 8 titik sampel visi — pemeriksa lokal belum bisa
  menghitung tangan.
- kecocokan gerak mulut dengan bunyi — QC-01 hanya menjawab "bergerak atau
  tidak".

---

## Buku bukti

`test_output/bukti-render.json`, satu entri per template:

```json
"tvc-jam-tiga": {
  "berkas": "…/katalog/tvc-jam-tiga.mp4",
  "klip": 6, "biaya": 16626,
  "visiLolos": true,
  "sidik": "f46d961bc1d71762"
}
```

`sidik` adalah **sidik jari prompt** (shot + negative). Kesegaran diukur dari
sini, bukan dari jam commit: perubahan yang menyentuh format lain tidak
membatalkan bukti template ini. Versi jam sempat menghanguskan ±Rp280.000
render yang promptnya tidak berubah sehuruf pun.

`visiLolos: null` berarti **belum diperiksa** — itu bukan lulus dan bukan
gagal, dan papan nilai memperlakukannya sebagai belum terbukti.

---

## Yang berjalan otomatis saat render

- **Perbaikan shot cacat.** QC menunjuk detiknya, `shotUntukDetik` memetakan ke
  shot, shot itu saja digenerate ulang (~Rp3–8k, bukan seluruh video). Maksimal
  2 shot, satu putaran. Sudah menyelesaikan cacat yang tiga percobaan perbaikan
  prompt tidak bisa.
- **Packshot penutup dari foto asli** (`lib/media/packshot-asli.ts`) — Rp0, dan
  label brand dijamin benar karena itu memang fotonya.
- **Menolak bukti tak utuh** — shot gagal, durasi kurang, atau dimensi campuran
  tidak akan tercatat terbukti.
- **Berhenti saat buta** — dua template berturut-turut tak terperiksa berarti
  layanan QC mati; membeli video yang tidak bisa diperiksa adalah bentuk paling
  murni dari membakar uang.

---

## Pelajaran yang paling mahal

**Dua kali alat ukurnya sendiri yang salah, bukan yang diukur.**

1. Musik bed hampir dibuang karena selisih dua berkas yang dinormalkan
   sendiri-sendiri. Fiturnya bekerja sejak awal.
2. Pemeriksa lokal menuduh enam video bersih karena frame-nya menumpuk antar
   video (satu direktori dipakai ulang).

Keduanya lolos kalimat "sudah saya ukur". Yang menangkapnya: angka yang
**mustahil secara fisika** (tidak berubah walau gain 10×) dan **jumlah frame
yang tidak masuk akal** (61 frame untuk video 16 detik).

Curigai angka yang tidak masuk akal — termasuk angka sendiri.
