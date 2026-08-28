# Production control-plane — refresh read-only 24 Agustus 2026

TASK=`PRODUCTION-CONTROL-PLANE-READONLY-REFRESH-20260824`

Klaim di dokumen ini terikat ke artefak tersanitasi di `production-20260824/`
dan provenance reproducible di `production-20260824/MANIFEST.md`. Semua
pembacaan read-only; tidak ada deploy, restart, migrasi, perubahan konfigurasi,
koneksi datastore, autentikasi, aktivasi payment, atau panggilan provider.

## Service dan live deploy yang diamati

| Peran | Service | Service ID | Status | Auto-deploy | URL | Live deploy | Commit | Finished at (UTC) |
|---|---|---|---|---|---|---|---|---|
| web | `bikinfyp-ai-production-web` | `srv-d9nhccfqj5pc73et9hrg` | `not_suspended` | `yes` | `https://bikinfyp-ai.onrender.com` | `dep-da3bfg142hec73arfot0` | `00ee62efd86ae7e10453a2a1896e63b62228aa4d` | `2026-08-20T08:20:32.109544Z` |
| worker | `bikinfyp-ai-production-worker` | `srv-d9ni3ndaeets73c07kq0` | `not_suspended` | `yes` | `null` | `dep-da3bfg142hec73arfpfg` | `00ee62efd86ae7e10453a2a1896e63b62228aa4d` | `2026-08-20T08:18:50.342834Z` |

Web dan worker sama-sama live pada SHA lama
`00ee62efd86ae7e10453a2a1896e63b62228aa4d`. Kesamaan ini membuktikan parity
SHA yang diamati, bukan bahwa accepted current HEAD telah di-deploy.

### P1 unresolved — production auto-deploy drift

Kedua service teramati `autoDeploy=yes`. Ini bertentangan dengan release
control yang committed: `render.production.yaml:16` dan `:107` menetapkan
`autoDeployTrigger: off`, sedangkan `PRODUCTION_PROVISIONING_RUNBOOK.md:21`
mewajibkan auto-deploy web dan worker disabled.

Ini **production configuration/control gap**, bukan sekadar status informasi.
Dengan keadaan `yes`, push berikutnya ke branch yang terhubung dapat memicu
deploy production tanpa explicit release authorization yang diwajibkan
canonical plan. Karena itu public paid dan private beta tetap HOLD.

Task read-only ini tidak berwenang mengubah setting tersebut. Penutup yang
dibutuhkan:

1. Release owner yang berwenang mematikan auto-deploy pada **kedua** service;
2. sesudah mutasi itu, pembacaan ulang read-only yang diotorisasi; dan
3. artefak immutable tersanitasi yang menunjukkan web dan worker sama-sama
   `autoDeploy=no`/off, dengan service ID, timestamp, exit, dan filter, serta
   memastikan tidak ada deploy tak terotorisasi selama perubahan kontrol.

## Runtime publik

Pada `2026-08-24T13:01:32+0700 Asia/Jakarta`, health menjawab HTTP 200:

```json
{"ok":true,"intake":"closed","payments_provider":"duitku","payments_env":"sandbox","payments_live":false,"build_sha":"00ee62efd86ae7e10453a2a1896e63b62228aa4d"}
```

Fakta observasi yang boleh dinyatakan: intake closed, provider yang dilaporkan
adalah Duitku, environment payment sandbox, `payments_live=false`, dan
`build_sha` cocok dengan live deploy web/worker. Ini bukan settlement proof,
merchant approval, provider call, atau izin mengaktifkan payment.

`GET /api/meta` tanpa autentikasi pada
`2026-08-24T13:01:48+0700 Asia/Jakarta` menjawab HTTP 401 dengan response publik
tersanitasi `UNAUTHORIZED`, bilingual login message, dan `retryable=false`.
Tidak ada autentikasi dicoba; hasil ini tidak membuktikan isi meta setelah
login.

## Halaman legal

| Path | HTTP | Bytes |
|---|---:|---:|
| `/legal/privacy` | 200 | 22912 |
| `/legal/terms` | 200 | 22033 |
| `/legal/refund` | 200 | 18878 |

Angka hanya membuktikan ketiga URL tersedia dan mengembalikan body non-kosong
pada waktu pengambilan. Body HTML tidak disimpan atau dinilai. HTTP 200
**bukan** counsel signoff, persetujuan kebijakan, atau bukti bahwa teks legal
final.

## Batas keputusan

- Status `live` dan `not_suspended` adalah observasi, bukan izin deploy atau
  bukti current accepted tree telah terpasang. `autoDeploy=yes` adalah drift
  release-control P1 yang belum selesai, bukan keadaan yang diterima.
- Sandbox dan `payments_live=false` mempertahankan HOLD; tidak ada payment atau
  provider call dilakukan.
- Tidak ada external gate yang tertutup oleh bukti availability ini.

**CANONICAL_SHIPPING_READINESS tetap 58/100.**
