# Aturan bahasa prompt yang sudah teruji

Diturunkan dari katalog preset Higgsfield (18 Agu 2026). Ini **aturan**, bukan
contoh prompt — contoh promptnya sengaja tidak dibawa ke sini, karena kalimat
contoh akan ditiru bentuknya dan menghasilkan naskah yang semuanya terdengar
sama.

Semua di bawah ini soal BAHASA PROMPT VIDEO (arahan visual, start_state), bukan
soal dialog yang diucapkan.

---

## 1. Pembawaan diucapkan sebagai instruksi, bukan sifat

Model video menuruti kata kerja, bukan kata sifat. `energetic` menghasilkan
gerakan; `speaks Indonesian with bright energy, enunciating every word clearly`
menghasilkan mulut yang benar-benar membentuk kata.

| tulis begini | jangan begini |
|---|---|
| `speaks Indonesian with bright energy, enunciating every word clearly` | `energetic tone` |
| `she pauses, then looks up at the lens` | `dramatic pause` |
| `eyebrows lifting in genuine surprise` | `surprised expression` |

`enunciating every word clearly` bukan hiasan — tanpa itu ujung kalimatnya
sering hilang, dan itu yang membuat audio native terdengar seperti gumaman.

## 2. Suara luar kamera ditulis eksplisit OFF CAMERA

Untuk format tanpa wajah, penuturnya harus dinyatakan berada di luar frame:

    A woman's voice speaks OFF CAMERA in Indonesian ...

Tanpa `OFF CAMERA`, model akan berusaha memunculkan orang yang berbicara — dan
pada format tanpa wajah itu berarti wajah yang tidak diinginkan masuk frame,
atau mulut yang menggantung tanpa kepala.

## 3. Larangan wajah ditulis per BAGIAN TUBUH, bukan sekali

`no face` saja tidak cukup. Yang bekerja adalah menyebut bagiannya satu per
satu, dan menyebut apa yang BOLEH ada:

    NO face, NO head, NO shoulders. Only hands and forearms.

Untuk makro, batasnya lebih ketat lagi: `no people visible except fingertips`.

Perhatikan bahwa ini kalimat negatif tentang tubuh, bukan tentang ORANG LAIN —
negasi yang menyebut orang lain dilarang oleh L-21 karena justru memunculkan
mereka. `NO face` menyebut bagian tubuh subjek yang sudah ada di frame; `no
other residents` memperkenalkan orang yang sebelumnya tidak ada.

## 4. ASMR menuntut bunyi dirinci satu per satu

Menulis "ASMR" menghasilkan unboxing biasa berlabel ASMR. Yang membedakan:

- minta `crisp detailed ASMR sound design`;
- **sebutkan tiap bunyi terpisah** — gesekan kering kuku di kardus, retakan
  tajam plastik yang terkelupas, gemerisik tisu;
- nyatakan `close and intimate with no music`;
- minta suaranya `very softly, almost whispering`.

Bunyi ditulis sedetail gambarnya, karena di format ini bunyinya yang jadi
bintang.

## 5. Satu take, dinyatakan dua kali

`single continuous take, no cuts` di depan, lalu `never cutting away` di dalam
deskripsi aksinya. Sekali saja sering tidak bertahan sampai akhir klip.

## 6. Kesendirian dinyatakan sebagai jumlah, bukan larangan

    One person only, no crowd.

Ini pengecualian yang disengaja terhadap L-21: `one person only` menyebut
JUMLAH yang benar lebih dulu, sehingga `no crowd` yang mengikutinya membaca
sebagai penegasan, bukan sebagai perkenalan orang baru. Jangan pernah menulis
`no other people` sendirian tanpa `one person only` di depannya.

## 7. Yang sudah benar sebelum bergerak ditulis sebagai keadaan

Model bergerak MENUJU prompt. Apa pun yang tidak dinyatakan sudah benar di
frame pertama akan dikarang:

    From the very first frame a heavy weight presses down onto it from above ...
    ... holds the product the ordinary way from the very first frame ...

`from the very first frame` adalah frasa yang membuatnya bertahan.
