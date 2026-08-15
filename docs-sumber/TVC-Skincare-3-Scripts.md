# 3 SCRIPT TVC SKINCARE — 30 DETIK, LANDSCAPE 16:9
### Format: Seedance TVC Director (nutllwhy/seedance-tvc-director) · Standar craft: Super Bowl-class

---

## CARA PAKAI TEMPLATE INI (GANTI PRODUK DALAM 2 MENIT)

Semua script memakai placeholder. Ganti nilai di tabel ini, lalu find-replace ke seluruh script — selesai.

| Placeholder | Arti | Contoh isi |
|---|---|---|
| `[BRAND]` | Nama brand | Glowlab |
| `[PRODUK]` | Nama produk lengkap | Glowlab Barrier Serum |
| `[JENIS]` | Jenis produk | serum / moisturizer / sunscreen / cleanser |
| `[TEKSTUR]` | Tekstur formula | gel bening / krim putih / cairan keemasan |
| `[BAHAN]` | Hero ingredient | 5% Niacinamide + Ceramide |
| `[KLAIM]` | Satu klaim utama (SATU saja) | "Skin barrier lebih kuat dalam 7 hari" |
| `[KEMASAN]` | Deskripsi fisik kemasan | botol kaca frosted, tutup pipet emas |
| `[TAGLINE]` | Tagline penutup | "Kulitmu, versi terbaiknya." |

**Aturan penting (dari framework):**
- Logo, teks kecil, harga, disclaimer → **selalu post-production**, jangan minta AI merender teks.
- Kunci bentuk produk dengan **foto referensi kemasan asli** saat generate (kontur, rasio, warna, arah label).
- Satu iklan = **satu klaim**. Jangan tumpuk 3 benefit dalam 30 detik.

---
---

# SCRIPT 1 — "THE DROP" (Rute: Mechanism / Liquid Architecture)

**Gaya:** Luxury-clinical ala iklan La Mer / SK-II. Produk sebagai bintang absolut. Cocok untuk: serum, essence, produk dengan tekstur indah.

### 1. Konsep satu kalimat
Satu tetes [PRODUK] jatuh ke kulit dan kita mengikuti perjalanannya — dari tetesan, meresap, bekerja di bawah permukaan, sampai hasilnya terlihat di wajah.

### 2. Hook 0–3 detik
- **Frame pertama:** Macro ekstrem — tetesan [TEKSTUR] menggantung di ujung pipet, cahaya menembus dari belakang, hampir jatuh.
- **Event 0–3s:** Tetesan lepas → jatuh slow-motion → impact di permukaan kulit, riak halus menyebar.
- **Sound impact:** Sunyi total → satu nada bass dalam tepat saat impact.
- **Koneksi klaim:** Tetesan = formula; impact = awal cerita [KLAIM].

### 3. Master VO List (talent: perempuan, 28–35, tenang, intim, bukan "suara iklan")
```
VO_01: "Satu tetes."
—Start: 1.0s | Stop: 2.2s | Repeat: 1

VO_02: "Dengan [BAHAN], [PRODUK] bekerja sampai ke lapisan yang tak kamu lihat."
—Start: 6.0s | Stop: 11.5s | Repeat: 1

VO_03: "[KLAIM]."
—Start: 16.5s | Stop: 19.0s | Repeat: 1

VO_04: "[PRODUK] dari [BRAND]. [TAGLINE]"
—Start: 24.5s | Stop: 29.0s | Repeat: 1
```

### 4. Timeline / Shot Table (6 modul, 9 shot efektif)

| Modul | Waktu | Picture Event | Kamera | Sound | Tugas Komersial |
|---|---|---|---|---|---|
| M1 | 0–4s | Tetesan menggantung → jatuh → impact beriak di kulit (macro) | Macro statis → tilt mengikuti jatuhnya tetesan | Sunyi → bass hit di impact | Hook + perkenalan tekstur |
| M2 | 4–9s | [TEKSTUR] menyebar di permukaan kulit, meresap perlahan; jari menyapu lembut masuk frame | Macro tracking lateral pelan | Musik ambient masuk, tekstur suara "halus" | Bukti tekstur + [BAHAN] |
| M3 | 9–14s | Metafora mekanisme: benang-benang cahaya keemasan mengalir di bawah permukaan translusen (visual abstrak lapisan kulit) | Kamera menyelam pelan ke bawah "permukaan" | Musik naik satu layer | Visualisasi cara kerja |
| M4 | 14–19s | Wajah perempuan (30-an, kulit realistis, bukan porselen) — dia mengaplikasikan produk, kulit merespons; cahaya jendela pagi | Medium close-up, dolly-in sangat pelan | Musik hangat | Humanisasi + klaim (VO_03) |
| M5 | 19–24s | Dia menoleh ke kamera, senyum kecil percaya diri; cahaya di kulitnya kini lebih hidup dari M4 | Close-up, rack ke mata | Musik puncak lembut | Hasil / emotional payoff |
| M6 | 24–30s | Hero shot: [KEMASAN] masuk frame secara dinamis (diletakkan oleh tangan), settle jadi packshot stabil, background senada brand | Product hero: entry dinamis → lock statis | Musik resolve + sonic logo | Brand close (logo di post) |

### 5. Prompt Seedance 2.5 (copy-paste, bahasa Inggris untuk hasil generasi terbaik)
```
30-second luxury skincare commercial, 16:9 landscape, photorealistic, soft cinematic lighting.

0-4s: Extreme macro shot. A single drop of [TEKSTUR] hangs from a glass dropper tip, backlit, glowing. The drop releases, falls in slow motion, lands on smooth real human skin — a delicate ripple spreads outward. Hold the settle for a beat before cutting.

4-9s: Macro tracking shot moving laterally across skin as the [TEKSTUR] spreads and absorbs. A fingertip enters frame and glides gently through the product, leaving a luminous trail. The product visibly sinks into skin by end of block.

9-14s: Camera dives beneath a translucent skin-like surface. Abstract visualization: fine golden threads of light weave and strengthen into a lattice beneath the surface, suggesting repair from within. Elegant, scientific, not literal anatomy.

14-19s: Medium close-up, realistic Indonesian woman early 30s, natural healthy skin with real texture, soft morning window light from camera left. She presses [JENIS] into her cheek with two fingers, skin subtly responding with fresh hydration. Slow dolly-in.

19-24s: Close-up. She turns her head slightly toward camera, a small confident smile, eyes catching a soft eye-light. Her skin now reads visibly more luminous than the previous shot. No dialogue mouth movement.

24-30s: Hero packshot. A hand places [KEMASAN] onto a clean stone surface with soft brand-toned backdrop, product settles into a stable centered position, edge-lit, condensation-free, label facing camera. Camera locks off. Leave clean negative space upper third for logo in post.

Continuity: same woman throughout; product packaging locked to reference image (contour, ratio, color, label direction). No on-screen text, no logos, no brand names rendered.
```

### 6. Post-production & delivery
- Logo [BRAND] + [TAGLINE] sebagai supered text di M6 (frame 25s+), area kosong sudah disiapkan di upper third.
- Subtitle klaim di M4 jika dibutuhkan regulasi ("*hasil bervariasi / uji internal").
- Sonic logo brand di 28–30s.
- Color grade: warm highlight, clean neutral shadow — jangan over-orange (kulit harus tetap realistis).

### 7. Kenop risiko (yang benar-benar mengubah hasil)
1. **M3 metafora mekanisme** — paling rawan aneh; siapkan alternatif: ganti dengan macro kedua (tekstur di-swatch).
2. Konsistensi wajah talent M4→M5 — generate keduanya dalam satu block bila memungkinkan.
3. Akurasi kemasan — wajib pakai foto referensi produk asli.

---
---

# SCRIPT 2 — "SEHARIAN" (Rute: Real-Life Proof / Emotional Realism)

**Gaya:** Dove / Cetaphil Super Bowl — realisme emosional, proof lewat kehidupan nyata. Cocok untuk: sunscreen, moisturizer, produk dengan klaim tahan lama.

### 1. Konsep satu kalimat
Kita mengikuti satu perempuan melewati hari yang brutal — panas, AC, macet, deadline — dan satu-satunya yang tidak menyerah hari itu adalah kulitnya.

### 2. Hook 0–3 detik
- **Frame pertama:** Close-up dua jari mengambil [TEKSTUR] dari [KEMASAN] yang terbuka — cepat, purposeful, bukan ritual pelan.
- **Event 0–3s:** Tap-tap-tap cepat ke pipi → hard cut ke wajahnya diterpa matahari terik di jalan.
- **Sound impact:** Tiga ketukan tap sinkron dengan beat → kebisingan kota masuk mendadak.
- **Koneksi klaim:** Produk diaplikasikan = sebab; seluruh hari = pembuktian [KLAIM].

### 3. Master VO List (talent: perempuan, akhir 20-an, energik, sedikit wry/jenaka)
```
VO_01: "Hari ini, semua akan menguji kulitmu."
—Start: 2.5s | Stop: 5.0s | Repeat: 1

VO_02: "Panas. AC. Polusi. Jam lembur."
—Start: 8.0s | Stop: 12.0s | Repeat: 1

VO_03: "Tapi [PRODUK] dengan [BAHAN] tidak ikut menyerah. [KLAIM]."
—Start: 15.0s | Stop: 20.5s | Repeat: 1

VO_04: "Kulit kuat, hari selesai. [PRODUK] dari [BRAND]."
—Start: 25.0s | Stop: 29.0s | Repeat: 1
```

### 4. Timeline / Shot Table (7 modul, 11 shot efektif — pacing cepat)

| Modul | Waktu | Picture Event | Kamera | Sound | Tugas Komersial |
|---|---|---|---|---|---|
| M1 | 0–3s | Jari ambil produk → tap-tap-tap ke pipi → hard cut: wajah kena matahari terik | Macro cepat → hard cut ke close-up eksterior | 3 taps on-beat → noise kota | Hook: produk = sebab cerita |
| M2 | 3–8s | Montase pagi: dia jalan cepat di trotoar panas, silau, heat haze di aspal; kulit tetap segar | Tracking samping, handheld terkontrol | Beat perkusi mulai jalan | Ancaman #1: panas/UV |
| M3 | 8–13s | Kantor: AC menerpa (rambut sedikit tertiup), close-up kulit pipi — tetap lembap, tidak kusam; ketikan cepat di keyboard | Push-in dari medium ke close-up kulit | Beat + hum AC | Ancaman #2: udara kering |
| M4 | 13–18s | Sore: dia di angkot/ojek, debu jalanan, dia lap dahi dengan punggung tangan — kulit masih rata, glowing tipis | Close-up dari 3/4, cahaya sore keemasan | Beat melambat setengah | Ancaman #3 + bukti bertahan (VO_03) |
| M5 | 18–22s | Malam: pantulan wajahnya di kaca gedung/cermin lift — dia berhenti, agak kaget kulitnya masih oke, senyum kecil | POV refleksi, statis | Musik tipis, beat berhenti | Momen realisasi (payoff emosional) |
| M6 | 22–26s | Dia keluar gedung malam hari, lampu kota bokeh, jalan santai, bahu rileks | Slow-motion medium, lampu kota di background | Musik hangat penuh | Resolusi emosional |
| M7 | 26–30s | Packshot: [KEMASAN] di meja rias dengan lampu kota blur di jendela belakang; tangan menaruhnya, settle | Entry dinamis → lock statis | Musik resolve + sonic logo | Brand close (logo di post) |

### 5. Prompt Seedance 2.5 (copy-paste)
```
30-second skincare commercial, 16:9 landscape, photorealistic, energetic but premium, urban Indonesia setting.

0-3s: Extreme close-up, fast: two fingers scoop [TEKSTUR] from an open [KEMASAN], then three quick taps onto a woman's cheek, each tap on a music beat. Hard cut: her face in harsh bright midday sunlight on a city street, eyes confident.

3-8s: Controlled handheld tracking shot beside a young Indonesian woman late 20s walking fast on a hot sidewalk, heat haze rising from asphalt, sun flaring at frame edge. Her skin stays fresh and matte-luminous despite the heat.

8-13s: Office interior. Cold air-conditioning blows strands of her hair; push-in from medium shot to close-up of her cheek — skin remains hydrated and smooth, no dullness. Her fingers type fast on a keyboard in a brief insert.

13-18s: Golden hour. She rides through city traffic (motorbike passenger with open-face context or car window down), light dust in the air; she wipes her forehead with the back of her hand — skin still even and subtly glowing. Warm golden side light.

18-22s: Night. She catches her own reflection in an elevator mirror or glass building facade, pauses, slightly surprised, then a small proud smile. Static POV-style reflection shot, soft cool ambient light with warm accent.

22-26s: Slow-motion medium shot: she walks out of an office building at night, shoulders relaxed, city bokeh lights behind her, gentle breeze in her hair, quietly victorious.

26-30s: Packshot: a hand places [KEMASAN] on a vanity table, blurred city lights through a window behind, product settles centered and stable, label facing camera, soft key light. Clean negative space upper third for logo in post.

Continuity: same woman, same outfit logic across the day (jacket added at night allowed); product packaging locked to reference image. No rendered text or logos.
```

### 6. Post-production & delivery
- Time-stamp kecil opsional di sudut ("07:00 / 12:00 / 17:00 / 21:00") — tambahkan di post, memperkuat struktur "seharian".
- Logo + [TAGLINE] di M7. Disclaimer klaim di M4 bila perlu.
- Grade: kontras hangat-dingin per waktu hari (pagi netral → siang panas → sore emas → malam biru-hangat).

### 7. Kenop risiko
1. Konsistensi wajah + outfit lintas 7 modul — ini tantangan terbesar; pertimbangkan generate per 2 modul dengan frame terakhir sebagai referensi berikutnya.
2. Adegan motor/angkot rawan artefak — fallback: jendela mobil.
3. Jangan biarkan M5 dan M6 jadi dua "atmosfer pelan" berturut-turut — M5 harus punya beat kaget yang jelas (aturan no consecutive low-motion mirrors).

---
---

# SCRIPT 3 — "TERSANGKA GLOWING" (Rute: Pattern-Break / Comedy)

**Gaya:** CeraVe × e.l.f. Super Bowl — humor absurd yang presisi, klaim dibungkus komedi. Paling shareable, paling memorable. Cocok untuk: brand yang berani, target Gen-Z/milenial.

### 1. Konsep satu kalimat
Kulit seorang karyawan terlalu glowing sampai satu kantor menginterogasinya seperti sidang — tuduhannya: "tidak mungkin itu natural."

### 2. Hook 0–3 detik
- **Frame pertama:** Extreme close-up pipi glowing seorang perempuan… dilihat lewat kaca pembesar yang dipegang rekan kerja yang menyipit curiga.
- **Event 0–3s:** Kaca pembesar turun → wajah si penuduh menyipit → dramatic zoom ala film interogasi.
- **Sound impact:** Sting dramatis ala film detektif (berlebihan, komedik).
- **Koneksi klaim:** Kulit glowing = hasil [KLAIM]; kecurigaan = bukti sosial hasilnya kelihatan.

### 3. Master VO List
```
VO_01 (Penuduh, pria 40-an, nada jaksa serius): "Kulit seperti ini... tidak terjadi begitu saja."
—Start: 1.0s | Stop: 4.0s | Repeat: 1

VO_02 (Penuduh): "Filter? Liburan? Operasi?!"
—Start: 8.5s | Stop: 11.0s | Repeat: 1

VO_03 (Tersangka, perempuan 25-an, kalem — satu-satunya yang waras): "Cuma [PRODUK]. [BAHAN]. Tiap hari."
—Start: 14.0s | Stop: 18.0s | Repeat: 1

VO_04 (Announcer, hangat + sedikit menahan tawa): "[PRODUK] dari [BRAND]. [KLAIM]. Siap-siap dicurigai. [TAGLINE]"
—Start: 24.0s | Stop: 29.5s | Repeat: 1
```

### 4. Timeline / Shot Table (6 modul, 10 shot efektif)

| Modul | Waktu | Picture Event | Kamera | Sound | Tugas Komersial |
|---|---|---|---|---|---|
| M1 | 0–4s | Kaca pembesar memeriksa pipi glowing; penuduh menyipit; zoom dramatis ke wajahnya | Macro → snap zoom komedik | Sting detektif berlebihan | Hook + establish premis |
| M2 | 4–9s | Reveal: ruang meeting disulap jadi "ruang sidang" — 4 rekan kerja duduk berjajar sebagai juri (posisi kursi terkunci: kiri-ke-kanan), tersangka duduk tenang, lampu sorot | Wide reveal → medium penuduh mondar-mandir | Musik courtroom drama | Eskalasi absurd (VO_02) |
| M3 | 9–14s | Bukti dipresentasikan: foto pipi glowing di proyektor; juri ber-"hmmm" serempak condong ke depan; satu juri memotret dengan HP | Cut cepat: proyektor → reaksi juri → HP | Shutter kamera, gasp kecil | Komedi + kulit jadi bintang |
| M4 | 14–19s | Tersangka dengan tenang mengeluarkan [KEMASAN] dari tas, menaruhnya di meja — slow motion, semua mata mengikuti | Slow-mo hero: produk diletakkan, dolly-in ke produk | Musik berhenti → "thud" halus produk menyentuh meja | Product reveal = jawaban (VO_03) |
| M5 | 19–24s | Para juri saling pandang → satu per satu mengeluarkan HP mencatat nama produk; penuduh diam-diam memotret produk dari dekat | Pan cepat sepanjang barisan juri → close-up penuduh salah tingkah | Musik komedi ringan kembali | Social proof: semua ingin |
| M6 | 24–30s | Packshot: [KEMASAN] masih di meja "sidang", lampu sorot kini jadi beauty light; tangan tersangka memutar label ke kamera | Lock statis, satu gerakan produk | Musik resolve + sonic logo | Brand close + [KLAIM] (VO_04) |

### 5. Prompt Seedance 2.5 (copy-paste)
```
30-second comedic skincare commercial, 16:9 landscape, photorealistic, bright modern office, exaggerated courtroom-drama parody tone with precise comic timing.

0-4s: Extreme close-up of a young Indonesian woman's glowing cheek seen through a magnifying glass held by a suspicious male colleague in his 40s. The magnifying glass lowers revealing his narrowed eyes. Fast dramatic snap-zoom to his face, detective-movie style.

4-9s: Wide reveal: an office meeting room staged like a courtroom. Exactly four coworkers sit in a row as a jury — locked left to right: older woman in blazer, young man with glasses, mid-30s woman in hijab, young man in polo. The "suspect" (the glowing-skin woman, mid 20s, calm) sits alone under a spotlight. The accuser paces dramatically. Max two people moving at once.

9-14s: Quick cuts: a projector shows a close-up photo of her glowing cheek as "evidence"; the four jurors lean forward in unison and murmur; one juror snaps a photo with a phone. Keep the seating order identical.

14-19s: The suspect calmly reaches into her bag and places [KEMASAN] on the table in slow motion. Every head turns to follow it. Music stops; the product lands with a soft satisfying thud. Slow dolly-in on the product, label toward camera.

19-24s: Fast pan along the jury row: one by one they pull out phones and type the product name; end on a close-up of the accuser sheepishly photographing the product up close. Same four people, same seats.

24-30s: Packshot: [KEMASAN] still on the "courtroom" table, the harsh spotlight now softened into flattering beauty light, the suspect's hand rotates the label squarely to camera, then hands exit. Static lock-off, clean negative space upper third for logo in post.

Continuity: cast locked (1 suspect, 1 accuser, 4 jurors — headcount exact, seat order fixed); product packaging locked to reference image; no rendered text, logos, or readable projector text (blur the projected photo edges).
```

### 6. Post-production & delivery
- Teks "BUKTI A" di proyektor (M3) dan lower-third nama produk saat juri mencatat (M5) → tambahkan di post.
- Logo + [TAGLINE] + [KLAIM] di M6.
- SFX komedik (sting, gasp, shutter) di post untuk timing presisi — jangan andalkan AI audio untuk komedi.

### 7. Kenop risiko
1. **Multi-person adalah risiko terbesar** — jumlah & posisi juri wajib dikunci persis di prompt (sudah); kalau juri berubah-ubah antar shot, kurangi jadi 3 juri.
2. Komedi hidup dari timing — generate M4 (musik berhenti + thud) sebagai block terpisah bila timing meleset.
3. Ekspresi "menyipit curiga" bisa jadi seram alih-alih lucu — siapkan retake directive: "playful suspicion, sitcom energy, not menacing".

---
---

# LAMPIRAN: PRINSIP TVC KELAS SUPER BOWL YANG DIPAKAI DI ATAS

1. **Ditulis untuk 30 detik sejak awal** — bukan versi 60 detik yang dipotong. Setiap modul 4–6 detik membawa info komersial baru.
2. **Satu klaim, satu emosi** — simplicity beats clutter; emosi mendorong recall, humor membangun afinitas.
3. **Hook 0–3 detik terikat produk** — tanpa B-roll kota, tanpa adegan bangun tidur, tanpa logo di awal.
4. **Produk sebagai sebab cerita, bukan dekorasi** — di ketiga script, produk memicu konsekuensi naratif (tetesan memulai perjalanan; aplikasi memulai hari; produk diletakkan = jawaban interogasi).
5. **Eskalasi wajib** — tiap 4–6 detik ada gambar baru, relasi produk baru, atau progresi suara; tidak ada tetesan/rotasi yang diulang sebagai filler.
6. **Craft sinematografi beauty**: macro untuk tekstur, backlight + bounce untuk kulit, eye-light untuk emosi, slow-motion untuk keanggunan formula.
7. **Packshot di akhir dengan entry dinamis → lock statis**, ruang kosong untuk logo di post.

**Kapan pakai script mana:**
- Script 1 (THE DROP) → positioning premium, produk dengan tekstur/ingredient story kuat.
- Script 2 (SEHARIAN) → klaim daya tahan/proteksi, target pekerja urban, emosi relatable.
- Script 3 (TERSANGKA GLOWING) → brand awareness maksimal, viral potential, target muda.
