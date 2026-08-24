# Staging control-plane — refresh read-only 24 Agustus 2026

TASK=`STAGING-CONTROL-PLANE-READONLY-REFRESH-20260824`

Task awal membawa observasi read-only melalui `.agent-bus` pada
`2026-08-24T05:41:51Z`. Karena bus runtime diabaikan Git, Builder mengulang
pembacaan secara read-only dan mengikat klaim di bawah ke artefak immutable
`staging-20260824/` beserta perintah, timestamp, exit status, dan filter
deterministik di `staging-20260824/MANIFEST.md`. Builder tidak menjalankan
deploy, restart, migrasi, koneksi database, perubahan konfigurasi, atau mutasi
remote lain. Tidak ada nilai environment atau credential yang direkam.

## Service dan live deploy yang diamati

| Peran | Service | Service ID | Live deploy | Commit | Finished at (UTC) | Suspended | Auto-deploy |
|---|---|---|---|---|---|---|---|
| web | `racun-ai-staging-web` | `srv-d9n28tijnfac73a87lt0` | `dep-d9rugpuq1p3s73ajvvpg` | `5fe53f27436d917d5232e23ef6c6e624eb00428a` | `2026-08-09T02:40:15.459484Z` | no | no |
| worker | `racun-ai-staging-worker` | `srv-d9n28ue417fc73ch2b60` | `dep-d9tgs715efls73e32hug` | `78d84685de6db63724ac2715ef516917d0c4ce3c` | `2026-08-11T11:57:32.779998Z` | no | no |

Control-plane juga melaporkan staging KV dan PostgreSQL berstatus
**available**. Status availability ini hanya keberadaan resource; dokumen ini
tidak membuka connection string, tidak menghubungkan aplikasi ke datastore,
dan tidak membuktikan schema atau isi data.

Web dan worker berada pada **SHA yang berbeda**. Karena `autoDeploy=no`,
keberadaan commit baru di repository tidak membuktikan bahwa salah satu
service telah mengambilnya.

## Health web

Task awal melaporkan body yang sama pada
`2026-08-24 12:41:34 Asia/Jakarta`. Pembacaan ulang yang sekarang mempunyai
transcript committed dimulai pada
`2026-08-24T12:53:07+0700 Asia/Jakarta`:

```text
GET https://racun-ai-staging-web.onrender.com/api/health
HTTP_STATUS=200
BODY={"ok":true,"intake":"open"}
```

Respons ini membuktikan endpoint menjawab HTTP 200 pada waktu pengambilan dan
melaporkan `ok=true` serta `intake=open`. Respons tersebut **tidak** memuat:

- `build_sha` untuk mengikat runtime ke commit;
- kapabilitas classifier atau runtime media;
- status atau versi migrasi;
- bukti database/KV benar-benar siap dipakai aplikasi; atau
- bukti payment, settlement, maupun go-live.

Karena field itu tidak ada, health tidak boleh dipakai untuk menyimpulkan
deploy current HEAD, parity web/worker, kelulusan migration, kesiapan payment,
atau hasil classifier.

## Batas klaim dan keputusan

- Snapshot ini read-only dan tidak memberi atau menyiratkan izin deploy,
  restart, migrasi, audit datastore, payment activation, atau mutasi lain.
- `not suspended` dan `live` adalah status observasi control-plane, bukan
  bukti bahwa current accepted product tree telah di-deploy.
- Availability KV/PostgreSQL bukan bukti provenance pasangan credential,
  schema current, isi legacy, atau keberhasilan audit.
- Bukti ini tidak menutup external gates dan tidak memberi shipping credit
  baru.

**CANONICAL_SHIPPING_READINESS tetap 58/100.**
