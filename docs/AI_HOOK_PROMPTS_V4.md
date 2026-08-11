# Gelombang 4 — Hook bertumpuk, struktur 30 detik (v4, 2026-08-05)

Lanjutan [v1](./AI_HOOK_PROMPTS_V1.md) · [v2](./AI_HOOK_PROMPTS_V2.md) · [v3](./AI_HOOK_PROMPTS_V3.md).

## Papan nilai gelombang 3

| Ide | Konsep | Hasil |
|---|---|---|
| 13 | Dunia ngebut, dia diam | 4.3 |
| 15 | Mati lampu, satu jendela menyala | 4.3 |
| 11 | Antrean mengular di gang | **GAGAL** — kebanyakan orang, AI kelihatan |
| 12 | Semua menoleh di warung | **GAGAL** — kebanyakan orang, generate gagal |
| 14 | Tidak ada yang sanggup mengangkat | **GAGAL** — konsepnya sendiri lemah |

## Tiga aturan baru (kumulatif dengan A & B di v3)

**Aturan C — Maksimal 1 orang. Idealnya nol.**
Ide 11 dan 12 gagal karena alasan yang sama: banyak orang dalam satu frame.
Makin banyak manusia yang harus dirender, makin besar peluang wajah/tangan
rusak, dan makin sering generate-nya gagal total. Mulai sekarang: **tangan saja
kalau bisa, satu orang kalau perlu, tidak pernah kerumunan.** Ini juga sudah
sejalan dengan format `hands_only` yang paling matang di pipeline kita.

**Aturan D — Satu kejutan tidak cukup. Hook harus BERTUMPUK.**
Semua ide di v1–v3 cuma punya SATU kejadian mengejutkan lalu selesai. Referensi
[@harry__allsop](https://www.instagram.com/reel/DZmqDVHRvDj/) menyebutnya
eksplisit: *"A book slam. A drink. Sunglasses. A drop. Crossed arms. **Five hooks,
zero editing**."* Lima pemicu berhenti-scroll dalam satu klip. Itu sebabnya
belum ada yang 5 — bukan karena idenya kurang wah, tapi karena **densitasnya
kurang**.

**Aturan E — "Triple Hook" = tiga KANAL serentak, bukan tiga kejadian.**
Di 2 detik pertama harus ada **Visual + Suara + Teks sekaligus**. Ini keunggulan
struktural kita: model video dilarang menulis teks (`no text, no logo, no
writing`) karena hasilnya berantakan, tapi **lapisan teks kita datang dari
compositor sendiri** (`render-captions.ts`) — jadi tajam, terbaca, dan
sepenuhnya bisa dikendalikan. Kanal ketiga ini gratis dan tidak bisa gagal.

---

## Kerangka 30 detik (dari Brian)

| Waktu | Fungsi | Isi |
|---|---|---|
| 0–2s | **Triple Hook** | Visual + Suara + Teks serentak |
| 2–5s | **Curiosity gap** | "Tapi yang bikin aku kaget bukan hasilnya…" |
| 5–10s | **Proof / eskalasi** | Bukti, demo, transformasi |
| 10–15s | **Re-hook** | "Nah, bagian ini yang paling penting." |
| 15–25s | **Payoff** | Jawaban / hasil / reveal |
| 25–30s | **CTA / loop** | Ajakan + kalimat yang menyambung ke detik 0 |

> **Implikasi teknis:** mesin skrip kita sekarang cuma punya 3 segmen
> (hook/demo/cta) dan untuk 30 dtk hanya **meregangkan** ketiganya. Struktur di
> atas butuh **6 beat**. Ini perubahan nyata di `lib/script-engine/templates.ts`,
> bukan sekadar prompt — dicatat sebagai pekerjaan terpisah.

Hanya bagian **0–5 detik** yang di-generate AI. Sisanya footage asli penjual.
Itu sebabnya semua ide di bawah menaruh seluruh kepadatan hook di 5 detik pertama.

---

## Ide 16 — Nyaris pecah · **GAGAL — terlalu standar**

**Produk:** semua · **Orang:** nol (tangan saja) · **Mode:** i2v (foto produk) · **Durasi klip AI:** 5 dtk

**Hook bertumpuk:** (1) barang jatuh · (2) berhenti mengambang · (3) lantai retak sendiri · (4) barang naik pelan

```
Locked-off static camera on a tripod, low angle close to a tiled floor in an ordinary
Indonesian home, warm daylight. THE PRODUCT sits on the edge of a wooden table at the
top of frame, exactly as in the reference image.

Beat 1 (0-0.6s): the product slips off the edge of the table and falls fast toward the
hard tiled floor.

Beat 2 (0.6-1.6s): three centimetres above the tiles it STOPS DEAD in mid-air and
hangs there, perfectly still, not spinning, not wobbling. Absolute silence.

Beat 3 (1.6-3s): fine cracks spread outward across the floor tiles directly beneath it,
as if the floor absorbed an impact that never happened. A little dust puffs up from the
cracks.

Beat 4 (3-5s): the product rises slowly and smoothly back up through the frame, turning
gently to face the camera, and stops centered at mid-frame, hanging in the air.

FINAL FRAME: the product hangs motionless in the centre of the frame, sharp and
undamaged, identical to the reference image, cracked floor tiles blurred below it.
```

**Negative:** `no hands, no people, no faces, no broken product, no glass shards, no fire, no text`

| Waktu | Suara (Indonesia) | Teks overlay |
|---|---|---|
| 0–2s | *"EH—!"* (kaget, refleks) | **JANGAN DI-SKIP DULU** |
| 2–5s | *"tapi yang bikin aku kaget bukan jatuhnya…"* | — |

**Sambungan:** klip asli mulai dari tangan menangkap/memegang produk di tengah frame.

---

## Ide 17 — Gravitasi mati, satu benda tidak ikut · **GAGAL — terlalu standar**

**Produk:** semua · **Orang:** nol · **Mode:** i2v (foto meja kerja + produk) · **Durasi klip AI:** 5 dtk

**Hook bertumpuk:** (1) benda-benda naik · (2) produk tetap diam · (3) semua jatuh serentak · (4) produk masih tidak bergerak

```
Locked-off static camera on a tripod, eye-level onto an ordinary wooden desk in an
Indonesian home, afternoon light from the left. On the desk: loose papers, a pen, a
ceramic mug, a folded cloth, and THE PRODUCT exactly as in the reference image.

Beat 1 (0-1s): everything is perfectly still and ordinary for one full second.

Beat 2 (1-2.5s): every object on the desk begins to rise slowly straight upward —
papers, pen, mug, cloth — drifting up out of the top of frame, rotating gently. THE
PRODUCT does not move at all. It stays flat on the desk as if bolted down.

Beat 3 (2.5-3.5s): everything crashes straight back down onto the desk at once, hard,
with papers scattering and the mug bouncing and rolling. The camera shakes very
slightly from the impact.

Beat 4 (3.5-5s): the desk settles, messy now. The product is still in exactly the same
position, untouched and undisturbed, sharp and centered.

FINAL FRAME: the product sits alone and perfectly still on the messy desk, centered,
sharp, identical to the reference image, scattered papers around it.
```

**Negative:** `no people, no hands, no faces, no broken mug, no liquid spill, no floating product, no text`

| Waktu | Suara | Teks overlay |
|---|---|---|
| 0–2s | *"lah, kok cuma ini yang gak ikut naik?"* | **KOK CUMA INI?** |
| 2–5s | *"nah ini yang bikin aku heran…"* | — |

**Sambungan:** klip asli mulai dari tangan meraih produk di meja.

---

## Ide 18 — Kotak yang tidak habis-habis · **GAGAL — terlalu standar**

**Produk:** semua · **Orang:** nol (tangan saja) · **Mode:** r2v (foto produk) · **Durasi klip AI:** 5 dtk

**Hook bertumpuk:** tiap unit yang keluar = satu hook baru. Eskalasi terpasang otomatis.
**Kenapa aman:** `hands_only`, format paling matang di pipeline kita.

```
Locked-off static camera on a tripod, top-down onto a plain wooden table, ordinary
Indonesian home lighting. A small plain cardboard box sits closed in the centre. Only
hands and forearms are ever visible — no face, no body, cropped below the elbow.

Beat 1 (0-0.8s): two hands open the small box.

Beat 2 (0.8-1.6s): one hand pulls THE PRODUCT out of the box and sets it on the table,
matching the reference image exactly in colour, shape and proportion.

Beat 3 (1.6-3.5s): the hand reaches back in and pulls out another identical product,
then another, then another, faster and faster, setting each one down. The box is far
too small to hold them. Six, then ten identical products accumulate on the table in a
growing row.

Beat 4 (3.5-5s): the hands tip the small box upside down and shake it — nothing else
falls out. The box is completely empty. The hands set the empty box down beside the
long row of products.

FINAL FRAME: a row of ten identical products fills the table, all sharp and matching
the reference image, the small empty cardboard box tipped over beside them.
```

**Negative:** `no face, no body, no head in frame, no different product variants, no distorted hands, no extra fingers, no text, no logo on box`

| Waktu | Suara | Teks overlay |
|---|---|---|
| 0–2s | *"tunggu, ini kotaknya sekecil itu loh"* | **KOTAKNYA SEKECIL INI** |
| 2–5s | *"tapi bukan itu yang bikin aku heran…"* | — |

**Sambungan:** klip asli mulai dari satu produk diambil dari barisan.

---

## Ide 19 — Domino di meja · **GAGAL — terlalu standar**

**Produk:** semua · **Orang:** nol · **Mode:** i2v (foto produk di ujung meja) · **Durasi klip AI:** 5 dtk

**Hook bertumpuk:** tiap benda yang tumbang = satu beat. Empat beat dalam lima detik.

```
Locked-off static camera on a tripod, low side-on angle along the length of a wooden
table in an ordinary Indonesian home, warm side light. A line of everyday objects
stands upright along the table: a spoon, a small tin, a folded phone stand, a matchbox,
a rolled cloth. At the far end of the line sits THE PRODUCT exactly as in the reference
image.

Beat 1 (0-1s): everything is still. Then the first object tips over on its own with no
visible cause.

Beat 2 (1-3s): each object topples in sequence like dominoes down the line, each one
knocking the next, moving toward the product. The camera stays locked, no movement.

Beat 3 (3-4s): the last object falls toward the product — and stops dead in mid-air
just before touching it, hanging at an impossible angle.

Beat 4 (4-5s): the product slowly rotates on the spot to face the camera, while the
frozen object still hangs mid-fall behind it.

FINAL FRAME: the product faces the camera, centered and sharp, identical to the
reference image, with one object frozen mid-fall suspended behind it.
```

**Negative:** `no people, no hands, no faces, no falling product, no broken objects, no glass, no text`

| Waktu | Suara | Teks overlay |
|---|---|---|
| 0–2s | *"eh, gak ada yang nyentuh loh"* | **GAK ADA YANG NYENTUH** |
| 2–5s | *"dan yang terakhir ini yang aneh…"* | — |

**Sambungan:** klip asli mulai dari produk menghadap kamera / diambil tangan.

---

## Ide 20 — Yang lama rontok jadi debu · **GAGAL — terlalu standar**

**Produk:** semua yang punya "versi lama" (gadget, alat dapur, skincare) · **Orang:** nol · **Mode:** i2v · **Durasi klip AI:** 5 dtk

**Hook bertumpuk:** tiap benda yang rontok = satu hook. Tiga rontokan berturut-turut.

```
Locked-off static camera on a tripod, eye-level onto a plain wooden table in an
ordinary Indonesian home, soft even light. Four unbranded, plain, worn-looking generic
objects of the same general category stand in a row, scuffed and dull. At the end of
the row stands THE PRODUCT exactly as in the reference image, clean and sharp.

Beat 1 (0-1s): all five objects stand still in a row. Ordinary and quiet.

Beat 2 (1-2s): the first worn object silently collapses into fine grey dust that
settles onto the table. No fire, no sparks, no smoke.

Beat 3 (2-3.5s): the second and third collapse into dust the same way, one after the
other, slightly faster each time.

Beat 4 (3.5-4.5s): the fourth collapses. Only drifting grey dust remains where the row
of worn objects stood.

Beat 5 (4.5-5s): the dust settles. THE PRODUCT is still standing, untouched, clean and
sharp, now completely alone on the table.

FINAL FRAME: the product stands alone at the centre of the table, sharp and undamaged,
identical to the reference image, a thin layer of settled grey dust around it.
```

**Negative:** `no people, no hands, no faces, no fire, no smoke, no sparks, no brand logos, no recognisable brands, no packaging text, no text`

| Waktu | Suara | Teks overlay |
|---|---|---|
| 0–2s | *"yang lama pada rontok satu-satu"* | **YANG LAMA RONTOK** |
| 2–5s | *"tapi alasannya bukan yang kamu kira…"* | — |

**Sambungan:** klip asli mulai dari tangan mengambil produk dari meja.

> **Rambu wajib:** benda lama **harus polos tanpa merek**. Menampilkan produk
> bermerek pesaing yang hancur = merendahkan merek lain (aturan L-15 kita) dan
> berisiko dilaporkan. Sudah dimasukkan ke negative prompt.

---

## Rekomendasi urutan uji

1. **Ide 18 (kotak tidak habis)** — nol wajah, `hands_only`, eskalasi otomatis. Paling kecil peluang gagal render, dan paling sesuai Aturan C + D sekaligus.
2. **Ide 16 (nyaris pecah)** — nol manusia sepenuhnya, empat beat dalam lima detik.
3. **Ide 20 (yang lama rontok)** — nol manusia, tiga beat berulang.

Ketiganya **tanpa manusia sama sekali** — persis kebalikan dari tiga ide yang
gagal kemarin.

## Yang masih kurang dan jujur harus dikerjakan

Kelima ide ini menaikkan densitas hook di **5 detik pertama**, tapi kerangka
30 detik penuh (curiosity gap → proof → re-hook → payoff → CTA) **belum
didukung mesin skrip kita** — sekarang masih 3 segmen yang diregangkan. Selama
itu belum dibenahi, beat 5–30 detik masih harus ditulis manual per video.
