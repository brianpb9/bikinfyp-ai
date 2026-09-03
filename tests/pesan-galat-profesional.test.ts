// PESAN GALAT TIDAK BOLEH MEMBOCORKAN DETAIL TEKNIS.
//
// Permintaan Brian 3 Sep 2026, setelah melihat di layar:
//   "...Coba lagi sebentar lagi ya. (sebab: penulis LLM gagal setelah
//    percobaan ulang; naskah template tidak disajikan)"
//
// Bagi penjual yang sedang mencoba membuat video, kalimat dalam kurung itu
// tidak berarti apa-apa dan tidak menyarankan tindakan apa pun. Ia juga
// membocorkan bentuk dalaman sistem kepada siapa pun yang menekan tombol.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.DB_PATH = `/tmp/racun-test-pesan-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-pesan-storage-${process.pid}`;

const { TemplateTidakDisajikan } = await import("../lib/script-engine");
const baca = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

const KATA_TEKNIS = [
  "LLM", "template", "Anthropic", "BytePlus", "Duitku", "Gemini", "kie.ai",
  "Seedance", "HTTP", "API", "validator", "timeout", "undefined", "null",
];

test("pesan pengguna tidak memuat satu pun istilah teknis", () => {
  const err = new TemplateTidakDisajikan("penulis LLM gagal setelah percobaan ulang; naskah template tidak disajikan");
  for (const kata of KATA_TEKNIS) {
    assert.ok(
      !err.message.toLowerCase().includes(kata.toLowerCase()),
      `pesan pengguna memuat "${kata}": ${err.message}`,
    );
  }
  // Tetap memberi tahu apa yang terjadi dan apa yang bisa dilakukan.
  assert.match(err.message, /belum bisa kami selesaikan/i);
  assert.match(err.message, /coba lagi/i);
});

test("sebab teknisnya TIDAK hilang — ia tetap tersedia untuk operator", () => {
  // Menyembunyikan dari pengguna bukan berarti membuang. Tanpa ini, kegagalan
  // yang sama jadi mustahil didiagnosis.
  const sebab = "penulis LLM gagal setelah percobaan ulang";
  assert.equal(new TemplateTidakDisajikan(sebab).sebabTeknis, sebab);
});

test("rute naskah tidak mengirim sebab teknis ke klien, di bahasa mana pun", () => {
  // message_en ikut terkirim ke browser — menaruh sebab teknis di sana hanya
  // memindahkan kebocoran ke bahasa lain.
  for (const rute of [
    "app/api/scripts/generate/route.ts",
    "app/api/dashboard/campaign/generate/route.ts",
  ]) {
    const src = baca(rute);
    assert.ok(
      !/message_en: `Script writer unavailable: \$\{err\.sebabTeknis\}`/.test(src),
      `${rute} masih mengirim sebab teknis lewat message_en`,
    );
    // Dan sebabnya tetap dicatat di sisi server.
    assert.match(src, /err\.sebabTeknis/, `${rute} berhenti mencatat sebab teknis sama sekali`);
  }
});

test("klien tidak menampilkan pesan galat mentah dari jaringan atau bug JS", async () => {
  const { pesanUntukPengguna, ApiFail } = await import("../app/_components/api");
  // ApiFail membawa kalimat yang memang ditulis server untuk pengguna.
  assert.equal(
    pesanUntukPengguna(new ApiFail("X", "Jatahmu habis — beli dulu ya.", true), "cadangan"),
    "Jatahmu habis — beli dulu ya.",
  );
  // Sisanya TIDAK. "Failed to fetch" bukan kalimat untuk penjual.
  assert.equal(pesanUntukPengguna(new TypeError("Failed to fetch"), "cadangan"), "Koneksinya terputus. Cek internetmu lalu coba lagi ya.");
  assert.equal(pesanUntukPengguna(new Error("ECONNRESET at socket"), "Gagal bikin skrip. Coba lagi ya."), "Gagal bikin skrip. Coba lagi ya.");
  assert.equal(pesanUntukPengguna({ aneh: true }, "cadangan"), "cadangan");
});

test("tidak ada layar yang menampilkan err.message mentah lagi", () => {
  const dir = path.join(process.cwd(), "app");
  const bocor: string[] = [];
  const telusuri = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, entry.name);
      if (entry.isDirectory()) { telusuri(f); continue; }
      if (!/\.tsx?$/.test(entry.name)) continue;
      const src = fs.readFileSync(f, "utf8");
      // Hanya KOMPONEN KLIEN yang diperiksa. Rute server sah menyimpan pesan
      // galat penyedia ke database untuk rekonsiliasi — itu tidak pernah
      // sampai ke layar siapa pun, dan membuangnya justru menghapus jejak yang
      // dibutuhkan saat menelusuri pembayaran yang gagal.
      if (!/^["']use client["']/m.test(src)) continue;
      if (/err instanceof Error \? err\.message/.test(src)) bocor.push(path.relative(process.cwd(), f));
    }
  };
  telusuri(dir);
  assert.deepEqual(bocor, [], "layar ini masih menampilkan pesan galat mentah ke pengguna");
});

// ── HARGA TERBILANG YANG AMBIGU ────────────────────────────────────────────
//
// Naskah yang menyebut harga DENGAN BENAR untuk produk Rp1.500.000 ditolak
// validator sebagai "harga tidak cocok" — tiga kali berturut-turut, sehingga
// seluruh permintaan gagal. Terjadi nyata 3 Sep 2026 pada speaker Rp1.500.000.
test("\"satu juta lima ratus\" dibaca 1.500.000 juga, bukan cuma 1.000.500", async () => {
  const { hargaTerbilang } = await import("../lib/script-engine/validator");
  for (const frasa of ["satu juta lima ratus", "sejuta lima ratus"]) {
    const h = hargaTerbilang(frasa)[0];
    assert.equal(h.nilai, 1_000_500, "bacaan harfiah hilang — harga jadi tidak terjaga");
    assert.equal(h.alternatif, 1_500_000, `"${frasa}" tidak menawarkan bacaan idiomatis`);
  }
  // Bentuk yang TIDAK ambigu tidak boleh dapat alternatif karangan.
  for (const jelas of ["satu juta lima ratus ribu", "delapan puluh lima ribu", "dua setengah juta"]) {
    assert.equal(hargaTerbilang(jelas)[0]?.alternatif, undefined, `"${jelas}" tidak ambigu tapi diberi alternatif`);
  }
});

test("validator lulus bila SALAH SATU bacaan cocok dengan harga produk", async () => {
  const src = fs.readFileSync(path.join(process.cwd(), "lib/script-engine/validator.ts"), "utf8");
  assert.match(
    src,
    /!\(h\.alternatif !== undefined && allowedPriceAmounts\.has\(h\.alternatif\)\)/,
    "validator hanya menerima bacaan harfiah — naskah yang benar tetap ditolak",
  );
});
