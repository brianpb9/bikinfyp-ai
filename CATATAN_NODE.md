# Versi Node dipatok

Worker berjalan di `node:22-bookworm-slim` (Dockerfile.worker), sementara web
service Render memakai versi bawaan platform — log deploy 16 Agu menunjukkan
Node 24.14.1. Jadi dua bagian dari sistem yang sama menjalankan runtime yang
berbeda tanpa ada yang memutuskannya.

Itu bukan masalah teoretis: `sharp` (yang memproses foto unggahan pengguna)
punya binding native per-versi Node, dan versi bawaan platform bisa berubah
kapan saja tanpa satu baris kode pun berubah di sini — kegagalan yang muncul
tanpa penyebab yang terlihat di riwayat commit.

`.node-version` dan `engines.node` menyamakan web dengan worker di Node 22,
yang juga versi yang dipakai menjalankan tes.
