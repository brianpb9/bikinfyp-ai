# BRIEF PRODUKSI — Ide 30 v2: KRL + lanjutan Voice Over

**Untuk:** agen/terminal yang menjalankan generate video
**Dasar:** Ide 30 (nilai 4.8 — tertinggi dari 30 ide). Lihat
[laporan lengkap](./AI_HOOK_MASTER_REPORT.md).
**Perubahan dari v1:** ditambah **lanjutan voice-over saat produk ditunjukkan**.

---

## Yang diminta

Reproduksi Ide 30, **tapi jangan berhenti setelah keretanya lewat**. Setelah
kereta hilang, orangnya **mengangkat produk ke kamera dan mulai bicara** —
suaranya keluar dari model (tier bersuara), bukan ditempel belakangan.

Jadi hook dan jualannya jadi **satu take yang sama**, bukan hook lalu potong ke
video lain. Dinding jebol dan rel yang masih kelihatan di belakang adalah
**bukti kontinuitas** — itu yang bikin penonton percaya ini satu rekaman.

---

## Struktur: 2 shot

Batas keras BytePlus 15 dtk/klip, jadi dipecah dua dan disambung di compositor.

| Shot | Durasi | Isi | Mode |
|---|---:|---|---|
| **1** | 9 dtk | Hook: kereta menembus ruang tamu | r2v |
| **2** | 8 dtk | Produk diangkat + voice over | r2v |

Total 17 detik. Sisa durasi (kalau target 30 dtk) diisi footage asli penjual +
CTA seperti biasa.

**Wajib:** kedua shot memakai **foto produk yang sama** sebagai
`role: "reference_image"`, dan **deskripsi orang + ruangan yang identik kata per
kata**, supaya wajah, baju, dan ruangan tidak berubah antar shot. Ini kelemahan
yang sudah kita tangani di pipeline e-commerce (konservasi identitas) — berlaku
sama di sini.

---

## SHOT 1 — Hook kereta (9 dtk, r2v)

```
Cinematic vertical shot, locked-off tripod at seated eye level, no camera movement.
An ordinary Indonesian living room in the afternoon: tiled floor, a fabric sofa against
the back wall, a round wall clock, a plain painted back wall, soft daylight from a
window on the left. One young Indonesian man in a plain grey t-shirt sits calmly on the
sofa facing the camera, holding THE PRODUCT from the reference image in both hands at
chest height, matching the reference image exactly in colour, shape and proportion —
do not redesign it.

Beat 1 (0-1.5s): calm and ordinary. He sits relaxed, looking straight at the camera,
product already visible in his hands.

Beat 2 (1.5-2.5s): a deep vibration builds. The wall clock rattles against the wall.
Fine dust shakes loose from the ceiling. A commuter train horn sounds, close and loud.

Beat 3 (2.5-6s): a full-size commuter train bursts through the back wall from the left
and roars horizontally across the entire room behind the sofa, filling the whole back
of the frame — windows, interior lights and carriage panels streaking past in motion
blur. Wind blasts through the room: curtains snap sideways, loose papers fly, his hair
and t-shirt whip violently. He does not flinch and does not look back.

Beat 4 (6-8s): the final carriage exits through the right of frame. The wind dies. Dust
and paper drift slowly down. Where the back wall was, there is now a train-sized
opening with rails running through it and daylight beyond.

Beat 5 (8-9s): he has not moved at all — still seated, still calm, still holding the
product in exactly the same position. His hair settles back down.

FINAL FRAME: he sits calmly facing the camera holding the product at chest height,
centered and sharp, the broken wall opening and rails clearly visible behind him, dust
still settling in the air.
```

**Negative:** `no text, no logo, no writing, no crowds, no other people, no injury, no blood, no fire, no derailment, no destroyed sofa, no distorted face, no extra fingers, no English speech`

**Audio shot 1:** tanpa dialog. Cukup suara kereta + angin. Kalau model
memaksa ada suara mulut, pakai satu tarikan napas kaget saja.

---

## SHOT 2 — Produk + voice over (8 dtk, r2v)

**Kunci: deskripsi orang & ruangan disalin persis dari Shot 1**, ditambah dinding
jebol yang sudah ada di belakang.

```
Cinematic vertical shot, locked-off tripod at seated eye level, no camera movement.
The same ordinary Indonesian living room, immediately after: tiled floor, fabric sofa,
round wall clock, soft daylight from the left, and a train-sized opening in the back
wall with rails running through it and daylight beyond, fine dust still hanging in the
air. The same young Indonesian man in the same plain grey t-shirt sits on the same sofa
facing the camera, holding THE PRODUCT from the reference image in both hands at chest
height, matching the reference image exactly in colour, shape and proportion — do not
redesign it.

Beat 1 (0-2s): he glances briefly over his shoulder at the hole in the wall, then turns
back to the camera with a small amused shrug, completely unbothered.

Beat 2 (2-5s): he raises the product closer to the camera with both hands, turning it
slowly so its front face catches the daylight, keeping it centered and in sharp focus.

Beat 3 (5-8s): he brings the product back down slightly to chest height, holds it
steady, and leans in a little toward the camera, speaking directly to the viewer.

He speaks casually to camera in Indonesian throughout the shot, saying:
"nah, ini nih yang dari tadi aku pegang. {KALIMAT_PRODUK}"
Natural conversational Indonesian, relaxed, not a newsreader. Do not speak English.
Enunciate clearly.

FINAL FRAME: he holds the product steady at chest height facing the camera, product
centered and in sharp focus, the broken wall and rails visible behind him.
```

**Negative:** `no text, no logo, no writing, no other people, no English speech, no distorted face, no extra fingers, no changed room, no repaired wall, no different clothing`

---

## Naskah voice over

Isi `{KALIMAT_PRODUK}` mengikuti aturan bahasa mesin skrip kita: ada partikel
(`sih/nih/deh/loh`), ada filler (`nah`), **tanpa klaim berlebihan**.

**Template:**

```
"nah, ini nih yang dari tadi aku pegang. {PRODUK} — {BUKTI_KONKRET} nya niat
banget, dan harganya cuma {HARGA} sih."
```

**Contoh terisi (powerbank):**

```
"nah, ini nih yang dari tadi aku pegang. Powerbank slim ini — bodinya tipis
banget tapi kerasa padat, dan harganya cuma 150 ribu sih."
```

**Dilarang keras** (langsung kena aturan validator kita):

| Dilarang | Aturan |
|---|---|
| "pasti", "dijamin", "terbaik", "100%", "nomor 1" | L-10 overclaim |
| klaim menyembuhkan / medis apa pun | L-11 |
| "buruan stok terakhir", "cuma hari ini" (kalau tidak benar) | L-13 urgensi palsu |
| menyebut merek pesaing sambil menjelekkan | L-15 |
| angka/spesifikasi yang tidak ada di data produk | L-14 |

Kata ganti harus konsisten satu register — jangan campur `aku` dengan `gue` (L-16).

---

## Penyambungan

```bash
# 1) sambung shot 1 + shot 2 (harus sama resolusi, fps, dan SAR)
#    pola ini sudah dipakai di lib/promo/stitch.ts
# 2) lanjut ke footage asli penjual
# 3) compositor menambahkan: teks overlay + watermark "Dibuat dengan AI"
```

**Teks overlay (dari compositor, bukan dari model):**

| Waktu | Teks |
|---|---|
| 0–2s | **TUNGGU SAMPE ABIS** |
| 2–5s | *(kosong — biarkan visualnya bekerja)* |

---

## Kriteria terima

Tolak dan generate ulang kalau salah satu terjadi:

1. Wajah / baju / ruangan **berubah** antara Shot 1 dan Shot 2
2. Dinding di Shot 2 **sudah utuh kembali** (kontinuitas putus — ini yang paling sering jebol)
3. Produk berubah bentuk/warna dari foto referensi
4. Ada orang lain muncul di frame
5. Mulut bergerak pola bahasa Inggris
6. Jari lebih dari lima / tangan terdistorsi
7. Ada tulisan yang dibuat model (angka, logo, teks di dinding)

Yang paling rawan nomor **2** — model sering "memperbaiki" ruangan di shot
berikutnya. Kalau itu terjadi, pertegas dengan menambahkan
`the wall behind him is still broken open with rails visible` di beat pertama
Shot 2.
