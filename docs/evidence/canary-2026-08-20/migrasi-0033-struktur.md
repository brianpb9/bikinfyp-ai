# Bukti STRUKTUR migrasi 0030–0033 (bukan catatan) — 20 Agu 2026

Menjawab koreksi reviewer: baris `schema_migrations` hanya membuktikan CATATAN.
Aturan itu ditulis proyek ini sendiri di `lib/migrasi-status.ts:63` — "mempercayai
isi schema_migrations berarti mempercayai CATATAN, bukan KENYATAAN."
Jawaban saya sebelumnya memakai baris catatan, jadi belum cukup. Di bawah ini
struktur databasenya langsung, dibaca read-only dari produksi.

## CHECK constraint pada `credit_ledger`

```
credit_ledger_capture_delta_check
  CHECK (((type <> 'capture'::text) OR (delta = 0)))

credit_ledger_type_check
  CHECK ((type = ANY (ARRAY['topup','hold','capture','release','bonus','regen','koreksi'])))
```

- `'regen'` ADA → migrasi 0030 nyata di struktur.
- `'koreksi'` ADA → migrasi 0033 nyata di struktur. Inilah yang membuat entri
  pembalikan sandbox Rp60.000 sah, bukan sekadar tercatat.
- `capture_delta_check` ADA → capture tidak bisa menggerakkan saldo.

## Indeks unik

```
uniq_ledger_terminal_per_job
  CREATE UNIQUE INDEX ... ON credit_ledger (job_id)
  WHERE (type = ANY (ARRAY['capture','release']))
```

Migrasi 0031 nyata di struktur: satu job tidak bisa punya dua baris terminal —
inilah yang menutup jalur pembayaran ganda.

## Yang MASIH belum diverifikasi

- **`statusInvarianUang()` belum dijalankan.** Percobaan memanggilnya gagal
  (kemungkinan nama ekspor berbeda) dan saya tidak mengejarnya. Jadi yang
  terbukti di atas adalah tiga artefak strukturnya, BUKAN keluaran fungsi
  gerbang yang membaca ketiganya. Sesi berikutnya harus menjalankannya dan
  menempelkan keluarannya.
- **Checksum berkas migrasi vs yang tercatat**: belum dibandingkan.
- Bukti ini dibaca dari produksi pada 20 Agu; kredensial sementara dihapus
  sesudahnya.
