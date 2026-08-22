# P0-B2/B3 — bukti staging: apa yang BISA diukur, dan apa yang ternyata tidak

TASK=P0-B2B3-STAGING-EVIDENCE-20260822
TANGGAL=2026-08-22
SIFAT=**HANYA BACA** — nol deploy, nol restart, nol migrasi, nol tulis, nol
render berbayar. Seluruh perintah di bawah adalah pembacaan.

## Ringkasan satu kalimat

**Staging tidak bisa menjawab pertanyaan T43, karena staging tertinggal ~400
commit (18 hari) di belakang pekerjaan product-truth — seluruh instrumentasi
yang dibangun untuk menjawabnya belum pernah ada di sana.**

## 1. Identitas service dan deploy AKTIF (tanpa membuat deploy)

| Service | id | runtime | SHA hidup | Selesai |
|---|---|---|---|---|
| `racun-ai-staging-web` | `srv-d9n28tijnfac73a87lt0` | **node** | `5fe53f2` | 2026-08-09T02:40:15Z |
| `racun-ai-staging-worker` | `srv-d9n28ue417fc73ch2b60` | docker | `78d8468` | 2026-08-11T11:57:32Z |

Perintah: `render services --output json --confirm`,
`render deploys list <service-id> --output json --confirm` (keduanya baca).

**Keluaran mentahnya ada di dalam tree**, disanitasi ke field identitas saja,
supaya tabel di atas bisa diperiksa dan tidak perlu dipercaya:

| Artefak | Isi |
|---|---|
| `staging-20260822/services.json` | nama, id, type, runtime, region |
| `staging-20260822/deploys-web.json` | 5 deploy terakhir: deployId, status, commit, waktu |
| `staging-20260822/deploys-worker.json` | idem untuk worker |
| `staging-20260822/postgres.json` | datastore: nama, id, databaseName, status |
| `staging-20260822/health-web.txt` | perintah + timestamp + body + HTTP_STATUS |

Deploy aktif web: `dep-d9rugpuq1p3s73ajvvpg`, status `live`, commit
`5fe53f27436d917d5232e23ef6c6e624eb00428a`.

Kedua SHA bertanggal **2026-08-04**. Jarak ke HEAD:

Dihitung terhadap **exact SHA yang diikat review** (`f28851c`), bukan terhadap
parent-nya:

```
git rev-list --count 5fe53f2..f28851c  = 399
git rev-list --count 78d8468..f28851c  = 403
```

Angka ini **berjangkar pada `f28851c`** dan bertambah satu untuk setiap commit
sesudahnya — termasuk commit yang membawa koreksi ini. Ditulis berjangkar,
bukan sebagai "terhadap HEAD", supaya ia tidak menjadi salah lagi di SHA
berikutnya.

(Versi pertama dokumen ini menulis 398/402 "terhadap HEAD". Itu angka terhadap
`f28851c^` — pohon sebelum dokumen ini sendiri ditambahkan. Temuan Reviewer, dan
ia benar: bukti yang terikat sebuah SHA harus dihitung terhadap SHA itu, dan
"HEAD" bukan jangkar yang stabil di dalam berkas yang ikut mengubah HEAD.)

Dan yang menentukan:

```
0028850 (probe kapabilitas) leluhur build web hidup?  TIDAK
38466a3 (gerbang P0)        leluhur build web hidup?  TIDAK
```

## 2. `/api/health` staging — DIBACA, dan hasilnya bukan jawaban

```
# waktu_utc: 2026-08-22T12:51:37Z
curl -sS -m 45 -o - -w '\nHTTP_STATUS=%{http_code}\n' \
  https://racun-ai-staging-web.onrender.com/api/health

{"ok":true,"intake":"open"}
HTTP_STATUS=200
```

Terekam apa adanya di `staging-20260822/health-web.txt`. (Versi pertama dokumen
ini mengutip perintah TANPA `-w` sambil mengklaim HTTP 200 — perintah yang
ditulis tidak akan pernah mencetak status itu. Temuan Reviewer; perintah di atas
adalah yang benar-benar dijalankan dan keluarannya disimpan.)

Blok `klasifikasi` **tidak ada**. Itu bukan berarti runtime web tidak mampu —
itu berarti **probe-nya belum di-deploy**. `/api/health` di HEAD mengembalikan
`klasifikasi` (`app/api/health/route.ts:68,80`), ditambahkan di `0028850`, dan
`0028850` bukan leluhur build yang hidup.

Bentuk respons staging bahkan lebih kecil daripada versi pra-`0028850`, yang
sudah memuat `payments_provider`/`payments_env`/SHA build — konsisten dengan
build 4 Agustus.

**KAPABILITAS KLASIFIKASI RUNTIME WEB = BELUM TERUKUR.** Menjawabnya butuh
deploy, dan deploy DILARANG di lingkup tugas ini.

## 3. Datastore staging — teridentifikasi, audit TIDAK dijalankan

| Resource | id | database | status |
|---|---|---|---|
| `racun-ai-staging-postgres` | `dpg-d9n21fnlk1mc73djm8q0-a` | `racun_staging` | available |

Audit P0-B3 **tidak dijalankan**, dan alasannya bukan kehati-hatian saja —
alatnya memang tidak bisa dijalankan dari sini:

1. **Butuh DATABASE_URL staging.** Di blueprint ia di-inject Render
   (`fromDatabase`), tidak ada di mesin ini. Diperiksa: `DATABASE_URL`,
   `UJI_PG_URL` kosong.
2. **Butuh kredensial R2 juga**, dan gagalnya BUKAN seperti yang versi pertama
   dokumen ini tulis. Klaim lama: "setiap foto dilaporkan
   `SIDECAR_MISSING`/`REF_MISSING`". Itu SALAH, dan Reviewer benar
   membetulkannya — perilaku sebenarnya lebih tegas:

   Dengan `STORAGE_MODE=r2` tanpa kredensial lengkap, `mediaStorage()`
   memanggil `assertStorageConfiguration()` dan **melempar sebelum satu byte
   pun dibaca** (`lib/storage.ts:158-177`). Audit menangkap lemparan itu per
   produk dan menghitungnya sebagai **`produkGagalDiperiksa`**
   (`lib/audit-bukti-produk.ts:279-292`) — ember "tidak bisa dinilai", bukan
   vonis kerusakan.

   Jadi jalur ini gagal-tertutup dengan benar: ia TIDAK mengarang kerusakan
   legacy. Yang tetap benar adalah kesimpulannya — audit tanpa R2 menghasilkan
   nol informasi berguna, hanya N baris "gagal diperiksa".

   (Catatan ketepatan: dalam mode filesystem yang kosong, urutan resolver hanya
   menghasilkan `SIDECAR_MISSING`; `REF_MISSING` menuntut sidecar yang SAH ada
   sementara bytes-nya hilang. Menyebut keduanya sekaligus, seperti versi
   pertama, salah di kedua mode.)
3. **Nilai angkanya tidak diketahui, dan itu tidak boleh ditutupi dengan
   tebakan.** Versi pertama dokumen ini menyimpulkan bahwa seluruh row di
   `racun_staging` dibuat oleh build 4 Agustus, sehingga audit "pasti hanya
   mengukur ketiadaan fitur". Kesimpulan itu DICABUT — Reviewer benar bahwa ia
   tidak didukung apa pun.

   Yang benar-benar dibuktikan: SHA build yang **aktif sekarang** adalah
   `5fe53f2`. Itu TIDAK membuktikan asal-usul data. Datastore bertahan lintas
   deploy, rollback, impor manual, seed, dan tulisan dari sumber lain; dokumen
   ini sendiri menyatakan tidak pernah terhubung ke database dan tidak memuat
   riwayat deploy lengkap sejak database dibuat (2026-08-02).

   Menyimpulkan asal-usul data dari identitas build adalah persis bentuk
   "inferensi disajikan sebagai fakta" yang seluruh gelombang bukti ini
   dibangun untuk mencegah.

Tidak ada angka empat ember yang dilaporkan. Mengarangnya dilarang, dan
menurunkannya dari akses setengah jadi sama saja dengan mengarang.

## 4. Kanari P0-B4 — tidak ada log, dan tidak mungkin ada

Kanari (`lib/kanari-bukti.ts`) masuk di gelombang ini, jauh sesudah `5fe53f2`.
Worker staging (`78d8468`) juga mendahuluinya. Tidak ada baris `[kanari-bukti]`
yang bisa dibaca dari deploy mana pun saat ini.

## 5. Bukti sifat hanya-baca

- Perintah yang dijalankan hanya: `curl` GET, `render services/deploys/postgres
  list` (subperintah baca).
- Nol `render deploy`, nol `render restart`, nol `psql`, nol koneksi database.
- `/api/meta` dicoba dan mengembalikan **401 UNAUTHORIZED** — dicatat apa adanya
  sebagai batas akses, bukan dilewati diam-diam.
- Repo tidak disentuh selain dokumen ini.

## 6. Yang ini ubah untuk T43

Sebelum ini, "deploy staging lalu baca /api/health" terdengar seperti satu
langkah kecil. Ternyata bukan: staging bukan sekadar belum di-deploy ulang, ia
**~400 commit tertinggal**. Men-deploy-nya berarti memindahkan 18 hari perubahan
sekaligus ke lingkungan yang belum pernah menjalankannya — termasuk
`preDeployCommand: node scripts/migrate-postgres-runtime.mjs`, yaitu **migrasi
schema**, yang dilarang keras di lingkup tugas ini dan bukan tindakan yang boleh
diputuskan Builder.

Jadi prasyarat T43 tetap belum terpenuhi, dan penghalangnya sekarang punya nama
dan angka, bukan lagi "butuh akses".
