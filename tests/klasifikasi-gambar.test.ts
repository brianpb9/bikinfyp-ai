// GRAFIS PROMOSI TIDAK PERNAH JADI REFERENSI.
//
// Fixture-nya bukan buatan tes: berkas di handover JJ Glow 18 Agu sudah
// DINAMAI manusia `02-banner-promo-JANGAN-DIPAKAI.jpeg` dan
// `04-crop-banner-JANGAN-DIPAKAI.png`. Jadi keputusan yang benar sudah
// diketahui berbulan-bulan; yang belum ada cuma kode yang tahu bedanya.
//
// Ambangnya diukur, bukan ditebak — sebarannya ada di komentar
// lib/media/klasifikasi-gambar.ts.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-klas-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-klas-storage-${process.pid}`;

const { klasifikasiGambar } = await import("../lib/media/klasifikasi-gambar");

const T = path.resolve(process.cwd(), "..", "test_output");
const R = path.join(T, "jjglow", "handover", "refs", "product");

function punyaOcr(): boolean {
  try {
    execFileSync("tesseract", ["--version"], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const PROMOSI = [
  path.join(R, "02-banner-promo-JANGAN-DIPAKAI.jpeg"),
  path.join(R, "04-crop-banner-JANGAN-DIPAKAI.png"),
];
const FOTO = [
  path.join(R, "01-packshot-bersih-351px.webp"),
  path.join(R, "03-thumbnail.jpeg"),
  path.join(T, "canary-glow.jpg"),
];

test("FIXTURE REGRESI: banner bertanda JANGAN-DIPAKAI ditolak jadi referensi", async (t) => {
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada");
  for (const f of PROMOSI) {
    if (!fs.existsSync(f)) return t.skip(`fixture tidak ada: ${f}`);
    const h = await klasifikasiGambar(f);
    assert.equal(
      h.jenis, "promotional_graphic",
      `${path.basename(f)} lolos sebagai foto produk (rasio ${h.rasioAreaTeks.toFixed(4)}, kata ${h.jumlahKata})`
    );
    assert.equal(h.layakReferensi, false);
    assert.ok(h.alasan.length > 30, "penolakan tanpa alasan yang bisa dibaca pengguna");
  }
});

test("foto produk sungguhan TETAP layak — gerbang yang menolak yang benar akan dimatikan", async (t) => {
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada");
  for (const f of FOTO) {
    if (!fs.existsSync(f)) continue;
    const h = await klasifikasiGambar(f);
    assert.equal(
      h.jenis, "product_photo",
      `${path.basename(f)} salah ditolak (rasio ${h.rasioAreaTeks.toFixed(4)}, kata ${h.jumlahKata})`
    );
    assert.equal(h.layakReferensi, true);
  }
});

test("JURANG ambang masih lebar — kalau menyempit, ambangnya harus diukur ulang", async (t) => {
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada");
  const rasio = async (f: string) => (await klasifikasiGambar(f)).rasioAreaTeks;
  const fotoTertinggi = Math.max(...(await Promise.all(FOTO.filter(fs.existsSync).map(rasio))));
  const promosiTerendah = Math.min(...(await Promise.all(PROMOSI.filter(fs.existsSync).map(rasio))));
  assert.ok(
    promosiTerendah > fotoTertinggi * 2,
    `jurang menyempit: foto tertinggi ${fotoTertinggi.toFixed(4)} vs promosi terendah ${promosiTerendah.toFixed(4)} — ` +
      "ambang 0,02 tidak lagi duduk di tengah dan harus diukur ulang dari fixture"
  );
});

// GAGAL MEMERIKSA BUKAN VONIS. Ini kontrak BARU dan sengaja MERAH di HEAD.
//
// Versi sebelumnya menuntut berkas yang tidak bisa diperiksa menjadi
// `promotional_graphic`. Temuan Reviewer 21 Agu, dan ia benar: kontrak itu
// bertentangan dengan dua dokumen yang sudah terikat di tree ini —
// PATH-CASE-MATRIX C7 (`CLASSIFIER_FAILED`, fail-closed) dan
// B1-B2-MATRIKS-INGESTION, yang menyebut penyamaan "banner" dengan "pemeriksaan
// gagal" sebagai bukti permanen yang berbohong. Implementasi P0-B2 yang BENAR
// akan dipaksa merah oleh kontrol lama itu, dan tekanan berikutnya adalah
// membatalkan perbaikan yang benar demi menghijaukan test. Itu persis pola yang
// sudah dicabut sekali di gelombang ini (backfill malas); ini saudaranya yang
// terlewat.
//
// Yang DIPERTAHANKAN utuh: keputusan gerbangnya. "Ragu tidak boleh lolos" tetap
// benar, jadi `layakReferensi` tetap `false`. Yang berubah hanya kejujuran
// CATATANNYA — dan itu yang menentukan apakah bukti bisa direvalidasi nanti
// oleh boundary yang punya binernya, atau membeku jadi vonis palsu selamanya.
//
// Dua sisi diuji berpasangan supaya tidak ada yang bisa dihijaukan dengan
// menghapus perbedaannya:
//   - tidak bisa diperiksa  -> `belum_diperiksa`, layakReferensi false
//   - benar-benar diperiksa dan memang banner -> `promotional_graphic`
const STATUS_BELUM_DIPERIKSA = "belum_diperiksa";

/**
 * TIGA MODE KEGAGALAN, bukan satu.
 *
 * Temuan Reviewer ronde 6: versi pertama kontrak ini hanya memberi path berkas
 * yang tidak ada. Implementasi bisa mengembalikan `belum_diperiksa` khusus untuk
 * input hilang lalu TETAP mengembalikan `promotional_graphic` saat spawn
 * ffmpeg/ffprobe/tesseract gagal atau timeout — dan seluruh kontrak itu tetap
 * lulus. Padahal justru kegagalan BINER-lah cacat P0-B2 yang sesungguhnya:
 * service web Render (`runtime: node`) tidak dijamin punya ketiganya.
 *
 * Ketiganya karena itu diuji atas GAMBAR YANG SAH DAN BENAR-BENAR ADA (dibuat
 * dengan sharp saat test berjalan, jadi deterministik di mesin mana pun tanpa
 * fixture eksternal), dengan PATH yang dikendalikan test:
 *
 *   1. biner HILANG        -> PATH kosong, spawn ENOENT
 *   2. biner GAGAL         -> ffmpeg palsu yang exit 1
 *   3. biner MENGGANTUNG   -> ffmpeg palsu yang tidur melewati timeout 20 detik
 *
 * Mode 3 memakan ~20 detik dan itu disengaja: ia satu-satunya cara menguji
 * jalur timeout tanpa mengubah produksi (timeout 20_000 dipatok di
 * lib/media/klasifikasi-gambar.ts, tidak ada env yang mengubahnya).
 */
async function gambarSahSementara(dir: string): Promise<string> {
  const sharp = (await import("sharp")).default;
  const berkas = path.join(dir, "packshot.webp");
  await sharp({ create: { width: 400, height: 400, channels: 3, background: { r: 200, g: 200, b: 200 } } })
    .webp()
    .toFile(berkas);
  return berkas;
}

function binPalsu(dir: string, nama: string, isi: string): void {
  const berkas = path.join(dir, nama);
  fs.writeFileSync(berkas, isi, { mode: 0o755 });
}

const modeKegagalan: { judul: string; siapkan: (bin: string) => void; lambat?: boolean }[] = [
  {
    judul: "biner HILANG (PATH kosong, spawn ENOENT)",
    siapkan: () => {
      /* direktori bin sengaja dibiarkan kosong */
    },
  },
  {
    judul: "biner GAGAL (exit bukan nol)",
    siapkan: (bin) => binPalsu(bin, "ffmpeg", "#!/bin/sh\nexit 1\n"),
  },
  {
    judul: "biner MENGGANTUNG (timeout 20 detik)",
    siapkan: (bin) => binPalsu(bin, "ffmpeg", "#!/bin/sh\nsleep 25\n"),
    lambat: true,
  },
];

for (const mode of modeKegagalan) {
  test(`gagal memeriksa — ${mode.judul} = BELUM DIPERIKSA, dan tetap tidak layak`, async () => {
    const kerja = fs.mkdtempSync(path.join(os.tmpdir(), "klas-gagal-"));
    const bin = path.join(kerja, "bin");
    fs.mkdirSync(bin);
    mode.siapkan(bin);
    const foto = await gambarSahSementara(kerja);
    const pathAsli = process.env.PATH;
    const ffmpegAsli = process.env.FFMPEG_PATH;
    const ffprobeAsli = process.env.FFPROBE_PATH;
    process.env.PATH = bin;
    delete process.env.FFMPEG_PATH;
    delete process.env.FFPROBE_PATH;
    try {
      const h = await klasifikasiGambar(foto);

      assert.equal(
        h.layakReferensi,
        false,
        `${mode.judul}: RAGU = TIDAK LOLOS masih berlaku — pemeriksaan yang gagal tidak boleh ` +
          "menghasilkan referensi"
      );
      assert.notEqual(
        h.jenis,
        "promotional_graphic",
        `${mode.judul}: kegagalan biner dicatat sebagai VONIS "promotional_graphic" atas gambar ` +
          "yang SAH dan BENAR-BENAR ADA. Inilah cacat P0-B2: service web Render (runtime: node) " +
          "tidak dijamin punya ffmpeg/ffprobe/tesseract, jadi setiap foto produk yang sah akan " +
          "dicap promosi selamanya oleh sidecar yang tidak bisa dibedakan dari banner sungguhan."
      );
      assert.equal(
        h.jenis,
        STATUS_BELUM_DIPERIKSA,
        `${mode.judul}: status non-vonis eksplisit "${STATUS_BELUM_DIPERIKSA}" belum ada. ` +
          "Reason code penolakannya CLASSIFIER_FAILED (PATH-CASE-MATRIX C7)."
      );
      assert.ok(h.alasan.length > 10, `${mode.judul}: penolakan tanpa alasan yang bisa dibaca`);
    } finally {
      if (pathAsli === undefined) delete process.env.PATH;
      else process.env.PATH = pathAsli;
      if (ffmpegAsli !== undefined) process.env.FFMPEG_PATH = ffmpegAsli;
      if (ffprobeAsli !== undefined) process.env.FFPROBE_PATH = ffprobeAsli;
      fs.rmSync(kerja, { recursive: true, force: true });
    }
  });
}

test("gagal memeriksa — berkas TIDAK ADA = BELUM DIPERIKSA, dan tetap tidak layak", async () => {
  const h = await klasifikasiGambar("/tmp/berkas-yang-tidak-ada-sama-sekali.png");

  // Keputusan gerbang tidak berubah, dan diasersi lebih dulu supaya ia tetap
  // dijaga walau asersi status di bawahnya gagal.
  assert.equal(
    h.layakReferensi,
    false,
    "RAGU = TIDAK LOLOS masih berlaku: pemeriksaan yang gagal tidak boleh menghasilkan referensi"
  );

  assert.notEqual(
    h.jenis,
    "promotional_graphic",
    'Pemeriksaan yang GAGAL dicatat sebagai vonis "promotional_graphic". Vonis itu tidak bisa ' +
      "dibedakan dari banner sungguhan oleh pembaca mana pun, dan ia PERMANEN: di runtime tanpa " +
      "ffmpeg/tesseract (service web Render, runtime: node) setiap foto produk yang sah akan " +
      "dicap promosi selamanya. Bukti yang berbohong lebih buruk daripada bukti yang kosong, " +
      "karena yang kosong masih bisa direvalidasi."
  );
  assert.equal(
    h.jenis,
    STATUS_BELUM_DIPERIKSA,
    `Status non-vonis yang eksplisit belum ada. Kontraknya: "${STATUS_BELUM_DIPERIKSA}" — ` +
      "keadaan ketiga yang menyatakan apa yang benar-benar terjadi (belum bisa diperiksa), " +
      "supaya boundary yang punya binernya bisa merevalidasinya. Reason code untuk penolakannya " +
      "adalah CLASSIFIER_FAILED (PATH-CASE-MATRIX C7)."
  );
  assert.ok(
    h.alasan.length > 10,
    "penolakan tanpa alasan yang bisa dibaca pengguna"
  );
});

test("KONTROL: banner yang BENAR-BENAR diperiksa tetap promotional_graphic", async (t) => {
  // Pasangan test di atas. Tanpa ini, "belum_diperiksa" bisa dipakai untuk
  // segalanya dan vonis promosi yang sah ikut hilang.
  if (!punyaOcr()) return t.skip("tesseract/ffmpeg tidak ada");
  const banner = path.join(R, "02-banner-promo-JANGAN-DIPAKAI.jpeg");
  if (!fs.existsSync(banner)) return t.skip("fixture tidak ada");
  const h = await klasifikasiGambar(banner);
  assert.equal(
    h.jenis,
    "promotional_graphic",
    "banner yang berhasil diperiksa wajib tetap divonis promosi — status belum_diperiksa tidak " +
      "boleh menelan vonis yang sah"
  );
  assert.equal(h.layakReferensi, false);
});

// KARANTINA MENGGANTIKAN BACKFILL MALAS (P0-03, 21 Agu).
//
// Test ini DULU menuntut kebalikannya: gambar warisan tanpa sidecar wajib
// diklasifikasi SAAT hendak dipakai jadi referensi, lalu sidecarnya ditulis
// dari dalam jalur baca. Itu kebijakan yang salah, dan kontrak bukti P0-03
// sekarang melarangnya:
//
//   - bukti yang dicetak DI TENGAH JALUR RENDER tidak pernah dilihat siapa
//     pun. Tidak ada rantai kustodi: ia menempel pada bytes apa pun yang
//     kebetulan ada di storage detik itu;
//   - di deployment produksi, jalur baca itu bisa berjalan di runtime yang
//     TIDAK punya ffmpeg/tesseract. Klasifikasi gagal, `klasifikasiGambar`
//     memvonis "promosi" (RAGU = PROMOSI), dan vonis palsu itu DIBEKUKAN jadi
//     sidecar permanen — foto produk yang sah dicap promosi selamanya oleh
//     mesin yang kebetulan tidak punya OCR;
//   - dan menulis dari jalur baca membuat operasi baca tidak lagi idempoten.
//
// Kebijakan sekarang: gambar tanpa bukti sah DIKARANTINA. Ia tidak layak jadi
// referensi, dan jalur baca TIDAK menulis apa pun. Bukti hanya boleh dicetak
// di jalur ingestion/revalidasi yang terbukti punya binernya — lihat
// docs/evidence/P0-03/R1-RED.md.
//
// Sengaja TANPA fixture dan TANPA biner: bytes sintetis sudah cukup, karena
// yang diuji adalah "tidak ada tulisan dan tidak ada kelulusan", bukan vonis
// classifier. Jadi test ini deterministik di mesin mana pun — termasuk mesin
// yang tidak punya OCR, yang justru mesin paling penting untuk kasus ini.
test("KARANTINA: gambar warisan tanpa sidecar tidak layak, dan jalur baca TIDAK menulis bukti", async () => {
  const { setMediaStorageForTests } = await import("../lib/storage");
  const { referensiLayak, bacaMetaGambar, relMeta } = await import("../lib/product-images");

  const rel = "uploads/lama/0.jpeg";
  const isi = new Map<string, Buffer>([[rel, Buffer.from("BYTES-WARISAN-TANPA-BUKTI")]]);
  const tulisan: string[] = [];
  setMediaStorageForTests({
    get: async (r: string) => (isi.has(r) ? { body: isi.get(r)!, size: isi.get(r)!.length } : null),
    stat: async (r: string) => (isi.has(r) ? { size: isi.get(r)!.length } : null),
    put: async (r: string, body: Buffer) => { tulisan.push(r); isi.set(r, body); },
    delete: async (r: string) => { isi.delete(r); },
    materialize: async () => { throw new Error("materialize() tidak boleh dipanggil jalur kelayakan"); },
  } as never);

  try {
    assert.equal(await bacaMetaGambar(rel), null, "harusnya belum ada sidecar");

    const layak = await referensiLayak([rel]);
    assert.deepEqual(layak, [], "gambar warisan tanpa bukti tetap lolos jadi referensi — karantina tidak bekerja");

    assert.deepEqual(
      tulisan,
      [],
      `jalur baca MENULIS bukti baru: ${JSON.stringify(tulisan)}. Bukti yang dicetak sendiri oleh ` +
        "pemakainya tidak punya rantai kustodi, dan di runtime tanpa OCR ia membekukan vonis palsu."
    );
    assert.equal(
      await bacaMetaGambar(rel),
      null,
      `sidecar ${relMeta(rel)} muncul sesudah pembacaan — karantina berubah jadi backfill diam-diam`
    );
  } finally {
    setMediaStorageForTests(undefined);
  }
});
