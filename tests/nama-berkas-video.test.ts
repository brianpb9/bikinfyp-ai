// Nama berkas video: dikenali pemiliknya, dan tidak pernah bentrok.
//
// Catatan Brian 4 Sep 2026: "nama generated video anda selalu racun-video.mp4,
// sesuaikan dengan nama product yang digenerate supaya unik."
//
// Nama itu dipaku di dua halaman. Kreator yang membuat sepuluh video menemukan
// sepuluh berkas bernama sama di folder unduhan dan harus membuka satu per satu.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { namaBerkasVideo } from "../lib/nama-berkas-video";

test("nama produk masuk, dan hasilnya rapi", () => {
  assert.equal(
    namaBerkasVideo("Serum Glow Bening", "a65ec5dd-5f94-4730-bae8-9a8d47f08183"),
    "serum-glow-bening-a65ec5dd.mp4",
  );
});

test("judul marketplace 24 kata dipotong, bukan diteruskan utuh", () => {
  const panjang = "ADVANCE Portable K1812-C Speaker Profesional Party RMS 100W 18inch - GARANSI RESMI karokean paket Bluetooth Extra Bass";
  const n = namaBerkasVideo(panjang, "be16d8f3-1843-49f8-b5c5-5c66ed29d33a");
  assert.ok(n.length <= 60, `nama berkas terlalu panjang (${n.length}): ${n}`);
  assert.match(n, /^advance-portable/, "bagian awal nama produk hilang");
  assert.match(n, /be16d8f3\.mp4$/);
});

test("produk SAMA, job berbeda -> nama berbeda", () => {
  // Satu produk lazim dibuatkan beberapa video; nama produk saja akan bentrok.
  const a = namaBerkasVideo("Serum Glow", "aaaaaaaa-1111-2222-3333-444444444444");
  const b = namaBerkasVideo("Serum Glow", "bbbbbbbb-1111-2222-3333-444444444444");
  assert.notEqual(a, b);
});

test("nama kosong atau aneh tetap menghasilkan berkas yang sah", () => {
  assert.equal(namaBerkasVideo("", "abc12345-x"), "video-abc12345.mp4");
  assert.equal(namaBerkasVideo(null, "abc12345-x"), "video-abc12345.mp4");
  // Karakter yang bisa menyuntik header atau merusak path tidak boleh lolos.
  const n = namaBerkasVideo('a"b\r\nc/d\\e', "abc12345-x");
  assert.doesNotMatch(n, /["\r\n/\\]/, `karakter berbahaya lolos: ${n}`);
});

test('nama "racun-video.mp4" tidak dipaku lagi di halaman mana pun', () => {
  for (const f of ["app/bikin/hasil/page.tsx", "app/bikin/paket/page.tsx"]) {
    const src = fs.readFileSync(path.join(process.cwd(), f), "utf8");
    assert.doesNotMatch(src, /download="racun-video\.mp4"/, `${f} masih memaku nama lama`);
  }
});
