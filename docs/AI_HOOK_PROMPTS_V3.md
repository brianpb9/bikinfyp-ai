# 5 Prompt AI Hook — Gelombang 3 (v3, 2026-08-05)

Lanjutan dari [v1](./AI_HOOK_PROMPTS_V1.md) dan [v2](./AI_HOOK_PROMPTS_V2.md).
Aturan mode (i2v/r2v), aturan bahasa Indonesia untuk dialog, dan rambu klaim
produk **tetap berlaku penuh**.

## Papan nilai 10 ide sebelumnya

| Ide | Konsep | Nilai |
|---|---|---|
| 8 | Waktu berhenti di pasar | **4.8** ← tertinggi |
| 5 | Skala raksasa + dorong masuk | 4.7 |
| 6 | Ojol turun tembok | 4.7 |
| 2 | Jatuh dari langit, ditangkap | 4.6 |
| 1 | Shockwave dari produk | 4.5 |
| 3 | Rakit-sendiri (putar-balik) | 4.5 |
| 4 | Sapuan dua dunia | 4.0 |
| 10 | Angkot, semua pegang barang sama | 4.0 — produk tidak cocok |
| 7 | Rebutan seribu tangan | **GAGAL** — "aneh" |
| 9 | Tangan keluar dari layar HP | **GAGAL** — "AI slop" |

## Dua aturan baru dari kegagalan

**Aturan A — Mustahil boleh di FISIKA, tidak boleh di ANATOMI.**
Ide 7 dan 9 sama-sama gagal, dan keduanya punya satu kesamaan: memaksa model
merender **tubuh manusia dalam kondisi tidak wajar** (puluhan tangan bertumpuk;
lengan menembus permukaan). Itu titik lemah paling terkenal dari semua model
video — jari berlebih, sendi bengkok, lengan menyatu. Penonton tidak berpikir
"wah", tapi "ini AI".

Bandingkan dengan Ide 8 (4.8): di sana **setiap elemen tetap masuk akal secara
fotografis** — orang berdiri normal, air tetap air, pasar tetap pasar. Yang
mustahil cuma **waktunya**. Model tidak diminta menggambar anatomi aneh sama
sekali.

> Praktisnya: kalau sebuah ide mengharuskan tubuh manusia melakukan hal yang
> tidak bisa difoto di dunia nyata, buang idenya. Ubah yang mustahil ke
> **waktu, skala, gravitasi, cuaca, atau jumlah orang** — semua itu aman.

**Aturan B — Produk harus berada di tempat yang wajar untuk produk itu.**
Ide 10 dapat 4.0 bukan karena idenya lemah, tapi karena powerbank tidak
dipegang-pegang orang di angkot. Idenya sendiri bagus — untuk HP.
Karena itu **setiap ide di bawah diberi label "cocok untuk produk apa"**.

**Trik produksi:** gerakan cepat / motion blur **menyembunyikan cacat anatomi**.
Orang yang lewat sambil nge-blur jauh lebih aman dirender daripada orang yang
berdiri diam di depan kamera. Ide 13 sengaja memanfaatkan ini.

---

## Ide 11 — Antrean mengular di gang · **GAGAL — kebanyakan orang, AI kelihatan**

**Cocok untuk:** SEMUA produk · **Mode:** r2v · **Durasi:** 9 dtk
**Anatomi:** aman — orang hanya berdiri dan berjalan pelan.

```
Vertical handheld phone shot with natural sway. A narrow Indonesian residential alley
(gang) in the late afternoon, golden light, low houses on both sides, tangled overhead
cables, potted plants, a green metal gate in the foreground.

Beat 1 (0-2s): the camera is close behind a person's shoulder as they unlock and slowly
push open the green metal gate of their house, casual and unhurried.

Beat 2 (2-4s): the gate swings open to reveal a queue of people standing patiently in
the alley outside, single file, stretching away from the gate.

Beat 3 (4-7s): the camera lifts and pans slowly along the queue. The line of people
continues far down the alley, around a bend, and out of sight — at least forty people,
all ages, ordinary everyday clothing, standing calmly and patiently, some holding
phones, some fanning themselves in the heat. They are relaxed and orderly, not a mob.
A few glance politely toward the camera and look away again.

Beat 4 (7-9s): the camera pans back to the person at the gate, who turns to face the
camera holding THE PRODUCT from the reference image in one hand at chest height,
matching the reference image exactly in colour, shape and proportion — do not redesign
it. They give a small overwhelmed smile.

FINAL FRAME: the person faces the camera holding the product at chest height, centered
and in sharp focus, the long queue soft and out of focus behind them.
```

**Negative tambahan:** `no crowd panic, no pushing, no shouting, no protest, no banners, no text on signs, no exaggerated faces, no distorted hands`

**Sambungan:** klip asli mulai dari tangan penjual memegang produk setinggi dada.

---

## Ide 12 — Semua menoleh di warung · **GAGAL — kebanyakan orang, generate gagal**

**Cocok untuk:** SEMUA produk · **Mode:** r2v · **Durasi:** 8 dtk
**Anatomi:** paling aman dari semua ide — cuma 3–4 orang duduk dan menoleh pelan. Paling murah dan paling kecil risiko gagal render.

```
Vertical handheld phone shot, slight natural sway. Inside a small Indonesian roadside
warung in the evening: warm yellow bulb light, simple wooden benches and tables,
plastic chairs, jars of snacks on the counter, a street visible through the open front.

Beat 1 (0-2s): a young Indonesian person sits at a table, filmed from across the table.
Three other customers sit at other tables in the background, quietly eating and looking
at their own food. Ordinary, calm, unremarkable evening.

Beat 2 (2-4s): the person reaches into their bag and takes out THE PRODUCT from the
reference image, setting it down on the table in front of them, matching the reference
image exactly in colour, shape and proportion — do not redesign it. They look at it
casually.

Beat 3 (4-6.5s): one by one, slowly and in silence, every other customer in the warung
turns their head to look at the product. Calm, unhurried head turns, natural neutral
expressions, no smiling, no exaggeration. Even the warung owner behind the counter
pauses and looks. Nobody moves from their seat. The room goes completely still.

Beat 4 (6.5-8s): the person at the table notices everyone looking, glances around
slowly, then looks back down at the product and picks it up in one hand.

FINAL FRAME: the person holds the product up in one hand at chest height, centered and
in sharp focus, with the other still, silent customers softly out of focus behind them.
```

**Negative tambahan:** `no exaggerated comedy faces, no laughing, no crowd standing up, no fast head movement, no distorted faces, no extra fingers`

**Sambungan:** klip asli mulai dari produk di tangan penjual.

---

## Ide 13 — Dunia ngebut, dia diam · **NILAI BRIAN: 4.3**

**Cocok untuk:** SEMUA produk · **Mode:** r2v · **Durasi:** 10 dtk
**Anatomi:** aman **karena** semua orang lain sengaja dibuat blur — motion blur menyembunyikan cacat anatomi.

```
Vertical shot on a tripod, locked-off, no camera movement. A busy pedestrian bridge or
sidewalk in Jakarta at dusk, city buildings and traffic behind, warm streetlights just
turning on.

Beat 1 (0-2s): normal speed. A young Indonesian person stands still in the centre of
the frame, facing the camera, holding THE PRODUCT from the reference image in both
hands at chest height, matching the reference image exactly in colour, shape and
proportion — do not redesign it. People walk past on either side at normal speed.

Beat 2 (2-7s): the world around them accelerates into a long-exposure time-lapse.
Pedestrians become fast smeared streaks of motion blur, headlights stretch into
continuous ribbons of light, clouds race across the sky, the sunset drops and the sky
shifts from orange to deep blue. The person in the centre stays completely still and
perfectly sharp, in focus, not blurred at all, still holding the product. Their clothes
and hair move only very slightly.

Beat 3 (7-10s): the time-lapse decelerates smoothly back to normal speed. The streaks
resolve back into ordinary walking people. It is now night, the streetlights are fully
on, and the person is still standing in exactly the same position holding the product.

FINAL FRAME: the person stands perfectly still facing the camera at night, holding the
product at chest height, centered and sharp, city lights soft and glowing behind them.
```

**Negative tambahan:** `no sharp background people, no frozen bystanders, no strobing, no flickering, no distorted faces in blur, no text on signage`

**Sambungan:** klip asli mulai dari produk dipegang setinggi dada. Perpindahan
siang→malam juga memberi alasan visual kalau cahaya footage asli berbeda.

---

## Ide 14 — Tidak ada yang sanggup mengangkat · **GAGAL — konsepnya sendiri lemah**

**Cocok untuk:** produk KECIL & padat (powerbank, SSD, parfum, skincare, gadget) — makin kecil produknya makin lucu · **Mode:** i2v (foto produk di atas meja jadi frame pertama) · **Durasi:** 10 dtk
**Anatomi:** sedang — satu orang per waktu, framing dekat ke tangan dan produk saja.

```
Locked-off static camera on a tripod, no camera movement, medium close framing on a
plain wooden table inside an ordinary Indonesian home. THE PRODUCT sits alone in the
centre of the table exactly as in the reference image, evenly lit and sharp.

Beat 1 (0-1.5s): completely still. Just the small product alone on the table.

Beat 2 (1.5-4s): one adult hand and forearm enter frame and grip the product firmly,
then pull upward hard. The product does not move at all, as if it weighs a tonne. The
forearm tenses, veins showing, then gives up and releases. The hand exits frame.

Beat 3 (4-7s): a second, larger pair of hands enters frame, grips the product with
both hands, and heaves upward with real effort — the table itself creaks and lifts
slightly at one corner — but the product still does not move. Both hands release and
exit frame.

Beat 4 (7-9s): a third smaller hand enters frame and lifts the product effortlessly
with two fingers, as if it weighs nothing at all, raising it smoothly off the table.

Beat 5 (9-10s): the hand turns the product gently toward the camera, holding it still.

FINAL FRAME: the product is held between two fingers, centered in frame, in sharp
focus, undamaged, identical to the reference image, the empty table blurred behind it.
```

**Negative tambahan:** `no faces, no full bodies, no extra fingers, no distorted hands, no broken table, no broken product, no cartoon effects`

**Sambungan:** klip asli mulai dari produk sudah di tangan, dekat kamera.

> Sengaja **tanpa wajah** — dibatasi tangan dan lengan saja. Ini format
> `hands_only` yang sudah paling matang di pipeline kita dan paling kecil
> risiko anatominya.

---

## Ide 15 — Mati lampu sekampung, satu jendela menyala · **NILAI BRIAN: 4.3**

**Cocok untuk:** POWERBANK, lampu darurat, gadget berbaterai — **jangan** dipakai untuk produk yang tidak berhubungan dengan listrik · **Mode:** r2v · **Durasi:** 10 dtk
**Anatomi:** aman — gelap, satu orang, gerakan minimal.

```
Vertical handheld phone shot with slight natural sway. An Indonesian residential
neighbourhood (kampung) at night, seen from the alley: rows of small houses, overhead
cables, a narrow lane.

Beat 1 (0-2s): the whole neighbourhood is lit normally — warm light glowing from many
windows, a streetlamp on, the blue flicker of a television through one curtain.

Beat 2 (2-3.5s): every light in the entire frame cuts out at once. Total darkness. The
streetlamp dies, all the windows go black, the television flicker vanishes. Only faint
moonlight and the silhouettes of rooftops remain. Somewhere a dog barks.

Beat 3 (3.5-6s): one single window in the middle of the frame is still glowing — a
soft, cool white light, steady and calm, the only light in the entire neighbourhood.
The camera moves slowly toward that window.

Beat 4 (6-10s): the camera arrives at the window and looks in. Inside, a young
Indonesian person sits calmly on the floor, completely relaxed, their face lit by their
phone screen. THE PRODUCT from the reference image sits beside them connected to the
phone by a short cable, matching the reference image exactly in colour, shape and
proportion — do not redesign it. They are unbothered while the rest of the
neighbourhood is dark.

FINAL FRAME: the product sits beside the person in the calm glow of the phone screen,
centered and in sharp focus, the dark room and dark neighbourhood around it.
```

**Negative tambahan:** `no product glowing by itself, no product lighting the whole room, no lightning, no fire, no candles, no distorted faces, no text on screen`

**Sambungan:** klip asli mulai dari close-up produk. Cahaya redup jadi jembatan
yang mudah karena warna kulit dan latar tidak terlalu terbaca.

> **Rambu klaim:** powerbank mengisi HP saat mati lampu itu **fungsi asli yang
> benar**, jadi aman. Yang dilarang: produk menyala sendiri atau menerangi
> seisi rumah — itu klaim kemampuan palsu (L-10), dan sudah dimasukkan ke
> negative prompt di atas.

---

## Kalau harus pilih satu untuk diuji duluan

**Ide 12 (warung).** Bukan yang paling spektakuler, tapi paling kecil peluang
gagalnya: cuma 3–4 orang duduk diam yang menoleh pelan, tanpa satu pun gerakan
anatomi berisiko — persis kebalikan dari dua ide yang kamu nilai gagal. Kalau
Ide 12 hasilnya bersih, itu membuktikan Aturan A benar, dan sisa ide bisa
dibangun di atas dasar itu.

**Ide 15** layak diuji kedua karena itu satu-satunya yang ditulis khusus untuk
produk yang benar-benar sedang kamu pakai untuk tes (powerbank).
