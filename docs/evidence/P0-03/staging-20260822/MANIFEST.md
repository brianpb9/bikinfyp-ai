# Manifest artefak staging — provenance per berkas

Ditambahkan atas temuan Reviewer terhadap `6c0f4eb`: berkas JSON di direktori
ini **bukan keluaran mentah**. Ia proyeksi — memilih, mengganti nama, dan
meratakan field. Tanpa manifest ini, nilai seperti `status: "live"` (yang
bersifat sementara) tetap hanya klaim tertulis.

Semua perintah **hanya baca**. Nol deploy, nol restart, nol migrasi, nol
koneksi database, nol tulis.

| Artefak | Perintah persis | Waktu UTC | Exit | Filter sanitasi |
|---|---|---|---|---|
| `services.json` | `render services --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F1 |
| `deploys-web.json` | `render deploys list srv-d9n28tijnfac73a87lt0 --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F2 |
| `deploys-worker.json` | `render deploys list srv-d9n28ue417fc73ch2b60 --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F2 |
| `postgres.json` | `render postgres list --output json --confirm` | 2026-08-22T12:51:37Z | 0 | F3 |
| `health-web.txt` | `curl -sS -m 45 -o - -w '\nHTTP_STATUS=%{http_code}\n' https://racun-ai-staging-web.onrender.com/api/health` | 2026-08-22T12:51:37Z | 0 | tidak ada (transcript apa adanya) |
| `meta-web.txt` | `curl -sS -m 30 -o - -w '\nHTTP_STATUS=%{http_code}\n' https://racun-ai-staging-web.onrender.com/api/meta` | 2026-08-22T13:00:04Z | 0 | tidak ada (transcript apa adanya) |

## Filter sanitasi (deterministik, bisa dijalankan ulang)

Kenapa disanitasi sama sekali: keluaran `render` memuat env var, connection
string, dan URL dashboard. Yang dipertahankan hanya field identitas.

**F1** — service, hanya yang namanya memuat `staging`:
```python
{'name','id','type','runtime','region'}   # runtime/region dari serviceDetails
```

**F2** — 5 deploy terakhir:
```python
{'deployId','status','commit','finishedAt','createdAt'}
```

**F3** — postgres, hanya yang namanya memuat `staging`:
```python
{'name','id','databaseName','status','createdAt'}
```

## Batas yang melekat pada artefak ini

`status: "live"` adalah keadaan **pada waktu pengambilan di atas**, bukan
jaminan saat dokumen ini dibaca. Deploy bisa berganti kapan saja. Yang tidak
berubah oleh waktu adalah `commit` yang tercatat pada deploy tersebut dan
`deployId`-nya — keduanya immutable dan bisa dicocokkan ulang lewat perintah
yang sama.
