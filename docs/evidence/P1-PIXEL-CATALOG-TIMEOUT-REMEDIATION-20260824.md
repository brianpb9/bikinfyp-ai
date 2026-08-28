# P1 pixel-catalog timeout remediation — 24 Agustus 2026

TASK=`P1-PIXEL-CATALOG-TIMEOUT-REMEDIATION-20260824`

## Baseline yang gagal

Baseline exact adalah `c62587b2a7af5d02900b0c59e20c339a8e4fc535`.
Independent plain `npm test` mencapai test 108, lalu
`tests/bukti-katalog-piksel.test.ts` gagal timeout pada **600005 ms** dengan
`ERR_TEST_FAILURE`. Loop async masih hidup setelah test timeout sehingga runner
harus dihentikan secara graceful; ini genuine failure, bukan sekadar log lambat.

Control run dengan `LEWATI_TES_PIKSEL=1` keluar 0:

```text
tests 1118 / pass 1077 / skip 41 / fail 0
```

`npx tsc --noEmit` baseline juga keluar 0. Buku bukti mempunyai **29 video
eligible**. Control run tidak menutup defect karena pixel test termasuk dalam
41 skip.

## Akar biaya dan perubahan

Profil satu video 61 frame sebelum paralelisasi membutuhkan wall **39,55 s**.
Dua sumber biaya yang diperbaiki tanpa mengubah coverage:

1. `lib/media/qc_face_check.py` sebelumnya memanggil
   `FaceDetectorYN_create` untuk setiap frame. Sekarang satu detector dibuat
   per invocation dan dipakai ulang. `setInputSize((w, h))` tetap dipanggil
   sebelum **setiap** detect agar frame landscape/portrait mempertahankan
   perilaku exact.
2. Sweep 29 video sebelumnya serial walau setiap `qcSubjekLokal` read-only dan
   memakai direktori frame unik. Test sekarang memakai empat worker lokal.
   Array hasil tetap berukuran jumlah eligible dan assertion mengunci ID serta
   urutan seluruh video. Assertion terpisah mengunci floor baseline 29 eligible;
   paralelisasi atau filter mutation tidak boleh berubah menjadi frame/video
   skip.

Tidak ada perubahan pada:

- timeout internal test, tetap `600_000` ms;
- default skip atau environment gate;
- 29 video eligible;
- `SAMPEL_PER_DETIK=2`;
- frame extraction, face score threshold `0.8`, `MIN_TINGGI_WAJAH=0.12`, atau
  `MIN_RASIO_KE_TERBESAR=0.6`;
- output JSON, batas wajah, dan verdict.

## Regression/counterexample

`tests/wajah-utama-relatif.test.ts` sekarang menjalankan
`qc_face_check.py` asli dengan binding cv2 observabel. Tiga frame mempunyai
dimensi `1280x720`, `720x1280`, dan `640x360`, dengan kasus presenter+latar,
dua tokoh utama+latar, dan latar saja.

Test mengharuskan:

- tepat satu event model `create`, threshold tetap `0.8`;
- tiga `setInputSize` sesuai dimensi aktual;
- tiga event detect dan tiga output dalam urutan input;
- outcome raw/utama tetap `2/1`, `3/2`, `1/0`;
- `max_faces=3` dan `max_faces_utama=2`.

Karena itu mutasi model recreation per frame, frame skip, set-size yang hilang,
threshold longgar, atau perubahan keputusan presenter/background membuat test
merah. Fixture YuNet nyata `ruang-sidang.jpg` juga tetap menghasilkan lima
wajah raw dan dua wajah utama.

## Hasil verifikasi

Semua command memastikan `LEWATI_TES_PIKSEL` tidak aktif untuk pixel/full run.

### Capture machine-generated exact code SHA

Artefak decisive yang dapat diperiksa langsung berada di
`docs/evidence/P1-pixel-catalog-timeout-exact-61d490a/`:

- `manifest.json` — command argv, UTC/Jakarta timestamp, hard timeout,
  environment state, duration, exit/signal/spawn error, byte count, dan SHA-256
  stdout/stderr;
- `pixel.tap` — raw TAP isolated pixel;
- `full.tap.gz` — raw TAP full suite dalam lossless deterministic gzip; manifest
  menyimpan hash dan ukuran compressed maupun uncompressed;
- `eligible.stdout.json` — 29 ID eligible dari buku bukti dan source template;
- stdout/stderr TypeScript dan stderr tiap command, termasuk berkas kosong yang
  di-hash sebagai bukti tidak ada output tersembunyi.

Capture dimulai dari worktree bersih dan mengikat:

```text
CODE_SHA=61d490a85d35c91500e31d6a5d14fc28697533dc
CODE_TREE=abe7d2fa5ba98981413f98e2671ffbfd3a5ea2e0
INITIAL_WORKTREE_CLEAN=true
```

Manifest machine-generated mencatat `LEWATI_TES_PIKSEL=UNSET` pada seluruh
record dan `success=true`. Hasil exact-code capture:

| Command | Bound | Exit | Machine-parsed result | Wall record |
|---|---:|---:|---|---:|
| eligible-count | 60 s | 0 | 29 eligible | 528,186 ms |
| isolated pixel | 480 s | 0 | 3 pass / 0 fail / **0 skip** | 42682,025 ms |
| full `npm test` | 900 s | 0 | 1119 total / 1079 pass / 40 skip / 0 fail | 92677,485 ms |
| `npx tsc --noEmit` | 120 s | 0 | stdout/stderr kosong | 1923,913 ms |

`pixel.tap` sendiri melaporkan suite duration `42469,058 ms`; selisih kecil ke
wall record mencakup startup process. Raw TAP full melaporkan duration
`92408,446 ms` dan dapat dibaca dengan `gzip -dc full.tap.gz`. SHA-256 raw files
ada di manifest, sehingga perubahan satu byte pada transcript dapat dideteksi.

Commit evidence sesudah capture hanya boleh mengubah `docs/evidence/**`
relatif terhadap `CODE_SHA`; tidak ada rerun yang diatribusikan ke tree kode
lain.

| Verifikasi | Hard bound | Hasil | Timing |
|---|---:|---|---:|
| lifecycle + outcome focused | — | 5 pass, 0 fail, 0 skip | node 6855 ms; wall 13,14 s |
| percobaan pertama sesudah detector reuse, sebelum worker pool | 480 s | **timeout exit 124** | wall 480,32 s |
| pixel-catalog isolated sesudah worker pool | 480 s | 3 pass, 0 fail, **0 skip** | pixel 373186,595 ms; file 402621,797 ms; wall 409,58 s |
| `npx tsc --noEmit` | — | exit 0 | wall 20,35 s |
| full `npm test` | 900 s | 1119 total / 1079 pass / 40 skip / 0 fail | pixel 65386,549 ms; suite 106911,475 ms; wall 107,57 s |
| final isolated sesudah floor assertion 29 | 480 s | 3 pass, 0 fail, **0 skip** | pixel 40784,250 ms; file 43814,800 ms; wall 44,26 s |
| final full exact code tree, stdout disenyapkan | 900 s | exit 0 | wall 93,19 s |
| final `npx tsc --noEmit` | — | exit 0 | wall 1,99 s |

Perbedaan isolated 409,58 s dan full warm 107,57 s dilaporkan apa adanya.
Filesystem/model cache dan scheduling runner membuat timing kedua lebih cepat;
ia bukan alasan menghapus cold isolated evidence. Acceptance konservatif tetap
memakai isolated run yang lulus di bawah 480 s, bukan angka warm terbaik.
Final rerun sesudah assertion floor juga warm; stdout full rerun final sengaja
disenyapkan untuk menghindari log ribuan baris, sehingga baris itu hanya
mengklaim exit 0 dan timing, bukan mengulang hitungan TAP dari run sebelumnya.

Empat puluh skip full suite adalah gate environment lain. Pixel-catalog sendiri
mengeksekusi tiga test dengan **zero skip**. Tidak ada network provider,
payment, deploy, database, atau data mutation dalam remediation/verifikasi ini.

**CANONICAL_SHIPPING_READINESS tetap 58/100.**
