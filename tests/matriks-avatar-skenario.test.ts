// Matriks avatar x skenario — invarian yang bisa diperiksa tanpa PostgreSQL.
//
// Route-nya butuh runtime Postgres, jadi tes ini tidak menjalankannya. Yang
// diperiksa adalah hal-hal yang KALAU SALAH akan menghasilkan kerusakan mahal
// dan sunyi: setiap avatar harus punya suara aktif, batas sel harus benar-
// benar ditegakkan, dan tarif tidak boleh disalin ke komponen klien.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

import { AVATAR_PRESETS } from "../lib/avatar-presets";
import { getCreatorCategory } from "../lib/personas";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { aiRenderBlockMessage } from "../lib/template-render-safety";

const baca = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");
const route = baca("app/api/dashboard/matrix/route.ts");
const halaman = baca("app/dashboard/(app)/matrix/MatrixClient.tsx");

// Cacat yang persis ini baru ditutup di wizard retail 16 Agu 2026: avatar yang
// kategori suaranya tidak aktif akan lolos ke worker lalu jatuh ke suara
// bawaan — avatar laki-laki bersuara perempuan. Di matriks kerusakannya
// berlipat: satu avatar rusak muncul di SETIAP skenario yang dipilih.
test("setiap avatar menunjuk kategori suara yang benar-benar aktif", () => {
  const rusak = AVATAR_PRESETS.filter((a) => {
    const k = getCreatorCategory(a.voice);
    return !k || k.status !== "active";
  }).map((a) => `${a.name} -> ${a.voice}`);
  assert.deepEqual(rusak, [], "avatar ini akan jatuh ke suara bawaan saat dirender");
});

test("setiap avatar punya deskripsi wajah — tanpa itu matriks berisi wajah kembar", () => {
  const tanpaDesc = AVATAR_PRESETS.filter((a) => !a.desc || a.desc.trim().length < 20).map((a) => a.name);
  assert.deepEqual(tanpaDesc, [],
    "avatar tanpa deskripsi akan tampil sama dengan avatar lain yang berbagi kategori suara");
});

test("matriks tidak menawarkan template bukti yang dilarang dirender AI", () => {
  // Ditawarkan lalu ditolak saat submit cuma memindahkan kekecewaan ke
  // belakang — dan brand sudah terlanjur menyusun matriks 12 sel.
  assert.match(route, /\.filter\(\(t\) => !aiRenderBlockMessage\(t\.id\)\)/,
    "katalog skenario harus menyaring template yang diblokir");
  // Penyaring itu memang punya sesuatu untuk disaring — kalau tidak, penjaga
  // di atas lulus tanpa memeriksa apa pun.
  const diblokir = CAMPAIGN_TEMPLATES.filter((t) => aiRenderBlockMessage(t.id));
  assert.ok(diblokir.length > 0, "harus ada template yang memang diblokir");
});

test("batas sel ditegakkan di server, bukan cuma di tombol", () => {
  assert.match(route, /const MAKS_SEL = \d+/, "batas sel harus konstanta di server");
  assert.match(route, /totalSel > MAKS_SEL/, "batas harus benar-benar diperiksa, bukan cuma dideklarasikan");
  // UI boleh mematikan tombolnya, tapi permintaan yang lewat UI harus tetap
  // ditolak: matriks 12x6 sekali klik itu Rp864.000.
  assert.match(route, /Matrix exceeds cell cap/, "penolakannya harus punya alasan yang bisa dilacak");
});

test("halaman matriks tidak menyalin tarif — diambil dari server", () => {
  // Pelajaran yang sudah dibayar sekali di sidebar dashboard: tarif yang
  // disalin ke komponen klien pasti hanyut, dan yang menemukan selisihnya
  // pengguna, setelah menekan tombol yang menjanjikan angka lain.
  assert.ok(!/80_000|12_000|80000|12000/.test(halaman),
    "angka tarif tidak boleh ditulis di komponen klien");
  assert.match(halaman, /katalog\?\.prices\[/, "tarif harus dibaca dari katalog kiriman server");
  assert.match(route, /tierPriceIdr\(t, d\)/, "server harus memakai rumus harga yang sama dengan penahanan kredit");
});

test("satu skenario menghasilkan satu baris skrip PER AVATAR", () => {
  // Bukan detail implementasi: baris skrip diklaim satu job lewat
  // "WHERE job_id IS NULL", jadi satu baris dipakai bersama lima avatar akan
  // membuat empat sel gagal diam-diam dengan alasan "sudah dipakai".
  assert.match(route, /smokeCreateScripts\(user\.id, productId, avatars\.map\(/,
    "jumlah baris skrip harus mengikuti jumlah avatar");
});

test("wajah influencer dikirim ke perencana shot, bukan dibiarkan bawaan", () => {
  assert.match(route, /avatarCustomDesc: preset\.desc/,
    "tanpa ini matriks avatar berisi wajah kembar dan tidak membuktikan apa pun");
});

// Kepemilikan per-ORG, bukan per-anggota. Produk dashboard dibuat satu orang,
// dibayar dompet organisasi, dan dipakai seluruh tim. Pemeriksaan per-user
// membuat rekan satu tim melihat produk di daftar lalu ditolak "tidak
// ditemukan" saat menekan render — dan pada PATCH lebih buruk lagi: lolos
// pemeriksaan tapi mengenai nol baris, jadi Simpan berhasil tanpa menyimpan.
test("route dashboard memeriksa produk terhadap organisasi, bukan pembuatnya", () => {
  const routes = [
    "app/api/dashboard/matrix/route.ts",
    "app/api/dashboard/campaign/confirm/route.ts",
    "app/api/dashboard/campaign/generate/route.ts",
    "app/api/dashboard/campaign/product/route.ts",
  ];
  for (const rel of routes) {
    const isi = baca(rel);
    assert.ok(!/smokeGetProduct\(user\.id/.test(isi), `${rel} masih memeriksa produk per-user`);
    assert.match(isi, /smokeGetOrgProduct\(membership\.org_id/, `${rel} harus memeriksa produk per-org`);
  }
});

test("UPDATE produk memakai kunci yang sama dengan pemeriksaannya", () => {
  const isi = baca("app/api/dashboard/campaign/product/route.ts");
  assert.ok(!/UPDATE products SET[^"]*WHERE id=\$9 AND user_id=/.test(isi),
    "pemeriksaan per-org + UPDATE per-user = Simpan yang berhasil tanpa menyimpan");
  assert.match(isi, /WHERE id=\$9 AND org_id=\$10/, "UPDATE harus dikunci per-org");
});

// Board menahan Matriks untuk pengguna berbayar (17 Agu 2026) sampai approval
// naskah, konfirmasi belanja, dan idempotensi selesai. Penahanan itu harus
// nyata di SERVER — UI yang disembunyikan bukan penjagaan, dan URL langsung
// tetap bisa diketik.
test("matriks mati secara bawaan dan dijaga di sisi server", () => {
  const cfg = baca("lib/config.ts");
  assert.match(cfg, /enterpriseMatrixEnabled: env\("ENTERPRISE_MATRIX_ENABLED", "false"\)/,
    "bawaannya harus MATI, dinyalakan lewat env");
  assert.match(route, /pastikanMatriksAktif\(\);/, "route harus memeriksa gerbang");
  assert.equal((route.match(/pastikanMatriksAktif\(\);/g) ?? []).length, 2,
    "POST dan GET dua-duanya harus dijaga");
  const halaman = baca("app/dashboard/(app)/matrix/page.tsx");
  assert.match(halaman, /if \(!config\.enterpriseMatrixEnabled\) notFound\(\)/,
    "halaman harus 404 di server, bukan sekadar hilang dari sidebar");
});
