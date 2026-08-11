# 5 Prompt AI Hook — untuk di-stitch ke video jualan (v1, 2026-08-05)

Semua prompt di bawah ditulis untuk **BytePlus ModelArk** lewat pipeline kita
(`lib/providers/stubs/byteplus.ts`). Dua mode yang dipakai:

| Mode | Cara panggil | Sifat | Durasi |
|---|---|---|---|
| **i2v** | 1 foto TANPA `role` | foto jadi **frame pertama persis** | 2–15 dtk |
| **r2v** | foto ber-`role: "reference_image"` | jaga identitas produk/orang, bukan frame pertama | min 4 dtk |

Aturan keras yang tetap berlaku: `MANDATORY_NEGATIVE_PROMPT` (`no text, no logo,
no writing`) selalu ditambahkan sistem, dan watermark "Dibuat dengan AI" tetap
menyala 100% durasi. Prompt di bawah **tidak boleh** dipakai untuk mengklaim
kemampuan produk (lihat catatan di paling bawah).

**Kunci dari semua prompt ini: kalimat terakhir selalu mendeskripsikan FRAME
TERAKHIR.** Itu yang bikin sambungan ke footage asli rapi — bukan kebetulan.

## ATURAN BAHASA (wajib, berlaku untuk semua prompt)

Badan prompt ditulis dalam bahasa Inggris karena model jauh lebih patuh pada
instruksi teknis (framing, beat, kamera) dalam bahasa Inggris. **TAPI setiap
kalimat yang diucapkan orang di dalam video WAJIB ditulis verbatim dalam bahasa
Indonesia**, persis seperti yang sudah kita lakukan di pipeline e-commerce
(`lib/media/shot-planner.ts`):

```
The person speaks casually to camera in Indonesian, saying: "beneran ini yang lagi rame itu?"
Natural conversational Indonesian, not a newsreader. Do not speak English.
```

Kalau bahasa tidak ditentukan, model membentuk gerakan mulut pola bahasa Inggris
— buat penonton Indonesia langsung terasa asing dan palsu. Ini penyebab utama
hook terasa "bukan orang sini". Tambahkan juga `no English speech` ke negative
untuk setiap shot yang ada orang bicaranya.

---

## Ide 1 — Produk sebagai penyebab (shockwave) · **NILAI BRIAN: 4.5**

**Mode:** i2v · **Frame pertama:** foto produk asli penjual di atas meja · **Durasi:** 8 dtk

```
Locked-off static camera on a phone tripod, eye-level, no camera movement, no zoom.
An ordinary Indonesian home living room in the background, warm afternoon daylight
from a window on the left, slightly cluttered: papers on the table, a cardboard
box, a thin curtain.

Beat 1 (0-1.5s): the product sits perfectly still on the wooden table, exactly as in
the reference image. Absolutely nothing moves. Calm, ordinary, boring.

Beat 2 (1.5-3s): the product begins to vibrate very slightly. A faint ring of heat
distortion forms in the air around it. The papers nearest to it start to tremble.

Beat 3 (3-5s): a sudden invisible shockwave bursts outward from the product in every
direction. Papers fly off the table, the curtain whips backward, the cardboard box
tips over, a cloud of fine dust rolls outward across the floor. The camera shakes
hard for half a second from the blast, then settles back to its locked position.
The product itself stays exactly where it is, completely undamaged and still sharp.

Beat 4 (5-6.5s): the dust hangs and slowly settles. Papers drift down. The room is
now visibly messier than at the start, but quiet again.

Beat 5 (6.5-8s): a human hand and forearm enter the frame from the bottom right and
reach slowly toward the product, fingers open, about to pick it up.

FINAL FRAME: the hand's fingers are just touching the product, which remains centered
and in sharp focus, undamaged, identical to the reference image.
```

**Negative tambahan:** `no fire, no flames, no explosion sparks, no broken product, no gore, no face`

**Cara nyambung:** klip asli dimulai dari tangan sudah memegang produk. Gerakan
meraih di detik akhir = gerakan pembuka klip asli.

---

## Ide 2 — Barang jatuh dari langit, ditangkap · **NILAI BRIAN: 4.6**

**Mode:** r2v (foto produk sebagai `reference_image`, wajib — biar produknya tidak berubah bentuk) · **Durasi:** 9 dtk

```
Static selfie-style shot from a phone on a small tripod, chest-up framing, vertical.
A young Indonesian person sits at a desk in an ordinary home room, plain painted
ceiling visible above, soft daylight. They are mid-sentence, talking casually and
relaxed to the camera, natural and unaware.

Beat 1 (0-1s): normal, calm, talking to camera.

Beat 2 (1-2s): a hairline crack shoots across the ceiling with a puff of plaster
dust. The person stops talking and looks up, confused.

Beat 3 (2-4.5s): the ceiling breaks open and THE PRODUCT from the reference image
falls through the hole, tumbling slowly in the air toward the camera, catching the
light on its surfaces. Fine plaster dust and small debris fall around it. The product
stays perfectly intact and exactly matches the reference image, same colour, same
shape, same proportions — do not redesign it.

Beat 4 (4.5-7s): the person's eyes widen, they push back slightly and raise both
hands open above their chest, tracking the falling product.

Beat 5 (7-9s): they catch the product cleanly with both hands at chest height, pull
it in, and hold it steady facing the camera, breathing hard, with a surprised
delighted expression.

FINAL FRAME: the product is held still with both hands at chest height, centered,
facing the camera, in sharp focus, filling roughly one third of the frame width.
```

**Negative tambahan:** `no different product, no redesigned packaging, no injury, no blood, no collapsing walls`

**Cara nyambung:** klip asli dimulai dari produk sudah dipegang setinggi dada.
Match-cut di momen tangkap.

---

## Ide 3 — Rakit-sendiri (trik putar-balik) · **NILAI BRIAN: 4.5**

**Mode:** i2v · **Frame pertama:** frame pembuka klip asli (ambil pakai `extractReferenceFrame`, tapi dari detik 0, bukan detik akhir) · **Durasi:** 6 dtk

Prompt ini di-generate **maju** (produk hancur), lalu klipnya **diputar mundur**
di post. Hasilnya: serpihan terbang menyatu jadi produk utuh, dan frame terakhir
hasil balikan **persis** frame pembuka klip asli — karena itu frame yang kita
tentukan sendiri sebagai input.

```
Locked-off static camera, no movement, no zoom. The product sits centered on a clean
surface exactly as in the reference image, softly lit, shallow depth of field, calm
neutral background.

Beat 1 (0-0.7s): completely still. The product is pristine and sharp.

Beat 2 (0.7-1.3s): fine hairline fractures spread across the product's surface,
glowing faintly along the cracks.

Beat 3 (1.3-3s): the product bursts apart into many clean geometric fragments that
fly outward and upward in all directions, spinning slowly, trailing fine particles.
The fragments are dry and solid — no fire, no smoke, no liquid.

Beat 4 (3-6s): the fragments continue drifting outward in slow motion, spreading
wider and thinning out, still moving steadily at the end of the shot. The centre of
the frame is now empty except for a few small drifting particles.

FINAL FRAME: fragments are still in motion, spread wide across the frame, none of
them frozen or stopped.
```

**Negative tambahan:** `no fire, no smoke, no liquid, no gore, no still frozen ending, no camera movement`

**Wajib diputar mundur setelah generate:**

```bash
ffmpeg -y -i hook_forward.mp4 -vf reverse -an hook_reversed.mp4
```

`-an` penting: audio ikut terbalik kalau tidak dibuang, dan hasilnya aneh. Musik
ditambahkan belakangan di compositor.

**Cara nyambung:** frame terakhir hasil balikan = frame pembuka klip asli. Sambungan
presisi tanpa perlu transisi apa pun. Ini yang paling layak dijadikan template default.

---

## Ide 4 — Sapuan dua dunia · **NILAI BRIAN: 4.0 (terendah gelombang 1)**

**Mode:** i2v · **Frame pertama:** frame penjual duduk di meja (dunia "sebelum") · **Durasi:** 8 dtk

```
Locked-off static camera on a tripod, chest-up vertical framing, no camera movement.
An Indonesian person sits at a desk in a home room, looking at the camera.

Beat 1 (0-1.5s): the whole frame is the "before" world: dim yellowish light, messy
desk covered in clutter, wrinkled shirt, tired slouched posture, dull flat colours.

Beat 2 (1.5-5.5s): a soft vertical seam of warm light appears at the far left edge
of the frame and sweeps steadily to the right, like a curtain being drawn across
reality. Everything to the LEFT of the seam is transformed as it passes: the light
becomes bright and clean, the desk becomes tidy, the shirt becomes crisp, the person's
posture straightens and they smile, colours become rich and warm. Everything to the
RIGHT of the seam remains the dim messy "before" world. The seam moves at a constant
even speed and stays perfectly vertical.

Beat 3 (5.5-7s): the seam reaches the right edge and the entire frame is now the
bright clean world. The person leans slightly toward the camera, smiling.

Beat 4 (7-8s): the warm light from the seam blooms and floods the whole frame,
washing everything out into a soft warm white.

FINAL FRAME: the entire frame is a clean soft warm white, almost fully blown out,
with only the faintest shape visible.
```

**Negative tambahan:** `no hard cut, no black frame, no flicker, no strobe, no seam stopping midway`

**Cara nyambung:** frame terakhir putih terang → klip asli mulai dari situ. Kilatan
putih menyembunyikan sambungan sepenuhnya. **Paling pemaaf** kalau footage asli
beda ruangan/cahaya.

> Catatan aksesibilitas: pakai *bloom* lembut, jangan kedip cepat. Kilatan
> berfrekuensi tinggi berisiko memicu fotosensitif dan bisa kena moderasi platform.

---

## Ide 5 — Skala mustahil + dorong masuk · **NILAI BRIAN: 4.7 (tertinggi gelombang 1)**

**Mode:** r2v (foto produk sebagai `reference_image`) · **Durasi:** 8 dtk

```
Vertical shot. A narrow Indonesian residential alley (gang) in late afternoon: low
houses, tangled overhead cables, a warung with a faded awning, a few parked motorbikes,
laundry hanging. Golden hour light.

Beat 1 (0-2s): handheld phone-style shot, slight natural sway, looking down the alley.
Two or three neighbours are standing in the alley looking upward, small in frame.

Beat 2 (2-4s): the camera tilts up to reveal THE PRODUCT from the reference image
standing at the end of the alley at the scale of a four-storey building, upright and
monumental, perfectly matching the reference image in colour, shape and proportion —
do not redesign it. Its surface catches the golden light. Motorbikes ride past
underneath, tiny by comparison.

Beat 3 (4-8s): the camera pushes forward smoothly and continuously toward the giant
product, moving closer and closer, the alley falling away at the edges of frame,
until the product's surface completely fills the entire frame.

FINAL FRAME: the product's surface fills 100% of the frame, evenly lit, slightly soft
focus, no background visible at all, no edges of the product visible.
```

**Negative tambahan:** `no different product, no redesigned packaging, no text on product, no crowd panic, no destruction`

**Cara nyambung:** klip asli mulai dari close-up produk (macro). Karena frame
terakhir hook sudah dipenuhi permukaan produk, potongannya terbaca sebagai
*pull-back*, bukan potongan.

---

## Rambu yang tidak boleh dilanggar

Visual fantasi bebas — ledakan, hujan meteor, skala raksasa jelas tidak dimaksud
harfiah. Yang **dilarang** adalah fantasi yang menyiratkan kemampuan produk:

- skincare yang menghapus bekas jerawat seketika → klaim medis (aturan L-11 kita)
- gadget yang bikin sinyal penuh di hutan, powerbank yang mengisi tanpa colokan → klaim palsu (L-10)
- produk yang menyembuhkan, menguruskan, atau memperbaiki tubuh → otomatis ditolak

Aturan mudahnya: **hook boleh mustahil secara fisika, tidak boleh mustahil secara
fungsi produk.**
