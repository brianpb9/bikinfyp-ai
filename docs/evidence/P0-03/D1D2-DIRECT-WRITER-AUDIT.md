# P0-D1/D2 — exact-tree direct-writer audit

TASK=`P0-D1D2-DIRECT-WRITER-AUDIT-20260823`

Audit base: `4640bd10531e8d04fb404147b2257ac491e20c47`

Scope ini read-only terhadap kode dan data: tidak ada koneksi database,
credential, deploy, migrasi, perubahan produk, atau perubahan test. Hanya
dokumen bukti dan matriks yang berubah.

## Kesimpulan

| Writer | Reachability | Status | Kesimpulan |
|---|---|---|---|
| D1 `PgProductPersonaScriptRepository` | production/staging, plus verifier disposable | **PARTIAL** | Seluruh create production yang membawa image keys lebih dulu memakai helper yang menerbitkan sidecar. Tetapi writer menerima `images` mentah dan tidak punya gate sendiri; mutation production E3 untuk name/category/brand juga tidak merevalidasi product-truth. |
| D2 `pgSetProductImages` / `pgAppendOrgProductImages` / `pgRemoveOrgProductImage` | production/staging melalui E4/E5/E8/E9 | **PARTIAL** | Add retail/org menerima keys dari helper bersidecar. Delete retail/org dan append org tetap mewarisi gap E5/E8/E9: tidak ada revalidasi daftar tersisa, dan E8 belum menegakkan brand/reference eligibility lengkap. |

D1/D2 bukan dead code, bukan smoke-only, dan bukan entrypoint baru yang
tersembunyi. Semua caller production-nya sudah terpetakan ke E1–E9. Karena
masih ada bypass executable pada mutation routes, `PASS` tidak jujur. Karena
sebagian invariant sidecar sudah berlaku langsung, `BLOCKED` juga terlalu
kasar. `NOT-APPLICABLE` salah karena deployment web mengaktifkan PostgreSQL.

### Klasifikasi tiap write

| Write literal | Field product-truth yang disentuh | Lingkungan reachable |
|---|---|---|
| D1 `createProduct` → `insertProduct` | membuat `images`, `name`, `category`, `raw_meta` (termasuk brand bila caller memberi) | deployed call-sites E1/E2/E6; HTTP runtime smoke mengeksekusi E1 saja; direct verifier disposable |
| D1 `createExtractedProduct` → `insertProduct` | membuat field yang sama | test-only verifier parity; tidak ada wrapper/runtime/migration caller |
| D1 `updateOwnedProduct` | mutasi `name`, `category`; tidak menyentuh `images`/brand | deployed call-site E3; tidak dilalui runtime smoke; verifier disposable |
| D1 `setOwnedProductBrand` | mutasi `raw_meta.brand`; tidak menyentuh `images`/name/category | deployed call-site E3; tidak dilalui runtime smoke |
| D2 `pgSetProductImages` | mengganti seluruh `images` | deployed call-sites E4/E5 berdasarkan inspeksi; tidak dilalui runtime smoke; tanpa jalur CLI langsung |
| D2 `pgAppendOrgProductImages` | append `images` | deployed call-site E8 berdasarkan inspeksi; tidak dilalui runtime smoke; tidak ada CLI/migration caller |
| D2 `pgRemoveOrgProductImage` | remove dari `images` | deployed call-site E9 berdasarkan inspeksi; tidak dilalui runtime smoke; tidak ada CLI/migration caller |

Tidak ada migration yang mengimpor D1/D2. Tidak ada export barrel lain:
D1 diekspor dari file asal dan dibungkus `smoke-runtime`; D2 diekspor langsung
dari `smoke-runtime`. Nama `smoke*` adalah warisan checkpoint, bukan batas
deployment.

## Call graph ringkas

```text
DEPLOYED REACHABILITY — bukti call-site + manifest RACUN_DB_RUNTIME=postgres
├─ E1 POST /api/products
│  └─ saveProductImages → tulisSidecar
│     └─ smokeCreateProduct → D1.createProduct → D1.insertProduct
├─ E2 POST /api/products/extract
│  └─ downloadProductImages → tulisSidecar
│     └─ smokeCreateProduct → D1.createProduct → D1.insertProduct
├─ E3 PATCH /api/products/[id]
│  ├─ pgUpdateProduct → D1.updateOwnedProduct       (name/category)
│  └─ pgSetProductBrand → D1.setOwnedProductBrand  (raw_meta.brand)
├─ E4 POST /api/products/[id]/photos
│  └─ saveProductImages → tulisSidecar → referensiLayak
│     └─ persistImages → D2.pgSetProductImages
├─ E5 DELETE /api/products/[id]/photos
│  └─ persistImages → D2.pgSetProductImages
│     └─ deleteStoredProductImages([target]) best-effort
├─ E6 POST /api/dashboard/campaign/product
│  ├─ URL: downloadProductImages → tulisSidecar
│  │  └─ smokeCreateProduct → D1.createProduct → D1.insertProduct
│  └─ manual: images=[] → smokeCreateProduct → D1.createProduct
├─ E8 POST /api/dashboard/campaign/product/[id]/photos
│  └─ saveUniqueProductImages → tulisSidecar
│     └─ D2.pgAppendOrgProductImages
└─ E9 DELETE /api/dashboard/campaign/product/[id]/photos
   └─ D2.pgRemoveOrgProductImage
      └─ deleteStoredProductImages([target]) best-effort

package.json:test:postgres-product-persona-script
└─ disposable DB → verify-product-persona-script-parity.ts
   └─ D1.createProduct/createExtractedProduct/updateOwnedProduct (test-only direct calls)

package.json:test:postgres-runtime-smoke
└─ disposable DB + RACUN_POSTGRES_SMOKE=1
   └─ POST /api/products (E1 SAJA)
      └─ saveProductImages → tulisSidecar
         └─ smokeCreateProduct → D1.createProduct → D1.insertProduct
```

Cabang E2–E9/D2 pada graph pertama adalah reachability hasil inspeksi call-site,
bukan bukti eksekusi runtime smoke. `scripts/smoke-e2e.sh` hanya memanggil
`POST /api/products` untuk keluarga product writer ini.

E7 PATCH org menulis `products` lewat SQL langsung di route, bukan lewat D1.
Ia tetap tercatat sebagai E7 PARTIAL dan tidak dipindahkan secara keliru ke D1.

## Audit per write

### D1

- `createProduct` dan private `insertProduct` menulis `name`, `category`,
  `images`, dan `raw_meta`. Production caller hanya `smokeCreateProduct`.
  Ketiga caller route-nya adalah E1, E2, E6.
- E1 memanggil `saveProductImages` sebelum D1; E2 dan E6 URL memanggil
  `downloadProductImages`; kedua helper menerbitkan sidecar dengan
  `tulisSidecar`. E6 manual menulis `images=[]`, lalu foto masuk lewat E8.
- `createExtractedProduct` tidak punya caller runtime. Satu-satunya direct
  caller adalah verifier parity disposable.
- `updateOwnedProduct` reachable lewat E3 dan mengubah name/category, bukan
  images. Route memvalidasi bentuk name/price dan hanya trim category; ia tidak
  menjalankan type/category/product-truth revalidation.
- `setOwnedProductBrand` reachable lewat E3 dan mengubah `raw_meta.brand`,
  bukan images. Caller memakai `validBrand`, tetapi tidak merevalidasi bukti
  foto terhadap merek baru.
- Header lama `smoke-runtime.ts` yang menyebut hanya `RACUN_POSTGRES_SMOKE=1`
  bukan fakta runtime saat ini: fungsi switch juga menerima
  `RACUN_DB_RUNTIME=postgres`, dan kedua manifest Render menetapkan nilai itu.

### D2

- `pgSetProductImages` punya satu caller production helper, `persistImages`,
  yang dipakai E4 dan E5. E4 sudah menerbitkan sidecar dan memanggil
  `referensiLayak`; E5 memfilter daftar lalu membersihkan objek+sidecar target
  best-effort, tetapi tidak memeriksa bahwa referensi layak masih tersisa.
- `pgAppendOrgProductImages` hanya dipanggil E8. Keys datang dari
  `saveUniqueProductImages`, yang menerbitkan sidecar. E8 masih hanya memeriksa
  label foto pertama, tanpa `merekTerdaftar`, dan tidak memanggil
  `referensiLayak` atas daftar hasil.
- `pgRemoveOrgProductImage` hanya dipanggil E9. Sesudah DB update, route
  menghapus foto+sidecar dengan `deleteStoredProductImages` secara best-effort.
  Daftar hasil tidak direvalidasi agar masih punya referensi layak.
- Tidak ada CLI/package script yang memanggil ketiga D2 function secara
  langsung. Test struktural hanya mengunci call E8/E9; ia bukan writer baru.

## Remediasi terkecil yang tercatat, tidak diimplementasikan

1. E3/D1 mutation: setelah perubahan name/category/brand, gunakan kontrak
   identitas/snapshot yang disetujui atau wajibkan revalidation sebelum
   admission berikutnya. Jangan menaruh klasifikasi berbayar/IO diam-diam di
   repository generik tanpa keputusan kontrak C9/C12.
2. E5/E9 delete: hitung daftar hasil dan tolak/karantina mutation bila tidak
   tersisa referensi layak. Cleanup storage sesudah persist sudah best-effort;
   kegagalannya tidak boleh menghidupkan kembali entry daftar.
3. E8 append: terus wajibkan keys berasal dari helper bersidecar, lalu tutup
   gap brand (`merekTerdaftar`) dan eligibility daftar pada route boundary.

Ini bukan scope implementasi audit ini. Gap tersebut sudah hidup di baris
E3/E5/E8/E9 dan kasus C3/C7/C9/C12; audit tidak menduplikasinya sebagai jalur
baru.

## Transcript reproduktif

Seluruh perintah dijalankan dari repository root pada base di atas.

### 1. Repository surface D1

```sh
rg -n --glob '!node_modules/**' --glob '!.git/**' \
  'PgProductPersonaScriptRepository|\.createProduct\(|\.createExtractedProduct\(|\.updateOwnedProduct\(|\.setOwnedProductBrand\(' \
  lib app scripts tests
```

Exit `0`. Output hanya menunjukkan dua importer class: wrapper runtime
`lib/postgres/smoke-runtime.ts:18` dan verifier disposable
`scripts/verify-product-persona-script-parity.ts:55`. Direct method calls hanya
ada di wrapper (`:116,124,142`) dan verifier (`:61-65,73`).

### 2. Caller D1 wrapper

```sh
rg -n --glob '!node_modules/**' --glob '!.git/**' \
  '\b(smokeCreateProduct|pgUpdateProduct|pgSetProductBrand)\b' \
  app lib scripts tests
```

Exit `0`. Caller production literal:

- `app/api/products/route.ts:99` (E1);
- `app/api/products/extract/route.ts:53` (E2);
- `app/api/products/[id]/route.ts:58,71` (E3);
- `app/api/dashboard/campaign/product/route.ts:66,83` (E6).

Tidak ada caller lain di `app/lib/scripts/tests` selain definisi wrapper.

### 3. Caller D2

```sh
rg -n --glob '!node_modules/**' --glob '!.git/**' \
  '\b(pgSetProductImages|pgAppendOrgProductImages|pgRemoveOrgProductImage)\b' \
  app lib scripts tests
```

Exit `0`. Selain tiga definisi `smoke-runtime.ts:310,319,336`, output hanya:

- E4/E5: import `app/api/products/[id]/photos/route.ts:6`, call `:32`;
- E8/E9: import `app/api/dashboard/campaign/product/[id]/photos/route.ts:9`,
  calls `:62,94`;
- `tests/avatar-picker-unification.test.ts:69-70`, asersi struktural, bukan writer.

### 4. Penerbit sidecar

```sh
rg -n 'export async function (saveProductImages|saveUniqueProductImages|downloadProductImages)|await tulisSidecar' \
  lib/product-images.ts lib/product-image-download.ts
```

Exit `0`. Output mengikat:

- `downloadProductImages` → `tulisSidecar` (`:15,48`);
- `saveProductImages` → `tulisSidecar` (`:224,271`);
- `saveUniqueProductImages` → `tulisSidecar` (`:297,327`).

### 5. Reachability deployment

```sh
rg -n 'postgresRuntimeEnabled|RACUN_DB_RUNTIME' \
  lib/postgres/smoke-runtime.ts lib/config.ts render.yaml render.production.yaml .env.example
```

Exit `0`. `postgresRuntimeEnabled` menerima `RACUN_DB_RUNTIME=postgres`
secara LANGSUNG dari `process.env` (`smoke-runtime.ts:31-32`). Default
`config.dbRuntime` tidak mengaktifkan switch ini karena tidak dibaca oleh
`postgresRuntimeEnabled`. Reachability deployed dibuktikan oleh nilai eksplisit
`RACUN_DB_RUNTIME=postgres` di `render.yaml:21-22,99-100` dan
`render.production.yaml:22-23,114-115`.

### 6. CLI/package scripts

```sh
rg -n 'test:postgres-product-persona-script|test:postgres-runtime-smoke' package.json
rg -n 'verify-product-persona-script-parity|RACUN_POSTGRES_SMOKE' \
  scripts/test-postgres-product-persona-script.sh scripts/test-postgres-runtime-smoke.sh
rg -n 'api/products|api/dashboard|/photos|/extract|method.*PATCH|method.*DELETE' \
  scripts/smoke-e2e.sh
```

Ketiganya exit `0`. Package scripts berada di `package.json:24,28`. Parity
runner memanggil verifier pada SQLite dan PostgreSQL disposable
(`test-postgres-product-persona-script.sh:22-23`); runtime smoke memakai
`RACUN_POSTGRES_SMOKE=1` dan database disposable (`test-postgres-runtime-smoke.sh:25`).
Untuk keluarga writer produk, pencarian literal atas `scripts/smoke-e2e.sh`
hanya menemukan `POST "$BASE/api/products"` pada baris 60; tidak ada extract,
PATCH, photo, DELETE, atau route organisasi. Jadi bukti eksekusinya hanya E1.

### 7. Pemeriksaan kontradiksi R2A/B3

```sh
rg -n '\bD1\b|\bD2\b|product-persona-script|pgSetProductImages|pgAppendOrgProductImages|pgRemoveOrgProductImage' \
  docs/evidence/P0-03/R2A-KONTRAK.md docs/evidence/P0-03/B3-AUDIT-LEGACY.md
```

Exit `1`, output kosong. Tidak ada klaim D1/D2 yang langsung terdampak di dua
dokumen itu, jadi keduanya sengaja tidak diubah.

### 8. Pemeriksaan diff evidence

```sh
git diff --cached --check
```

Exit `0`, output kosong.
