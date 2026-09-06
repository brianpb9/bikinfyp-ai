// JAWABAN YANG LEBIH LAMA DARI BATAS GERBANG DI DEPAN (6 Sep 2026).
//
// Cloudflare memutus permintaan yang belum dijawab dalam 100 detik (524), dan
// batas itu tetap di paket Free — token yang kita punya bahkan tidak bisa
// membaca setelan zona (galat 9109). Menulis dua naskah kampanye memakan
// 137-224 detik terukur, jadi setiap generate berakhir 524 sementara
// pekerjaannya TETAP SELESAI di server: pengguna melihat gagal, mengulang, dan
// membayar naskah duplikat.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { jawabanPanjang, JEDA_DENYUT_MS } from "../lib/jawaban-panjang";

const kode = (rel: string) =>
  fs.readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");

test("byte pertama datang SEKETIKA, bukan menunggu pekerjaannya", async () => {
  // Yang dijaga di sini WAKTUNYA, bukan isinya.
  //
  // Versi pertama tes ini cuma memeriksa isi potongan pertama — dan lulus
  // walau baris pengiriman byte pertama DIHAPUS, karena ia sabar menunggu
  // denyut berikutnya. Tes yang sabar tidak menguji apa pun tentang batas
  // waktu. Terbukti lewat mutasi.
  let selesaikan: (v: unknown) => void = () => {};
  const res = jawabanPanjang(() => new Promise((r) => { selesaikan = r; }) as Promise<{ ok: boolean }>, { jedaMs: 2_000 });
  const reader = res.body!.getReader();
  // Dibalapkan dengan tenggat, bukan ditunggu lalu diukur: kalau byte
  // pertamanya hilang, tes harus gagal DALAM setengah detik — bukan
  // menggantung satu menit menunggu denyut berikutnya lalu baru mengeluh.
  const pertama = await Promise.race([
    reader.read(),
    new Promise<null>((r) => setTimeout(() => r(null), 500)),
  ]);
  assert.ok(pertama, "byte pertama tidak datang dalam 500ms — gerbang di depan sudah menghitung mundur");
  assert.equal(new TextDecoder().decode(pertama.value), " ");
  selesaikan({ ok: true });
  await reader.cancel().catch(() => {});
});

test("hasilnya tetap JSON yang sama — pemanggil tidak perlu diubah", async () => {
  const res = jawabanPanjang(async () => ({ product_id: "p1", scripts: [{ script_id: "s1" }] }));
  const teks = await res.text();
  assert.match(teks, /^\s/, "tidak ada denyut di depan");
  // Response.json() dan JSON.parse sama-sama memaafkan ruang putih di depan —
  // itulah yang membuat perubahan ini tidak menyentuh sisi klien.
  const d = JSON.parse(teks) as { product_id: string; scripts: { script_id: string }[] };
  assert.equal(d.product_id, "p1");
  assert.equal(d.scripts[0]!.script_id, "s1");
});

test("galat pun sampai sebagai JSON, bukan sambungan yang putus", async () => {
  const res = jawabanPanjang(async () => { throw Object.assign(new Error("gagal teknis"), { code: "X", message_id: "Pesan untuk pengguna." }); });
  const d = JSON.parse(await res.text()) as { code: string; message_id: string; retryable: boolean };
  assert.equal(d.code, "X");
  assert.equal(d.message_id, "Pesan untuk pengguna.");
  assert.equal(d.retryable, true);
});

test("denyutnya HANYA ruang putih — apa pun selain itu merusak JSON.parse", async () => {
  // DIGERAKKAN OLEH PEMBACAAN, BUKAN OLEH JAM.
  //
  // Versi pertama memakai pekerjaan yang selesai seketika, jadi tidak satu pun
  // denyut sempat terjadi — dan lulus walau denyutnya diganti "X". Versi kedua
  // memperbaikinya dengan menunggu 120ms, dan itu GOYAH: lulus sendirian,
  // gagal saat 1155 tes jalan bersamaan, karena denyut 10ms tidak dijamin
  // sempat empat kali di bawah beban. Tes yang bergantung jam mengukur mesin
  // penguji, bukan kode.
  //
  // Sekarang pekerjaannya baru diselesaikan SESUDAH tiga denyut benar-benar
  // terbaca. Tidak ada lagi yang bisa kalah cepat.
  let selesaikan: (v: { a: number }) => void = () => {};
  const res = jawabanPanjang(() => new Promise<{ a: number }>((r) => { selesaikan = r; }), { jedaMs: 5 });
  const reader = res.body!.getReader();
  const dec = new TextDecoder();
  let depan = "";
  while (depan.length < 3) {
    const { value, done } = await reader.read();
    if (done) break;
    const potong = dec.decode(value);
    assert.match(potong, /^\s*$/, `denyut memuat karakter bukan ruang putih: ${JSON.stringify(potong)}`);
    depan += potong;
  }
  assert.ok(depan.length >= 3, `cuma ${depan.length} denyut terbaca`);
  selesaikan({ a: 1 });
  let sisa = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    sisa += dec.decode(value);
  }
  assert.deepEqual(JSON.parse(depan + sisa), { a: 1 });
});

test("jeda denyut jauh di bawah batas 100 detik", () => {
  assert.ok(JEDA_DENYUT_MS <= 30_000, `jeda ${JEDA_DENYUT_MS}ms terlalu dekat ke batas 100 detik`);
});

test("rute generate kampanye memakai jawaban mengalir", () => {
  const src = kode("app/api/dashboard/campaign/generate/route.ts");
  assert.match(src, /return jawabanPanjang\(async \(\) => \{/, "rute generate belum mengalir");
  // Response.json() di dalamnya akan mengembalikan objek Response, bukan data —
  // dan itu jadi JSON bersarang yang tidak bisa dibaca klien.
  assert.doesNotMatch(src, /return Response\.json\(/, "masih ada Response.json di dalam pekerjaan yang mengalir");
});

test("pemanggil yang menutup sambungan tidak menjatuhkan proses", async () => {
  // Kalau enqueue/close dibiarkan melempar, lemparannya jadi penolakan yang
  // tidak tertangani — dan pada worker Node itu MENJATUHKAN PROSES, bukan cuma
  // menggagalkan satu permintaan. Ditemukan lewat tes ini sendiri: keenam
  // subtes lulus tapi berkasnya gagal.
  let selesaikan: (v: unknown) => void = () => {};
  const res = jawabanPanjang(() => new Promise((r) => { selesaikan = r; }) as Promise<{ ok: boolean }>);
  const reader = res.body!.getReader();
  await reader.read();
  await reader.cancel();
  selesaikan({ ok: true });
  await new Promise((r) => setTimeout(r, 20));
  // Sampai di sini tanpa penolakan yang tidak tertangani = lulus.
  assert.ok(true);
});
