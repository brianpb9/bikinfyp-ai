# Panduan Pembuatan Konten UGC — alur dan prompt yang benar-benar dipakai

Ditulis 22 September 2026, atas permintaan Brian: *"saya ingin lihat prompting
yang anda gunakan dan flow yang anda gunakan dalam membuat video ugc brand."*

Dokumen ini **bukan** rancangan dan bukan ringkasan dari ingatan. Setiap prompt
di bawah dikutip apa adanya dari kode yang berjalan, dengan rujukan `file:baris`
supaya bisa kamu buka dan ubah sendiri. Kalau sebuah baris di sini tidak cocok
dengan kode, kodenya yang benar — dan dokumen ini yang harus diperbaiki.

**Cara membaca:** bagian 1 memberi peta; bagian 2–3 menjelaskan dua mesin yang
berbeda (retail dan sinematik); bagian 4 menunjukkan berkas mana yang mengubah
perilaku model saat kamu sunting; bagian 5 daftar gerbang mutu.

---

## 0. Yang perlu diluruskan lebih dulu

Aplikasi ini punya **dua mesin pembuat video yang berbeda**, bukan satu.
Mereka tidak berbagi penulis naskah, tidak berbagi prompt gambar, dan tidak
berbagi gerbang mutu:

| | **UGC Retail** | **Iklan Sinematik** |
|---|---|---|
| Untuk | Affiliate & Ads, gaya kreator | Iklan merek 30 detik |
| Durasi | 15 / 30 / 45 dtk | 29–33 dtk |
| Shot | 3–8 segmen | 9–14 shot |
| Penulis naskah | `lib/script-engine/` | `lib/iklan/naskah.ts` |
| Mesin video | BytePlus (Seedance) / kie.ai | kie.ai Grok (standard) atau BytePlus Seedance 2.5 (ultra) |
| Status | **produksi, dijual** | **beta khusus admin, belum dijual** |
| Dipicu dari | `/bikin/*`, dashboard brand | `/admin/iklan` |

Yang kamu sebut "video UGC brand" bisa berarti dua hal berbeda, jadi keduanya
dijelaskan. Kalau yang kamu maksud iklan merek sinematik, langsung ke bagian 3.

**Tiga jalur yang membuat baris job**, tidak ada yang lain:

| Jalur | Berkas | Untuk |
|---|---|---|
| Retail | `app/api/jobs/route.ts` | pengguna biasa lewat `/bikin` |
| Brand / kampanye | `lib/dashboard/render-cell.ts` | dashboard organisasi |
| Iklan Sinematik | `app/api/admin/iklan/route.ts` | beta admin |

---

## 1. Peta alur — dari foto produk sampai video siap posting

### 1.1 Alur retail (yang dijual hari ini)

```
/bikin/jenis     pilih Affiliate atau Ads
   ↓
/bikin/produk    nama, harga, merek, kategori, FOTO PRODUK  → baris products
   ↓
/bikin/gaya      template, format, level hook, paket, avatar
   ↓             POST /api/scripts/generate → naskah (LLM)
/bikin/skrip     pengguna membaca & MENYETUJUI naskah        ← gerbang HITL
   ↓
/bikin/storyboard  (bila dipakai) gambar per scene disetujui ← gerbang kedua
   ↓             POST /api/jobs → kredit DITAHAN, job QUEUED
/bikin/proses    antrean BullMQ → worker
   ↓
/bikin/hasil     video + unduh
   ↓
/bikin/paket     caption, hashtag, jam posting, checklist
```

Di dalam worker (`lib/postgres/worker.ts`), state job berjalan berurutan:

`QUEUED → GENERATING_VISUAL → [AWAITING_APPROVAL] → GENERATING_VOICE →
COMPOSITING → QC_CHECK → LABELING → READY`

Titik transisinya ada di `lib/postgres/worker.ts:853, 893, 974, 1009, 1095,
1107`. **Kredit baru dipotong saat job READY**, bukan saat job dibuat — kalau
gagal, jatahnya kembali.

### 1.2 Alur brand / kampanye (dashboard organisasi)

Bedanya dengan retail bukan mesin videonya — **mesinnya sama persis**. Yang
berbeda adalah cara pesanannya disusun: brand merender **matriks**, bukan satu
video.

```
/dashboard/campaign   pilih produk, format, template, rasio
   ↓                  pilih AVATAR (lib/avatar-presets.ts) × skenario
   ↓                  satu sel = satu skrip × satu avatar
lib/dashboard/render-cell.ts → renderSatuSel() untuk tiap sel:
   1. ambil skrip milik ORGANISASI (bukan milik anggota yang membuatnya)
   2. periksa kontradiksi: naskah ditulis untuk format/template yang sama?
   3. validasi ulang admisi (aturan yang sama dengan retail)
   4. setujui skrip atas nama alur ini
   5. TRANSAKSI: buat job + klaim scripts.job_id + potong jatah organisasi
   6. snapshot Skor FYP (kalau formatnya masuk jangkauan model)
   7. antre dengan prioritas "brand" (didahulukan atas retail)
```

Tiga hal yang layak kamu tahu karena menyangkut uang dan kepercayaan:

- **Klaim job atomik.** `UPDATE scripts SET job_id=… WHERE job_id IS NULL` di
  dalam transaksi yang sama dengan pembuatan job — supaya satu skrip tidak bisa
  dirender dua kali oleh dua orang di tim yang menekan tombol bersamaan.
- **Kepemilikan diperiksa terhadap organisasi**, bukan anggota. Produk dibuat
  satu orang, dibayar dompet organisasi, dirender siapa pun di tim.
- **Kontradiksi naskah ditolak dengan kalimat yang bisa ditindaklanjuti**:
  *"Naskah ini ditulis untuk format X, bukan Y. Buat naskah baru untuk format
  itu ya."* — bukan sekadar gagal.

`renderSatuSel()` sengaja tidak memutuskan apa pun soal kreatif. Ia
mengeksekusi satu sel dan melaporkan hasilnya; keputusan kreatif sudah terjadi
di penulis naskah dan perencana shot.

### 1.3 Alur Iklan Sinematik (beta)

```
/admin/iklan   pilih produk + mesin (standard/ultra)
   ↓           POST /api/admin/iklan → job format=iklan_sinematik, TANPA kredit
worker         lib/postgres/worker-iklan.ts → lib/iklan/pipeline.ts
   ↓
   1 naskah    LLM + audit klaim + audit realitas   (maks 6 percobaan)
   2 gambar    Seedream per shot + kurasi vision    (maks 3 putaran)
   3 klip      i2v per shot + kurasi frame berjalan (maks 2 putaran)
   4 suara     TTS per kalimat
   5 rakit     ffmpeg: potong, teks, musik, lockup
   6 gerbang   G1–G7 (tidak memblokir di beta)
   ↓
READY          qc_result memuat tiap gerbang + biaya terukur
```

Tahapnya dipetakan ke state job yang sama supaya terlihat normal di dasbor:
naskah/gambar/klip = `GENERATING_VISUAL`, suara = `GENERATING_VOICE`,
rakit = `COMPOSITING`, gerbang = `QC_CHECK`.

Setiap tahap menyimpan hasilnya ke folder kerja dan **dilewati kalau sudah
ada** — job yang diulang tidak membayar ulang klip yang sudah jadi
(`lib/iklan/pipeline.ts`).

---

## 2. Mesin UGC Retail

### 2.1 Dua model, dua tahap

Naskah retail tidak ditulis dalam satu panggilan. Ada **tahap ide** lebih dulu,
lalu **tahap penulis adegan** — dan keduanya memakai model yang berbeda:

| Tahap | Model | Berkas | Catatan |
|---|---|---|---|
| Ide + gerbang FYP | `claude-opus-5` | `lib/script-engine/ide.ts` | sekali per permintaan, maks 2 putaran |
| Penulis adegan | `claude-sonnet-4-6` | `lib/script-engine/llm.ts` | per varian, maks 3 percobaan |

Tiga varian naskah ditulis **paralel** (lebar 3). Varian ke-*i* memakai ide
peringkat ke-*i*.

Tahap ide hanya jalan untuk tier tertentu (`config.ideaStageTiers`, bawaan
`super_hq`) dan selalu untuk organisasi. Kalau tahap ide gagal atau gerbangnya
tidak lolos, **naskah tetap ditulis** — hanya tanpa ide, dan tiga kandidat
teratas dikembalikan ke UI.

### 2.2 System prompt penulis adegan

`lib/script-engine/llm.ts:88–194`. Dirakit dari lima potongan berurutan:
blok statis → `standard-10.md` (§A+§B) → `MASTER-UGC-*.md` (§1) → catatan
empat baris yang dicek mesin → bentuk keluaran JSON.

Pembukanya, verbatim:

```text
You write short-form Indonesian UGC ad scripts as production prompts.

HARD RULES — a script that breaks any of these is rejected by a validator downstream, so do not break them:
- Never write prices as digits. Write them as words.
- No medical claims, no whitening, no 'instant', no 'terbaik', no competitor names.
- Only claim what is visible in frame or clearly subjective.
- Never write these words, they are mispronounced by TTS: 'lecet' (use 'luka'), 'tumit' (use 'kaki'),
  'busanya' (use 'lembut banget'). Never write '-nya di' without a buffer: write 'detailnya ada di bawah'.
- No double negatives in one sentence.
- The HOOK must not name the product.
```

Bagian yang paling mahal dipelajari adalah **FILTER SAFETY** — penyedia video
menolak prompt berdasarkan kosakata, bukan maksud:

```text
FILTER SAFETY — the video provider rejects prompts on vocabulary, not intent.
A fully-clothed corridor scene was rejected as NSFW because of the words around it. So:
- Never write: towel, bathrobe, shower, bathing, wet skin/body/hair, undressing, changing clothes.
- Never put a bathroom door and a second person in the same scene. Keep one person in frame.
- NEVER USE NEGATIONS ABOUT PEOPLE. Not 'no other residents', not 'her face is never sharp' …
  Two reasons: the filter reads the words you wrote, and the video model renders what you name —
  'no other residents' is how you get other residents.
  … Write the positive instead: 'the corridor is empty', 'the camera stays on her hands'.
```

Aturan struktur, verbatim:

```text
STRUCTURE:
- Exactly one HOOK first, 1-5 BODY, exactly one CTA last. Timecodes contiguous, no gaps.
- Each segment 4-6 seconds. HOOK 3-5s. CTA >= 4s.
- product_state follows an arc: the hook is 'hidden' or 'partial' and NEVER 'hero'.
  The CTA is always 'hero'. Nothing is a hero before the CTA.
- start_state describes what is ALREADY TRUE in the first frame. The video model moves TOWARD
  the prompt, so anything you do not state as already true will be invented.
- 'why' must say which story beat the segment serves: setup, tension, or payoff.

WRITE dialogue in casual Indonesian. Write every other field in English.
```

Keluarannya JSON dengan 15 field per segmen (`block, label, start, end, text,
start_state, framing, angle, camera, action, product_state, expression,
audio_note, why, mode`), divalidasi Zod: 3–8 segmen.

### 2.3 User prompt — urutan perakitannya

`lib/script-engine/llm.ts:362–435`, potongan kosong dibuang:

1. **Petunjuk ide** dari tahap ide (one-liner, mekanik, story setup/tension/
   payoff, peran produk, rencana brand fidelity, mode, format + beat table)
2. `PRODUCT: …`
3. **"WHAT THE PRODUCT ACTUALLY IS"** — deskripsi yang dibaca dari foto produk,
   dengan kalimat penentu: *"The category label above is only a keyword guess.
   WHERE THEY DISAGREE, THIS DESCRIPTION WINS."*
4. `DURATION: … exactly N segments.` — N = 3 (≤15 dtk), 4 (≤20), 5 (≤30), 6
5. `CONTENT TYPE:` + kalimat CTA yang berbeda per jenis:
   - TVC → wajib menyebut merek, **dilarang** menyebut keranjang/link
   - Ads → persis `"Detailnya ada di bawah ya"`, tanpa teks layar
   - Affiliate → wajib memuat label keranjang (mis. "keranjang kuning")
6. **STORY OS** (khusus Ads) — ditulis terbalik: BUTTON dulu, lalu SPIKE, HOOK,
   FRICTION
7. `REGISTER:`
8. **Aturan terukur** — jendela kata, filler wajib, minimal dua partikel,
   kata ganti sesuai register, perangkat hook, batas kata per shot
9. Saran perangkat hook berbeda per varian
10. Contoh nada dari template
11. Blok **REPAIR** bila ini percobaan perbaikan
12. `Return JSON only: {"segments":[...]}. No prose around it.`

Blok STORY OS untuk Ads, verbatim:

```text
STORY OS (Ads only) — write the beats in THIS order, then lay them out in time:
1. BUTTON first (the last 3-6s): one small question left unanswered, and the CTA lives INSIDE it …
2. SPIKE: the protagonist beats their own pressure IN FRONT OF A WITNESS … at 65-80% of the duration.
3. HOOK: the conflict is already in frame 1, with NO dialogue.
4. FRICTION (write last): pressure rises at least TWICE between hook and spike …
BODY IS NOT EXPLANATION: no 'aslinya...', no describing the product, no benefit claims.
The viewer concludes.
```

### 2.4 Lingkar perbaikan — dan kenapa template tidak pernah disajikan

Maksimal **3 percobaan** penulis (`MAKS_PERBAIKAN_LLM`), tiap percobaan boleh 2
kali parse ulang kalau JSON-nya rusak. Tiap naskah yang keluar langsung dinilai
`validateScript(..., "strict")`. Yang gagal dikirim balik dengan blok ini:

```text
THIS IS A REPAIR. Your previous script was rejected by the validator for exactly these reasons:
  - <keluhan kumulatif>
Fix every one of them AT ONCE. This list is cumulative — it includes rules you broke in earlier
attempts, so a fix that satisfies one line while breaking another is not a fix. Count your words
before you answer … Keep whatever was already working; do not rewrite the idea.
```

**Yang penting untuk kamu tahu:** di jalur berbayar, kalau LLM gagal tiga kali,
sistem **tidak** diam-diam menyajikan naskah template. Ia melempar
`TemplateTidakDisajikan` → 503, dengan pesan netral ke pengguna dan sebab teknis
lengkap hanya di log. Template hanya dipakai sebagai **contoh nada** dan
**kerangka waktu**, tidak pernah sebagai naskah yang dijual.

### 2.5 Gerbang FYP di tahap ide

Sebelum naskah ditulis, ide dinilai oleh model kedua yang tidak membuatnya.
Enam dimensi dengan bobot dan ambangnya masing-masing:

| Dimensi | Bobot | Ambang |
|---|---:|---:|
| scroll_stop | 30 | ≥7 |
| distinctiveness | 20 | ≥7 |
| story_pull | 20 | ≥7 |
| payoff | 10 | ≥7 |
| brand_fidelity_plan | 10 | ≥8 |
| nativeness | 10 | ≥7 |

Lulus bersih total ≥ **75**; 72–74 lulus tipis **hanya kalau semua dimensi
lewat ambangnya**. Penilainya diberi jangkar konkret, bukan kata sifat:

```text
  9-10 = as strong as the reference ideas that passed and were produced: "Disimpan di brankas"
        (a bar of soap kept in a safe), "Museum" (soap displayed behind glass with gloves) …
  4-6  = sensible but generic: needs a sentence to be understood, or would survive a product swap.
  0-3  = an ordinary ad. Pain hook, sensory review, packshot.
Do not cluster in the middle out of caution.
```

Mekanik yang skornya < 45 **dilarang muncul lagi** di putaran kedua. Semua
keputusan gerbang dicatat ke `<storageDir>/fyp-gate-log.jsonl`.

### 2.6 Aturan yang menolak naskah

Ini daftar lengkap penegak mesin di `lib/script-engine/validator.ts`. Kolom
terakhir menandai aturan yang tetap menolak keras bahkan di mode longgar.

| Kode | Arti | Keras selalu |
|---|---|:--:|
| L-01 | Dialog wajib ≥2 partikel gaul (`deh/sih/dong/ya/…`); mati untuk TVC | |
| L-02 | Harga wajib disebut — hanya untuk template price-led | |
| L-03 | CTA wajib menyebut label keranjang; mati untuk TVC dan Ads | ✔ |
| L-04 | Wajib ≥1 jeda lisan (`nah`, `sumpah`, `eh`, …); mati untuk TVC | |
| L-05 | Total kata harus di dalam jendela; **kedua sisi** menolak | ✔ |
| L-06 | Nama produk dilarang di hook (kecuali keluarga H4/H11) | |
| L-10 | Overclaim absolut (`pasti`, `dijamin`, `terbaik`, `100%`) | ✔ |
| L-11 | Klaim medis (`menyembuhkan`, `dokter`, `klinis`, `ibu hamil`) | ✔ |
| L-12 | Bahasa iklan formal (`beli sekarang`, `promo terbatas`) | |
| L-13 | Urgensi palsu (`stok terakhir`, `habis hari ini`) | ✔ |
| L-14 | Setiap angka dan harga — digit, "85 ribu", maupun terbilang — wajib cocok data produk | ✔ |
| L-15 | Merek pesaing tidak boleh dijelekkan | |
| L-16 | Kata ganti tidak boleh campur dan wajib sesuai register | |
| L-17 | Tier bersuara: dilarang tanda kurung instruksi di teks yang diucapkan | ✔ |
| L-18 | Cue pembawaan hanya di `tts_text`; `text` wajib dialog bersih | ✔ |
| L-19 | Hook wajib memakai ≥1 perangkat retoris yang dikenali | ✔ |
| L-21 | Arahan visual dilarang memuat kosakata pemicu penyaring **atau negasi tentang orang** | ✔ |
| L-22 | Dialog wajib aksara Latin | ✔ |
| T-01 | TVC: penutup wajib menyebut merek | ✔ |
| T-02 | TVC dilarang menyebut "keranjang" | ✔ |
| T-03 | TVC: dilarang dua negasi menumpuk | ✔ |
| A-01 | Ads: penutup wajib mengarahkan ke bawah/bio | ✔ |
| A-02 | Ads dilarang menyebut "keranjang" | ✔ |
| S-04 | Kalimat shot 2 wajib ALASAN, dilarang dibuka `isinya/teksturnya/…` | ✔ |
| S-05 | Kategori jenuh menuntut level hook minimal L2 | ✔ |
| S-09 | Batas kata **per shot** (mengikuti pita tempo), tier bersuara | ✔ |
| SA1 | Ads: segmen terakhir wajib CTA + menyisakan satu tanya | ✔ |
| SA2 | Ads: wajib beat SPIKE, bersaksi, di 65–80% durasi | ✔ |
| SA4 | Ads: ≥2 beat FRICTION yang benar-benar menggeser sesuatu | ✔ |
| SA6 | Ads: ≥2 dari 3 jembatan produk | ✔ |
| SA8 | Ads: body dilarang menjelaskan atau mengucapkan manfaat | ✔ |

**Tiga hal yang kodenya jujur akui belum ditegakkan** — supaya kamu tidak
mengira ada penjaga yang sebenarnya tidak ada:

- **L-23** (klaim hasil instan: `instan`, `memutihkan`, "langsung bersih")
  terdaftar sebagai aturan keras, tapi **hanya dijalankan di QC-07 pasca-render**,
  bukan saat naskah dibuat.
- **Standar baris 1** (anomali di frame pertama) dan **baris 11** (variasi
  katalog antar video) punya fungsinya, tapi belum dipanggil jalur produksi
  mana pun. Baris 7 (brand fidelity) hanya hidup sebagai prompt.
- **SA3, SA5, SA7** sengaja tidak diukur mesin — ditandai `"juri"` karena tidak
  bisa diturunkan dari struktur.

### 2.7 Jendela kata — kenapa naskah bisa ditolak karena "kepanjangan"

L-05 dan S-09 memakai **pita tempo**, bukan satu angka:

| Genre tempo | ≤7 dtk | 8–20 dtk | >20 dtk |
|---|---|---|---|
| haul | 4,4–5,5 kata/dtk | 2,2–4,2 | 2,2–4,0 |
| cerita | 3,0–4,2 | 1,7–2,9 | 1,5–2,7 |
| ads tenang (Ads / TVC) | 0,3–1,6 | 0,3–1,5 | 0,3–1,5 |

Perhatikan betapa jauh lebih sunyi iklan Ads/TVC dibanding haul affiliate. Ini
disengaja: iklan merek yang diisi ocehan terdengar seperti jualan pasar.

### 2.8 Perencana shot — dari naskah jadi prompt video

`lib/media/shot-planner.ts:694 planShots()`. Prompt satu shot dirakit
**berlapis**, dan urutannya menentukan hasil. Kalau template punya peran
eksplisit, **peran yang memimpin** dan framing bawaan format tidak ikut sama
sekali — karena pada render bukti 13 Agustus, framing di depan membuat model
mengabaikan peran template.

Lapisan yang disisipkan (semuanya verbatim di kode):

**Kunci jumlah tangan** — lahir dari tangan ketiga yang terus muncul:

```text
Exactly two hands are visible in the entire frame, and both belong to the same single person.
The SAME hand that holds the product also operates it, keeping its grip the whole time.
The second hand does only one thing: receive the product or show the result.
The frame stays at exactly two hands from the first frame to the last, at every edge.
```

**Kunci identitas produk** — disisipkan di hampir setiap beat:

```text
the exact same product from the reference image, identical shape, identical colours, identical label,
do not redesign or replace the product … The ENTIRE product and its full label stay completely inside
the frame at all times, with visible margin on every side — never cropped … The large bold brand name
on the label stays sharp, steady and perfectly legible the whole time, reproduced with the EXACT same
letters and spelling as the reference image (do not alter, add, drop, or misspell any letter).
Any smaller printed lines read as fine printed TEXTURE at this distance …
Never render invented words or invented figures anywhere on the product
```

**Detik pertama** — melawan pembukaan beku:

```text
The very first frame is ALREADY mid-action — the shot never opens on a held pose or a static product.
Within the first second something visibly changes … No frozen opening beat.
```

**Kunci ukuran asli** — karena speaker 18 inci pernah digambar seukuran telapak:

```text
Every "<nama produk>" in frame appears at its true real-world size relative to the person handling it …
and the camera keeps a normal conversational distance from it.
```

Aksi demo ditentukan **bentuk produk**, bukan kategori. Sabun batang misalnya:
*"wetting the solid bar under running water and rubbing it between both palms
until a rich lather builds…"*

Yang benar-benar dikirim ke penyedia bukan prompt shot mentah, melainkan
pembungkus terakhir (`lib/providers/teks-prompt.ts:113`):

```text
<prompt shot>. Single continuous take of exactly one person, both hands with five fingers each,
natural undistorted face and anatomy, solid opaque objects that stay whole, realistic skin texture,
product packaging stable and undeformed with its printed label legible throughout.
Do not add any text overlay, caption bar, subtitle, watermark, or invented logo.
```

> **Pelajaran mahal yang layak kamu tahu.** Dulu bentuknya
> `"<prompt>. Negative: <daftar cacat>"`. Pembersih negatif membuang kata "no"
> dari tiap butir — jadi yang benar-benar terkirim adalah permintaan
> *"extra hands, third hand, second person"* **tanpa penanda negasi**. Job
> `2f95311f` berakhir REFUNDED setelah Rp20.250 keluar. Bentuk itu dibuang
> 3 September 2026.

### 2.9 Empat belas mode kamera

`knowledge/rules/modes.md` dibaca runtime (`lib/media/mode-kamera.ts:31`), tidak
disalin ke kode. Satu mode per video; segmen yang kameranya bertentangan dengan
modenya gagal gerbang.

Mode yang dipakai naskah diubah jadi dua kalimat prompt:

```ts
`Camera mode ${m.id}: ${m.kamera}. The person on screen is ${m.talent}.`
```

Contoh nyata untuk SELFIE: *"Camera mode SELFIE: arm-length, eye level, static
or micro-drift. The person on screen is speaks straight to lens."*

Urutan kalah-menang: shot pembuka tanpa wajah → gaya rekam pilihan brand → mode
dari naskah. Kolom `Never` di tabel **tidak dikirim ke prompt** — ia aturan
untuk gerbang, bukan untuk model.

### 2.10 Frame pertama dan identitas presenter

Konsistensi dimenangkan di **tahap gambar**, bukan tahap video — karena Gemini
menerima wajah AI sebagai referensi sementara Seedance belum.

- **CAST-REF** (`lib/media/cast-ref.ts`): tiga potret per avatar dibuat sekali
  lalu di-cache. Frame 2 dan 3 **diturunkan** dari frame 1 dengan kalimat
  kunci: *"Keep exactly the same person as the reference: same face, same
  facial proportions, same skin tone, same hair, same wardrobe. Change ONLY
  what is described next."*
- **Frame awal per segmen** diturunkan dari CAST-REF + foto produk, diperiksa
  QC-F1, dan digulung ulang maksimal 2×. Foto produk **asli** dikirim ulang
  tiap percobaan supaya pergeseran bentuk tidak menumpuk.
- Hanya verdict **PASS** yang boleh jadi referensi. FAIL atau UNVERIFIED →
  kembali ke foto produk asli, yang setidaknya benar.
- **Acuan tegak** (`lib/media/acuan-tegak.ts`): foto mendatar diberi pita buram
  alih-alih dipotong, karena memotong sisi berarti membuang label. Ini yang
  dulu membuat 57% frame job `2a040ce1` jadi pita blur.

### 2.11 Gerbang prompt — dijalankan sebelum satu rupiah keluar

`lib/media/gerbang-prompt.ts` dipanggil **sesudah** prompt diarsipkan dan
**sebelum** panggilan penyedia mana pun. Temuan keras = job berhenti tanpa
biaya render. Empat aturan, semuanya keras:

| Aturan | Menolak kalau |
|---|---|
| BAHASA | empat lapis kunci bahasa Indonesia tidak lengkap di prompt shot |
| UKURAN | tidak ada `true real-world size` dan `normal conversational distance` |
| L-21-NEGASI | ada negasi yang menyebut orang ("no second person") |
| L-21-KOSAKATA | ada kosakata bertetangga NSFW (handuk, shower, ganti baju, penekanan tubuh) |

Nama produk **ditutupi dulu** sebelum diperiksa — supaya "Bright Shower Gel"
tidak memblokir 21 dari 21 shot-nya sendiri.

### 2.12 Penyedia video dan failover

| Paket | Mesin | Model | Resolusi |
|---|---|---|---|
| standard | kie.ai | `grok-imagine/image-to-video` | 720p |
| premium | BytePlus | `dreamina-seedance-2-0-mini-260615` | 720p |
| ultra | BytePlus | `dreamina-seedance-2-5-260628` | 720p |

Gambar: `dola-seedream-5-0-pro-260628` (storyboard) dan `gemini-3.1-flash-image`
(frame pertama + CAST-REF).

**Tidak ada parameter seed** di mana pun, dan tidak ada image-strength.
Konsistensi sepenuhnya bergantung pada gambar referensi dan teks prompt.

Arah failover **sengaja tidak simetris**: standard boleh jatuh ke BytePlus
(mesin lebih mahal, ruginya di pihak kita), tapi premium dan ultra **tidak
pernah** jatuh ke kie.ai — lebih baik job gagal dan dikembalikan daripada
diam-diam diturunkan kelasnya. Di produksi, mock **tidak pernah** dipakai
sebagai cadangan: outage penyedia harus menggagalkan job, bukan mengganti media
palsu.

### 2.13 Suara

Model TTS: `gemini-3.1-flash-tts-preview`. Suara dikunci per avatar (Aoede
untuk hijaber, Kore untuk lokal, Charon untuk pria, dan seterusnya — 12
persona).

Instruksi gaya **dipisah** dari transkrip supaya tidak ikut dibacakan:

```text
# STYLE INSTRUCTION
<gaya persona>
Do not read the style instruction or section headings aloud.

# TRANSCRIPT
<dialog>
```

Dua penyiapan teks yang penting: `tts_text` boleh memuat tag pembawaan dari
daftar tertutup (`[short pause]`, `[giggles]`, `[whispers]`, …) yang **tidak
pernah** sampai ke UI maupun prompt video; dan `hargaTerbilang()` mengubah
"Rp299.000" jadi kata, karena model membaca angka dengan ngaco.

**Kapan TTS dipakai:** `talking_head` dan `tvc` mempertahankan audio native
Seedance (lip-sync aslinya). `hands_only` diganti Gemini TTS — pembicaranya
memang tidak pernah terlihat. `silent_caption` tanpa suara sama sekali.

### 2.14 Perakitan akhir

Urutannya: **TTS → kartu caption → composite → overlay klaim → end card → QC**.
Klaim sengaja sebelum end card; end card sengaja sebelum QC supaya durasi yang
diperiksa sama dengan durasi yang dikirim.

| Parameter | Nilai |
|---|---|
| Resolusi | 720×1280 |
| Video | libx264, preset veryfast, **CRF 26**, yuv420p |
| Audio | AAC 192k, 44,1 kHz, stereo |
| Loudness | **−14 LUFS**, TP −1, LRA 7 — dua tahap (in-graph + dua lewatan) |
| Ducking | musik yang dikompres, dipicu suara (`threshold=0.03:ratio=6`) |
| Caption | Poppins ExtraBold 58px, dirender PIL jadi PNG, bukan drawtext |
| End card | 2 detik, logo maks 45% lebar |
| Label AIGC | metadata `racun_aigc=true` |

**Yang sengaja tidak ada:** transisi antar klip (potongan keras), fade audio di
mode bersuara, watermark visual (dihapus 7 Agustus — tinggal metadata), dan
musik di tier bersuara (dibatalkan 14 Agustus setelah diukur tidak terdengar).

Timing caption adalah **heuristik**, bukan forced alignment: kata dibagi dari
`start`/`end` segmen, 3–5 kata per kartu. Harga dan nama produk disorot kuning.

---

## 3. Mesin Iklan Sinematik — prompt lengkap

Ini format yang saya bangun 14–15 September 2026 setelah kamu menetapkan tiga
video di `~/Downloads/contohugckonten` sebagai batas bawah mutu. Standarnya
ditulis di `knowledge/rules/REFERENSI-IKLAN-SINEMATIK-v1.md`.

### 3.1 Penulis naskah — system prompt

Model: `claude-opus-5` (`lib/iklan/naskah.ts:40`), `effort: "high"`,
`thinking: adaptive`, keluaran dipaksa lewat skema Zod, `max_tokens: 32000`.

System prompt-nya panjang dan disengaja — ia memuat **tiga referensi yang
dibedah**, bukan kata sifat. Kutipan pembukanya (`lib/iklan/naskah.ts:150`):

```text
You are the creative director and scriptwriter of a top Indonesian commercial studio.
You write 29–33 second vertical (9:16) cinematic product films that run as paid social ads
(TikTok, Instagram, Shopee video) for Indonesian sellers. Most viewers watch with the SOUND OFF
and decide in two seconds.
Each film is rendered shot by shot: every shot becomes one AI-generated still keyframe animated
into a short clip, then cut together with a voice-over, music, on-screen text and an end card
that uses the seller's REAL product photo.

THE QUALITY BAR — three reference films the client approved. Match or beat them:
1. EIGER backpack (30s, 9 shots, emotional brand story) …
2. BLUEPRINT mPOS (36s, ~22 shots, product ad) …
3. HALUAN DIGITAL NETWORK (32s, 11 shots, company profile) …
```

Aturan pentingnya, ringkas (teks lengkapnya di berkas):

- **HOOK** (shot 1, 1,5–2,5 dtk): masalahnya terlihat jelas di frame 0, wajah
  yang cocok dengan rasa sakitnya, teks layar berisi frasa kunci. Dilarang:
  nama produk, sapaan, logo, "Pernah nggak…".
- **REVEAL produk asli sebelum detik 8** — satu-satunya shot (selain lockup)
  tempat label boleh terbaca, karena di situ **foto produk aslimu ditempel**,
  bukan digambar AI.
- Di shot lain produk hanya boleh `dipakai`: dipegang atau digunakan, label
  dipalingkan/kecil/blur. Alasannya keras: *"its lettering always garbles"*.
- **Tepat satu shot BUKTI** (3–4 dtk): produk terlihat bekerja dalam satu frame
  terkunci, dan `transformasi_en` berisi keadaan SESUDAH dari frame yang sama.
  Editnya larut dari sebelum ke sesudah dan menempelkan label "Ilustrasi"
  sendiri.
- **KLAIM**: model wajib lebih dulu mendaftar `klaim_sumber` — manfaat yang
  benar-benar tertulis di deskripsi penjual atau tercetak di label. VO, teks
  layar, dan gambar **hanya boleh menjanjikan itu**. Kata seperti *dijamin,
  pasti, 100%, permanen, terbaik, instan, profesional* dilarang kecuali
  memang ada di sumber.
- **VO menjual, bukan menarasikan**: dilarang mendeskripsikan yang sudah
  terlihat. 5–8 kalimat, Bahasa Indonesia baku tapi hangat, tanpa slang.
- **Teks layar membawa film saat suara mati**: minimal separuh shot berteks.

Bagian yang paling banyak menyelamatkan render adalah **REALITY FIRST**:

```text
REALITY FIRST — the image and video models hallucinate whatever you leave open:
- Every shot must be something that genuinely happens in real life …
- Motion is physically continuous: vehicles move forward in the direction they face,
  people finish actions they start, nothing changes place, time of day or clothing …
- For every shot write hindari_en: the specific mistakes a model is likely to make in that exact shot.
- Never describe invisible phenomena (heat shimmer, heat haze, smell, aroma, sound waves) …
  image and video models draw them as smoke, fog or lines.
```

Setiap kalimat di sana lahir dari render yang gagal, bukan dari teori.

### 3.2 Data produk yang disuntikkan

`blokProduk()` (`lib/iklan/naskah.ts`) merakit blok ini dan mengirimnya
bersama **foto produk asli** sebagai gambar:

```text
Nama produk (dari penjual): …
Merek: …
Kategori: …
Deskripsi: …
Klaim yang boleh dipakai: …   ← kalau kosong: "hanya yang tertulis di deskripsi di atas."
Tampilan produk (dari foto): …
Harga: …                       ← kalau kosong: "tidak diberikan penjual."
Tempat membeli: …
Kontak untuk end card: …
```

Lalu `REALITY FACTS` sesuai kategori produk ditempelkan (lihat 3.6).

### 3.3 Putaran perbaikan — kenapa maksimal 6, dan kenapa "minimal"

Naskah tidak langsung diterima. Urutannya (`lib/iklan/naskah.ts:582+`):

1. `periksaNaskah()` — aturan yang bisa dihitung: durasi total 29–33 dtk,
   jumlah shot, panjang VO, frasa terlarang, struktur beat.
2. Kalau lolos, dua audit LLM berjalan **paralel**: `auditKlaim()` (apakah tiap
   janji ada dasarnya di data penjual) dan `auditRealitas()` (apakah ada shot
   yang mustahil secara fisik).
3. Kalau masih ada pelanggaran, naskahnya dikembalikan dengan instruksi ini:

```text
Naskah ini melanggar aturan berikut. Kembalikan naskah LENGKAP, tetapi ubah SEMINIMAL
mungkin: perbaiki hanya shot/kalimat yang disebut, pertahankan semua bagian lain persis
seperti adanya. Jangan menambah janji baru tentang produk.

Pelanggaran sekarang:
- …
Pelanggaran dari percobaan sebelumnya yang TIDAK BOLEH muncul lagi:
- …
```

Kata **SEMINIMAL** itu penting dan mahal: pada render uji Faza v4, penulisan
ulang total memperbaiki satu pelanggaran dan memunculkan tiga yang baru, empat
kali berturut-turut. Riwayat pelanggaran lama ikut dikirim supaya perbaikan
tidak memutar balik ke kesalahan sebelumnya.

### 3.4 Prompt gambar kunci (Seedream)

Model: `dola-seedream-5-0-pro-260628` (`lib/iklan/keyframe.ts:31`), menerima
`negative_prompt`. Prompt dirakit berlapis oleh `promptKeyframe()`:

1. **Anti-kolase, dinyatakan paling awal** — karena dua gambar acuan pernah
   membuat Seedream menggambar kolase tiga panel:
   ```text
   Create ONE single continuous photograph that fills the whole frame — never a collage,
   grid, split screen, triptych or multiple panels.
   ```
2. **Acuan produk**: *"REFERENCE IMAGE 1 shows ONLY the product. It is the
   authority for the product's shape, colour, material, proportions and label.
   Do NOT copy that photo's background, framing, text or graphics."*
3. **Acuan aset berulang — IDENTITY ONLY**, karena acuan pernah membuat adegan
   "motor melaju saat matahari terbit" keluar sebagai pose jongkok:
   ```text
   REFERENCE IMAGE n shows "<id>" for IDENTITY ONLY: keep exactly the same face/hair/clothing
   (person) or the same model, shape, colour and details (object). Do NOT copy that image's
   pose, framing, location, lighting or action — this is a different moment.
   ```
4. **LOOK** (gaya visual, identik sepanjang film) + **REAL-WORLD FACTS**.
5. Ukuran shot + `visual_en` dari naskah.
6. Untuk `insert`/`macro`: *"FRAMING IS TIGHT: fill the frame with the object
   and at most hands/forearms."*
7. Penutup realisme + larangan teks:
   ```text
   High-end Indonesian TV commercial still, photographic realism, natural skin texture,
   correct hands with five fingers, believable physics, liquids coming from their real source,
   actions aimed at the right part. Riders wear helmets. No logos or badges of any other brand …
   Absolutely no added text, captions, subtitles, watermarks, logos, signage lettering or
   user-interface elements.
   ```
8. `AVOID (negative prompt): …` — gabungan `hindari_en` dari naskah, negatif
   per kategori, dan negatif global.

**Shot REVEAL dan LOCKUP diperlakukan terbalik**: prompt-nya melarang produk
muncul sama sekali, dan meminta permukaan kosong —

```text
NO product, NO bottle, NO packaging, NO people, NO hands, NO text, NO logos.
```

karena foto produk aslimu yang ditempel belakangan. Ini yang membuat label di
end card selalu benar.

### 3.5 Prompt gerak (image-to-video)

`promptGerak()` (`lib/iklan/klip.ts:46`) merakit:

```text
<gerak_en dari naskah> Camera: <kamera>.
Look: <gaya visual>
The product stays exactly as in the first frame: same shape, colour and label, never morphing,
never duplicating.
LOCKED LOCATION: the place, time of day and lighting stay exactly the same for the whole shot;
the camera never leaves this scene.
Cinematic commercial motion, smooth and controlled, natural physics, stable faces and hands.
Riders keep their helmets on.
No text appearing, no subtitles, no logos appearing, no one speaking to camera, no sudden new
objects, no scene cut.
REAL-WORLD MOTION: <fakta gerak per kategori>
AVOID: <hingga 40 butir negatif>
```

`LOCKED LOCATION` ditambahkan setelah shot "berangkat di jalan pagi" berakhir
di dalam garasi malam — model video mengarang tujuan kalau tidak dikunci.

### 3.6 Lapisan realitas — sumber `REAL-WORLD FACTS`

`lib/iklan/realitas.ts` menyimpan fakta per kategori produk dan daftar negatif.
Contohnya, ini yang menghentikan halusinasi posisi mesin yang kamu keluhkan:

```text
AUTOMATIC SCOOTER (the most common in Indonesia, e.g. the everyday 110–160cc matic):
the engine and CVT form one swingarm unit at the LOWER REAR of the bike, beside and ahead
of the rear wheel, below the body panels. … There is NO engine in the flat footboard,
NO engine under the seat opening (under the seat is a plastic storage box), and NO tall
finned cylinder visible in the middle of the scooter.
```

Negatif global yang selalu ikut (`HINDARI_GLOBAL`):

```text
extra fingers, missing fingers, fused or twisted hands, deformed limbs, duplicated person,
melting face, floating objects, objects merging into each other, impossible physics,
liquid appearing from nowhere, wrong real-world scale, text, caption, watermark,
gibberish lettering, garbled label, logo of another brand, collage, split screen,
multiple panels, letterbox bars, blurred border, plastic doll skin, cartoon, 3D render look,
scene changing mid-shot, teleporting, sudden new objects
```

**Kalau mau menambah kategori produk baru, di sinilah tempatnya.** Satu entri
berisi kata kunci, fakta, dan negatif — dan langsung ikut ke prompt gambar,
prompt gerak, audit realitas, dan kurasi.

### 3.7 Kurasi — model yang tidak membuat gambar itu yang menilainya

Dua penilai terpisah, keduanya `claude-opus-5` dengan penglihatan:

**Kurasi gambar kunci** (`lib/iklan/kurasi.ts`) — menilai frame pertama tiap
shot terhadap maksud shot-nya:

```text
You are the independent asset curator of a commercial film studio. Each image is the FIRST FRAME
of one shot in a 30-second vertical product film for Indonesian social media. Reject any image
a demanding creative director would send back.

Reject (lulus=false) when ANY of these is visible:
- Not one single photograph: collage, grid, split screen, triptych, stacked panels, borders …
- Does not show what the shot intends (wrong action, location, time of day, subject …)
- Physically impossible or absurd: detached parts held in hands, floating objects, liquid
  appearing from nowhere, spray missing its target, broken perspective.
- Anatomy defects: extra/missing/fused fingers, twisted limbs, melted faces, duplicated people.
- The product … has a different shape, colour or size than the product photo … or ANY lettering
  on it is readable — AI-drawn labels garble, so readable label text is a reject even if it looks close.
- A recurring element … that clearly differs from its ANCHOR image or description.
- Unsafe acts: riding without a helmet, driving without a seatbelt.
- A face or body language that contradicts the shot's emotion (smiling at a problem).
```

Yang ditolak digambar ulang **dengan alasan penolakannya**, maksimal 3 putaran.

**Kurasi klip** (`lib/iklan/kurasi-klip.ts`) menilai frame ber-cap-waktu di
sepanjang klip, bukan hanya detik ke-0, dan mengembalikan `aman_sampai_detik`.
Perakitan tidak pernah memakai bagian sesudah titik itu. Ini lahir karena pada
Faza v5 sebuah kaleng semprot merek lain muncul di lantai di tengah klip —
gambar kuncinya lolos, klipnya tidak.

### 3.8 Suara dan perakitan

- TTS: suara dikunci satu per video; dipilih dari `suara_en` di naskah
  (`Kore` untuk perempuan, `Charon` untuk laki-laki) — `lib/iklan/suara.ts:19`.
- Perakitan (`lib/iklan/susun.ts`): 720×1280, 30 fps, 0,25 dtk awal tiap klip
  dibuang karena frame pertama sering masih diam, larut 0,4 dtk di lockup,
  sapuan 0,6 dtk di shot BUKTI.
- Timeline **menghormati panjang suara**: VO boleh dipercepat sampai 1,15×
  sebelum shot diperpanjang (maksimal +0,8 dtk).
- Foto produk asli dipotong latar (OpenCV GrabCut, `lib/iklan/potong_latar.py`),
  diberi bayangan, dan diselaraskan cahayanya sebelum ditempel di REVEAL dan
  LOCKUP.

### 3.9 Biaya terukur per video

| Komponen | Model | Biaya |
|---|---|---|
| Naskah + audit | claude-opus-5 | ±Rp8–15 rb |
| Gambar kunci | Seedream 5 pro | Rp700/gambar × 9–14 (+ gambar ulang) |
| Kurasi gambar & klip | claude-opus-5 vision | ±Rp10–20 rb |
| Klip standard | Grok i2v via kie.ai | kredit × Rp100 |
| Klip ultra | Seedance 2.5 | token × $4,41/1M × kurs |
| Suara | TTS | kecil |

Angka nyata dari uji: **±Rp25 rb (standard)** dan **±Rp60 rb (ultra)** per
video. Tercatat otomatis di `biaya.json` tiap job dan di `qc_result`.

---

## 4. Berkas mana yang benar-benar mengubah perilaku model

Ini yang paling sering salah dikira. Sebagian berkas di `knowledge/` **dibaca
kode saat runtime** dan isinya masuk ke prompt; sebagian lagi dokumen untuk
manusia saja. Menyunting yang pertama mengubah video besok pagi; menyunting
yang kedua tidak mengubah apa pun sampai ada yang menulis kodenya.

| Berkas | Dibaca kode? | Bagian mana | Akibat menyunting |
|---|---|---|---|
| `knowledge/rules/standard-10.md` | **Ya** | **hanya §A dan §B**, disuntikkan verbatim ke system prompt penulis naskah DAN pembuat ide (`standar-10-teks.ts:24`) | §A/§B langsung berubah; §C–§H tidak berpengaruh |
| `knowledge/rules/MASTER-UGC-AFFILIATE.md` | **Ya** | **hanya §1** (regex `## 1.` sampai `## 2.`), `standar-10-teks.ts:67` | §1 langsung berubah; §2–§9 dokumen manusia |
| `knowledge/rules/MASTER-UGC-ADS.md` | **Ya** | **hanya §1**, mekanisme sama | §1 langsung berubah; §3–§5 sudah disalin ke kode |
| `knowledge/rules/modes.md` | **Ya** | seluruhnya, `lib/media/mode-kamera.ts:31` | langsung berubah (kontrak kamera) |
| `knowledge/formats/*.json` | **Ya** | katalog format + beat table, `format-katalog.ts:65` | langsung berubah |
| `knowledge/rules/STORY-OS-ADS-v1.md` | **Tidak** | — | isinya sudah ditranskripsi ke `story-os-ads.ts` dan `llm.ts:385` |
| `knowledge/rules/prompt-language.md` | **Tidak** | — | sudah disalin tangan ke `llm.ts:90–141` |
| `knowledge/rules/REFERENSI-IKLAN-SINEMATIK-v1.md` | **Tidak** | — | sudah disalin ke `lib/iklan/naskah.ts` |
| `knowledge/rules/content-types.md`, `formats.md` | **Tidak** | — | dokumen manusia |

**Konsekuensi yang gampang menjebak:** menyunting `STORY-OS-ADS-v1.md` atau
`prompt-language.md` **tidak mengubah apa pun** di video besok — keduanya sudah
disalin tangan ke TypeScript. Kalau kamu ubah dokumennya saja, dokumen dan kode
akan menyimpang diam-diam. Ubah kodenya juga, atau jangan ubah dokumennya.

Kalau berkas yang dibaca runtime hilang saat deploy, sistem **tidak diam**: ada
peringatan di log (`[standar-10] … tidak terbaca`), karena kehilangan lapisan
mutu tanpa jejak adalah kegagalan yang paling mahal.

---

## 5. Gerbang mutu

### 5.1 Iklan Sinematik — G1 sampai G7

Dijalankan otomatis atas video jadi (`lib/iklan/gerbang.ts:130+`):

| Gerbang | Yang diperiksa |
|---|---|
| G1 | durasi 29–37 dtk |
| G2 | minimal 9 shot |
| G2b | minimal 7 potongan benar-benar terdeteksi di video (scene > 0.2) |
| G3 | tidak ada shot lebih dari 5,5 dtk |
| G4 | tidak ada pita blur di tepi frame |
| G5 | suara terdengar dan musik tidak menenggelamkannya |
| G6 | lockup 3–5,5 dtk dan tagline ada |
| G7 | aturan naskah (hook, frasa terlarang, struktur) |

Di beta ini gerbang **tidak memblokir** — hasilnya dicatat di `qc_result` supaya
bisa dinilai, karena job yang selalu FAILED tidak menghasilkan apa pun untuk
ditinjau, dan beta ini tidak memotong kredit siapa pun.

### 5.2 Retail

Dua belas pemeriksaan bernomor, plus satu yang berjalan **sebelum** render.
Yang wajib lulus berbeda per format — Ads misalnya tidak menuntut QC-03 dan
QC-09 karena produknya bisa saja aplikasi, bukan barang fisik.

| ID | Yang diperiksa | Alat | Kalau gagal |
|---|---|---|---|
| QC-01 | mulut benar-benar bergerak saat bicara | YuNet + skrip Python | lewat |
| QC-02 | tangan/jari morphing antar frame | OpenCV | **gagal** |
| QC-03 | identitas produk konsisten antar shot | perbandingan warna | lewat |
| QC-04 | audio tidak senyap (< −40 dB) | ffmpeg | **gagal** |
| QC-05 | durasi sesuai ±2 detik | ffprobe | **gagal** |
| QC-06 | overlay tidak terpotong tepi | tesseract 2 lewatan | lewat bila OCR lemah |
| QC-07 | kata terlarang di ucapan & teks | tanpa LLM | blocker |
| QC-08 | label AIGC terpasang | ffprobe | **gagal** |
| QC-09 | benar-benar tanpa wajah (format hands-only) | YuNet | **gagal** |
| QC-10 | merek di label terbaca dan **tidak salah eja** | tesseract | gagal bila salah eja |
| QC-11 | jumlah orang, jumlah tangan, anatomi | **Gemini vision** | lewat bila vision mati |
| QC-12 | yang diucapkan sesuai skrip (harga!) | **Gemini audio** | blocker untuk harga |
| QC-F1 | frame turunan setia pada foto produk | **Gemini vision** + OCR | frame dibuang |

Hanya tiga yang memanggil LLM. Dua di antaranya punya detail yang layak kamu
tahu karena ia mencegah kerugian nyata:

**QC-11** diberi instruksi sangat spesifik supaya tidak menggagalkan gaya iklan
kita sendiri:

```text
fisikaJanggal: judge ONLY the product container and its contents. Set true only for: liquid or cream
emerging from somewhere other than the actual opening; the cap still sealed while product pours out …
IGNORE EVERYTHING ELSE IN THE SCENE. Walls breaking, ceilings collapsing, doors bursting open, objects
flying, time freezing, people appearing suddenly — these are deliberate creative devices in our ads
and are NEVER fisikaJanggal.
```

**QC-F1** menjaga hal yang paling sering bergeser diam-diam — jenis tutupnya:

```text
tutup_sama: the closure is the SAME KIND — a dropper is not a pump, a pump is not a screw cap,
a spray is not a flip-top. This one matters most; closures drift silently.
Be strict. If you are unsure, answer false.
```

**Kalau QC gagal:** ada 2 percobaan. Pada percobaan pertama, kalau yang gagal
QC-11 atau QC-10 dan ia membawa detik kegagalan, detik itu dipetakan ke shot
dan **maksimal 2 shot** digenerate ulang sendirian — bukan seluruh video. Untuk
TVC 6 shot, itu ±Rp2.771 dibanding ±Rp16.626. Aturan ini lahir 3 September 2026
dari insiden label terbaca "siho" untuk merek "sihoo": seluruh job digagalkan
padahal Rp23.355 sudah dibayar.

Percobaan kedua gagal → job FAILED dan **kredit dikembalikan**. Kredit memang
baru di-capture setelah job READY, jadi video yang ditolak QC tidak pernah
memotong jatah.

---

## 6. Kejujuran tentang mutu hari ini

Supaya dokumen ini tidak dibaca sebagai iklan untuk pipeline-nya sendiri:

- **Iklan Sinematik belum lulus standarnya sendiri.** Review independen
  terakhir (14 Sep 2026) menilainya **Reject, ±4/10** terhadap referensi
  Blueprint. Yang sudah kuat: label produk asli, klaim yang berdasar, ajakan
  yang jelas. Yang masih lemah: shot BUKTI (larutan 0,6 dtk menghasilkan
  bayangan lengan), gerak klip yang nyaris diam di mesin standard.
- Mesin **Ultra unggul ±2 poin** di realisme, gerak, dan bukti, tapi biayanya
  ±2,5× untuk bagian videonya, dan Seedance menolak gambar apa pun yang
  memuat wajah — jadi mode Ultra memakai gambar kunci tanpa wajah.
- Saran yang belum dikerjakan: **mesin per shot** (Ultra hanya untuk shot
  aksi, standard untuk sisanya) dan render pembanding per tier untuk halaman
  harga.

---

## 7. Kalau mau mengubah sesuatu

| Mau mengubah | Sunting |
|---|---|
| Gaya dan aturan naskah iklan sinematik | `lib/iklan/naskah.ts` (konstanta `PANDUAN`) |
| Fakta dunia nyata / negatif kategori | `lib/iklan/realitas.ts` |
| Cara gambar kunci diminta | `lib/iklan/keyframe.ts` (`promptKeyframe`) |
| Cara klip digerakkan | `lib/iklan/klip.ts` (`promptGerak`) |
| Ketatnya kurasi gambar | `lib/iklan/kurasi.ts` (konstanta `KRITERIA`) |
| Ambang gerbang mutu | `lib/iklan/gerbang.ts` |
| Standar naskah retail | `knowledge/rules/standard-10.md` §A/§B (langsung berlaku) |
| Aturan per jenis konten retail | `knowledge/rules/MASTER-UGC-*.md` §1 (langsung berlaku) |
| Aturan keras & filter-safety penulis retail | `lib/script-engine/llm.ts` (`blokAturan`) |
| Story OS untuk Ads | `lib/script-engine/llm.ts:385` + `lib/script-engine/story-os-ads.ts` |
| Cara shot dirakit jadi prompt video | `lib/media/shot-planner.ts` |
| Kontrak kamera 14 mode | `knowledge/rules/modes.md` (langsung berlaku) |
| Pembungkus mutu yang dikirim ke penyedia | `lib/providers/teks-prompt.ts` |
| Ambang QC retail | `lib/media/qc.ts` (kebijakan per format di `:41–144`) |
| Suara per persona | `lib/personas.ts` |

Setiap perubahan prompt sebaiknya diikuti satu render uji, lalu dibandingkan
dengan referensi. Pelajaran yang paling mahal dari pipeline ini: **memperkuat
larangan hampir tidak pernah berhasil; membuat permintaannya koheren selalu
berhasil.** Lima cacat berturut-turut berbentuk prompt yang bertentangan
sendiri, bukan larangan yang kurang keras.
