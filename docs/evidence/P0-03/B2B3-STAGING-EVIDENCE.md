# P0-B2/B3 — bukti staging: apa yang BISA diukur, dan apa yang ternyata tidak

TASK=P0-B2B3-STAGING-EVIDENCE-20260822
TANGGAL=2026-08-22
SIFAT=**HANYA BACA** — nol deploy, nol restart, nol migrasi, nol tulis, nol
render berbayar. Seluruh perintah di bawah adalah pembacaan.

## Ringkasan satu kalimat

**Staging tidak bisa menjawab pertanyaan T43: build yang hidup di sana
bertanggal 2026-08-04, sudah 323 commit sebelum commit PERTAMA gelombang P0-03
(`8cd2888`, 2026-08-20) — seluruh instrumentasi yang dibangun untuk menjawabnya
belum pernah ada di sana.**

## 1. Identitas service dan deploy AKTIF (tanpa membuat deploy)

| Service | id | runtime | SHA hidup | Selesai |
|---|---|---|---|---|
| `racun-ai-staging-web` | `srv-d9n28tijnfac73a87lt0` | **node** | `5fe53f2` | 2026-08-09T02:40:15Z |
| `racun-ai-staging-worker` | `srv-d9n28ue417fc73ch2b60` | docker | `78d8468` | 2026-08-11T11:57:32Z |

Perintah: `render services --output json --confirm`,
`render deploys list <service-id> --output json --confirm` (keduanya baca).

Keluarannya ada di dalam tree supaya tabel di atas bisa diperiksa dan tidak
perlu dipercaya. **Berkas JSON ini PROYEKSI, bukan keluaran mentah** — ia
memilih, mengganti nama, dan meratakan field (keluaran `render` memuat env var
dan connection string yang tidak boleh masuk repo). Provenance tiap berkas —
perintah persis, waktu UTC, exit status, dan filter sanitasinya — ada di
`staging-20260822/MANIFEST.md`.

| Artefak | Isi |
|---|---|
| `staging-20260822/services.json` | nama, id, type, runtime, region |
| `staging-20260822/deploys-web.json` | 5 deploy terakhir: deployId, status, commit, waktu |
| `staging-20260822/deploys-worker.json` | idem untuk worker |
| `staging-20260822/postgres.json` | datastore: nama, id, databaseName, status |
| `staging-20260822/health-web.txt` | perintah + timestamp + body + HTTP_STATUS |

| `staging-20260822/meta-web.txt` | percobaan `/api/meta`: perintah, timestamp, body, HTTP_STATUS |
| `staging-20260822/MANIFEST.md` | provenance tiap artefak + filter sanitasi |

Deploy aktif web: `dep-d9rugpuq1p3s73ajvvpg`, commit
`5fe53f27436d917d5232e23ef6c6e624eb00428a`. Status `live` adalah keadaan **pada
waktu pengambilan**, bukan jaminan saat dibaca — deploy bisa berganti. Yang
immutable adalah `deployId` dan `commit`-nya.

Kedua SHA bertanggal **2026-08-04**. Jarak dari deploy yang hidup ke awal gelombang P0-03:

Dihitung terhadap **jangkar TETAP**, bukan terhadap HEAD dan bukan terhadap SHA
review mana pun:

```
git rev-list --count 5fe53f2..8cd2888  = 323     # deploy web    -> awal P0-03
git rev-list --count 78d8468..8cd2888  = 327     # deploy worker -> awal P0-03
```

`8cd2888` (2026-08-20, "P0-03: path x case matrix dari call-site nyata") dipilih
karena ia commit **pertama** gelombang P0-03 dan historis — tidak bergerak.
Jarak ke commit mana pun sesudahnya lebih besar lagi.

(Versi sebelumnya memakai `38466a3` dan menyebutnya "gerbang tempat gelombang
dimulai". Salah, dan Reviewer benar: `38466a3` adalah **"P0-A ronde 11"**, dan
`8cd2888` serta `f2ad65b` adalah leluhurnya. Angka 366/370 mengukur jarak ke
AKHIR ronde 11, bukan ke awal gelombang.)

Kenapa berjangkar tetap, dan bukan "terhadap HEAD": angka yang diikat ke HEAD di
dalam berkas yang IKUT MENGUBAH HEAD adalah cacat yang mereproduksi dirinya
sendiri. Ia sudah terjadi dua kali di dokumen ini — 398/402 (terhadap `f28851c^`
saat review mengikat `f28851c`), lalu 399/403 (terhadap `f28851c` saat review
mengikat `6c0f4eb`). Memperbaikinya sekali lagi dengan angka baru hanya menunda
kesalahan ketiga. Untuk rujukan: `f28851c` adalah jangkar review SEBELUMNYA
(399/403), bukan HEAD dan bukan SHA review saat ini; `38466a3` adalah jangkar
ronde 11 (366/370), bukan awal gelombang.

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
   legacy.

   Tapi kesimpulan "nol informasi berguna, hanya N baris gagal diperiksa" juga
   SALAH, dan Reviewer benar membetulkannya. Audit menghitung dua ember
   STRUKTURAL **sebelum** storage disentuh sama sekali:
   `produkKolomRusak` (kolom `images` tidak terbaca) dan `produkTanpaFoto`
   (`images` = `[]`). Hanya produk dengan daftar foto yang sah dan tidak kosong
   yang sampai ke storage.

   Artinya ember struktural bisa dihitung tanpa R2 — **tapi `DATABASE_URL` saja
   TIDAK cukup untuk menjalankannya, dan versi sebelumnya menyiratkan begitu.**
   Dua default menggagalkannya, dan yang kedua berbahaya:

   - `lib/config.ts:33` — `dbRuntime` default **sqlite** kalau
     `NODE_ENV !== "production"`. `lib/audit-sumber-produk.ts` mengikuti
     `config.dbRuntime`, jadi `DATABASE_URL` saja tetap membaca SQLite lokal.
   - `lib/config.ts:48` — `storageMode` default **filesystem**. Ini yang
     berbahaya: `mediaStorage()` TIDAK melempar, ia membaca storage LOKAL. Foto
     produksi lalu divonis dengan isi disk mesin ini — vonis media PALSU yang
     terlihat seperti kerusakan legacy, bukan gagal-tertutup.

   Invocation yang benar harus memilih Postgres SECARA EKSPLISIT dan memaksa
   jalur media gagal-tertutup:

   ```sh
   RACUN_NO_DOTENV=1 \
   RACUN_DB_RUNTIME=postgres \
   DATABASE_URL='<staging>' \
   STORAGE_MODE=r2 \
   R2_ENDPOINT= R2_BUCKET= R2_ACCESS_KEY_ID= R2_SECRET_ACCESS_KEY= \
     npx tsx scripts/audit-bukti-produk.ts --json
   ```

   Tiap bagian ada karena satu cara gagal yang KONKRET, bukan untuk kerapian:

   - `STORAGE_MODE=r2` tanpa kredensial → `assertStorageConfiguration()`
     melempar, sehingga produk berfoto masuk `produkGagalDiperiksa` alih-alih
     menerima vonis dari disk lokal.
   - `RACUN_NO_DOTENV=1` + keempat variabel R2 dikosongkan EKSPLISIT → tanpa
     ini, `lib/config.ts` tetap memuat `.env.local` dan mewarisi R2 dari
     environment. Kalau keempatnya kebetulan lengkap, assertion itu LOLOS dan
     audit membaca bucket sungguhan — yang bahkan bisa bucket yang TIDAK
     berpasangan dengan database staging. Hasilnya vonis media yang justru
     dokumen ini ada untuk mencegahnya.

     Ini bukan risiko teoretis di mesin ini: `.env.local` di sini SUDAH memuat
     `R2_ACCESS_KEY_ID` dan `R2_SECRET_ACCESS_KEY`. Versi sebelumnya dari
     invocation ini hanya menyetel `STORAGE_MODE=r2`, dan akan gagal TERBUKA
     begitu `R2_ENDPOINT` serta `R2_BUCKET` ikut ada. Temuan Reviewer.

     Diuji atas KONFIGURASI EFEKTIF, bukan atas ada-tidaknya baris di berkas.
     Transcript lengkap: `staging-20260822/probe-gagal-tertutup.txt`
     (2026-08-22T13:27:17Z, exit 0), terikat ke source lewat bukti kesetaraan
     hash (`lib/storage.ts` dan `lib/config.ts` di disk IDENTIK dengan isi tree
     ber-SHA). Statusnya `NONEMPTY` / `EMPTY_OR_MISSING`; nilai kredensial tidak
     pernah dibaca maupun dicetak.

     ```
     A. DEFAULT            ENDPOINT/BUCKET = EMPTY_OR_MISSING
                           ACCESS_KEY_ID/SECRET = NONEMPTY
                           STORAGE_MODE=filesystem  RACUN_DB_RUNTIME=sqlite
                           mediaStorage() = TIDAK MELEMPAR  <- GAGAL TERBUKA
     B. invocation LAMA    ACCESS_KEY_ID/SECRET tetap NONEMPTY
                           mediaStorage() = MELEMPAR
     C. invocation BARU    keempatnya EMPTY_OR_MISSING
                           mediaStorage() = MELEMPAR
     ```

     Tiga hal yang dibuktikan bagian ini, dan tidak satu pun bisa disimpulkan
     dari membaca berkas saja:

     - **A membuktikan bahayanya nyata.** Dengan default, `mediaStorage()`
       TIDAK melempar — ia membaca disk lokal. Inilah vonis media palsu yang
       dokumen ini peringatkan, terlihat langsung.
     - **B membuktikan invocation lama hanya aman BERSYARAT.** Kredensial tetap
       `NONEMPTY` di sana (dotenv tetap dimuat); yang menahannya semata
       `ENDPOINT`/`BUCKET` yang kebetulan kosong. Begitu keduanya ada, ia gagal
       terbuka.
     - **C membuktikan invocation baru aman TANPA SYARAT** — keempatnya dipaksa
       kosong oleh perintahnya sendiri.

     Keduanya gagal-tertutup HARI INI — karena `R2_ENDPOINT` dan `R2_BUCKET`
     kebetulan belum ada di sini. Itu justru inti temuannya: yang lama
     bergantung pada apa yang KEBETULAN tidak ada di environment, yang baru
     dijamin oleh perintahnya sendiri. Gerbang yang benar hanya karena
     lingkungannya kebetulan miskin bukan gerbang.

   Hasil yang bisa dipercaya dari invocation itu:
   - **terhitung**: `produk`, `produkKolomRusak`, `produkTanpaFoto`, `perKolomRusak`;
   - **tidak dinilai**: `produkTerbrick`, `fotoTersetujui`, `perAlasan`,
     `perRinci` — seluruhnya menuntut sidecar dan bytes.

   Alternatif yang lebih bersih kalau ini akan sering dipakai: mode
   structural-only yang tidak menyentuh resolver media sama sekali. TIDAK
   dibangun di sini — menambah mode produksi bukan lingkup tugas bukti ini.

   Dan karena isi `racun_staging` belum pernah diperiksa, dokumen ini juga tidak
   boleh menebak berapa banyak produk yang akan jatuh ke ember mana.

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
   riwayat deploy lengkap sejak database dibuat. Waktu pembuatan menurut artefak:
   `createdAt: "2026-08-01T16:37:18.722431Z"` (`staging-20260822/postgres.json`)
   — yaitu 2026-08-01 UTC, dan 2026-08-01 23:37 WIB. Versi sebelumnya menulis
   "2026-08-02"; angka itu diambil dari baris postgres PRODUKSI
   (`2026-08-02T09:54:55Z`), bukan staging. Temuan Reviewer.

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

- Perintah yang dijalankan: `curl` GET, `render services/deploys/postgres list`
  (subperintah baca), dan satu **probe konfigurasi lokal** yang tidak menyentuh
  jaringan/database/storage (`staging-20260822/probe-gagal-tertutup.txt`).
  Versi sebelumnya menulis "hanya curl dan render" sementara batang tubuh
  dokumen mengklaim sebuah probe — inventaris yang bertentangan dengan isinya
  sendiri. Temuan Reviewer.
- Nol `render deploy`, nol `render restart`, nol `psql`, nol koneksi database.
- `/api/meta` dicoba dan mengembalikan **401 UNAUTHORIZED** — dicatat apa adanya
  sebagai batas akses, bukan dilewati diam-diam.
- Repo tidak disentuh selain dokumen ini.

## 6. Yang ini ubah untuk T43

Sebelum ini, "deploy staging lalu baca /api/health" terdengar seperti satu
langkah kecil. Ternyata bukan: staging bukan sekadar belum di-deploy ulang, ia
**323 commit sebelum gelombang P0-03 dimulai**. Men-deploy-nya berarti memindahkan 18 hari perubahan
sekaligus ke lingkungan yang belum pernah menjalankannya — termasuk
`preDeployCommand: node scripts/migrate-postgres-runtime.mjs`, yaitu **migrasi
schema**, yang dilarang keras di lingkup tugas ini dan bukan tindakan yang boleh
diputuskan Builder.

Jadi prasyarat T43 tetap belum terpenuhi, dan penghalangnya sekarang punya nama
dan angka, bukan lagi "butuh akses".
