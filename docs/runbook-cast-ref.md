# Runbook CAST-REF — siap dieksekusi di sesi baru

Otorisasi Brian: **maksimal Rp15.000 total, 3 avatar saja.** Sisa 22 avatar
menunggu canary membuktikan paketnya benar-benar memperbaiki konsistensi wajah
di klip jadi.

Ditulis 20 Agu sesudah menelusuri kode, supaya sesi baru tidak mengulang
penelusuran yang sama.

## Yang SUDAH ada (jangan dibangun ulang)

| Bagian | Tempat | Status |
|---|---|---|
| `buatPaketCastRef(avatarDesc, outDir)` | `lib/media/cast-ref.ts:92` | lengkap; frame 2 & 3 diturunkan dari frame 1 |
| `paketCastRefTersimpan(kunci, desc, baseDir)` | `lib/media/cast-ref.ts:143` | lengkap, sudah ber-cache berkas |
| `kunciCastRef({presetId, customDesc})` | `lib/media/cast-ref.ts:137` | ada, **tapi lihat celah di bawah** |
| Pemanggilan kunci dari worker | `lib/postgres/worker.ts:526` | sudah |
| Gerbang tier/format frame turunan | `bolehFrameTurunan()` di worker | sudah |
| Gemini (pembuat gambar) | — | diprobe 20 Agu: **200 OK, pulih** |

Yang BELUM: `buatPaketCastRef` / `paketCastRefTersimpan` tidak pernah dipanggil
dari jalur worker. Itu inti pekerjaan sesi ini.

## CELAH YANG HARUS DITUTUP — kunci belum memuat versi model

`kunciCastRef` sekarang menghasilkan `preset-hijaber` / `custom-<sha>`. Tidak
ada versi model di dalamnya. Akibatnya: begitu model gambar diganti, paket lama
tetap dipakai dan wajahnya berubah diam-diam tanpa ada yang tahu kenapa.

Brian meminta penyimpanan **berkunci avatar + versi model**. Jadi kuncinya
harus jadi `preset-hijaber@<model>`, dan penggantian model otomatis membuat
paket baru alih-alih memakai yang basi.

## Ditegaskan Brian sebelum sesi baru (20 Agu)

1. **Versi model masuk ke `kunciCastRef` SEBELUM satu paket pun dibangun.**
   Paket lama gugur secara EKSPLISIT saat model berubah — tidak pernah
   diam-diam. Urutannya mengikat: kunci dulu, baru belanja.
2. **Tiga avatar dipilih dari pemakaian NYATA HDRV**, bukan urutan berkas.
3. **Otorisasi Rp15.000 tetap berlaku.**

## Langkah

1. **Pilih 3 avatar terpakai-terbanyak.** Kueri produksi (read-only):
   ```sql
   SELECT creator_category, count(*)::int n
     FROM jobs
    WHERE creator_category IS NOT NULL
    GROUP BY 1 ORDER BY 2 DESC LIMIT 5;
   ```
   Kalau datanya tipis (job terakhir 13 Agu), pakai tiga preset yang benar-benar
   dipakai di produksi HDRV, JANGAN tiga pertama di `lib/personas.ts` — urutan
   berkas bukan bukti pemakaian.

2. **Tambahkan versi model ke kunci** + test bahwa kunci berubah saat model
   berubah. WAJIB selesai sebelum langkah 3 — kalau paket dibangun dengan kunci
   lama, ia langsung jadi paket basi yang tidak bisa dibedakan dari yang sah.

3. **Bangun paket untuk 3 avatar** lewat `paketCastRefTersimpan`. Catat biaya
   per paket dari nilai kembaliannya; berhenti kalau total menyentuh Rp15.000.

4. **Verifikasi mutu — INI SYARAT, bukan formalitas:**
   - lihat sendiri ketiga gambar tiap paket (netral, tiga-perempat, close-up);
   - orang yang sama di ketiganya? (bandingkan bentuk wajah, warna kulit,
     rambut, umur — bukan "mirip", tapi sama);
   - tidak ada penolakan NSFW dan tidak ada artefak (jari, mata, telinga);
   - kalau satu paket gagal, JANGAN lanjut ke avatar berikutnya sebelum tahu
     kenapa — tiga paket buruk lebih mahal daripada satu paket yang dipahami.

5. **Sambungkan ke worker** di balik gerbang yang sudah ada
   (`bolehFrameTurunan`), bukan gerbang baru.

6. **Laporkan biaya per paket** dan verdict mutu per avatar, apa adanya.

## Yang TIDAK boleh diklaim

Paket yang bagus BUKAN bukti konsistensi wajah di klip jadi. Itu baru terbukti
kalau klip nyata yang dirender memakainya menunjukkan wajah yang sama antar
shot — dan itu bagian canary, bukan bagian sesi ini.
