# Lapisan pengetahuan BikinFYP

## Preset Marketing Studio adalah ACUAN STRUKTUR, bukan API yang dipanggil

Ini yang paling gampang disalahpahami dari berkas-berkas di sini, jadi
disebut lebih dulu: **kita tidak pernah memanggil preset Higgsfield Marketing
Studio dari kode.** Sudah dicoba dan ditolak — `params.avatars` dijawab
*"Marketing Studio does not support this parameter"*. Avatar bisa didaftarkan
lewat MCP tapi hanya bisa dipasang lewat antarmuka web.

Yang kita ambil dari preset itu **strukturnya**: tabel beat, teknik, dan cara
gagalnya. Videonya tetap kita buat sendiri:

    Preset            ->  acuan STRUKTUR BEAT (berkas di formats/)
    Frame             ->  dibuat sendiri, wajah dikunci dari CAST-REF
    Video             ->  Seedance r2v
    Perakitan         ->  ffmpeg

Hasilnya lebih terkontrol: wajah bisa dikunci, naskah bisa diuji pengucapannya,
dan durasinya tepat.

## Isi

| berkas | isi |
|---|---|
| `formats/*.json` | 8 format terperinci: beat_table, technique, failure_mode, no_face_recommended |
| `format-prior.json` | sifat produk -> format, dipakai saat memasangkan mekanik x format |
| `rules.md` | aturan BAHASA PROMPT yang sudah teruji |

## Yang SENGAJA tidak diambil

**Delapan contoh prompt di katalog TIDAK dipakai sebagai few-shot penulis
naskah.** Keputusan Brian, 18 Agu. Alasannya: contoh prompt yang bagus akan
ditiru bentuk kalimatnya, dan hasilnya delapan naskah yang semuanya terdengar
sama — persis kondisi "benar tapi datar" yang sedang kita tinggalkan. Yang
diambil strukturnya; kalimatnya tetap ditulis dari idenya sendiri.
