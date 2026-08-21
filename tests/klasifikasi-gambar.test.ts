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

/**
 * PIPELINE BERTAHAP, DIJALANKAN DI PROSES ANAK YANG BISA DIBUNUH.
 *
 * Tiga temuan Reviewer bertumpuk di sini, dan urutannya menjelaskan bentuk
 * akhirnya:
 *
 *   1. (ronde 6) mode kegagalan hanya diuji lewat "berkas tidak ada" — bukan
 *      kegagalan BINER, yang justru cacat P0-B2.
 *   2. (ronde 7) fixture "menggantung" tidak pernah menggantung: skripnya
 *      memanggil `sleep` tanpa path absolut sementara PATH sudah dikosongkan,
 *      jadi ia keluar 127 dalam 0,01 detik. Dan seluruh mode berhenti di
 *      ffmpeg — ffprobe dan tesseract tidak pernah tercapai.
 *   3. (ronde 8) tenggat berbasis `Promise.race` hanya mengakhiri PENANTIAN
 *      test. Ia tidak membatalkan `klasifikasiGambar` dan tidak membunuh biner
 *      yang menggantung. Sesudah asersi tenggat, promise yang tertinggal
 *      melanjutkan pipeline memakai PATH yang sudah dipulihkan dan fixture yang
 *      sudah dihapus — mencemari test lain — sementara child-nya menahan proses
 *      Node sampai selesai. "Nol sleep sesudah suite" karena itu tidak
 *      membuktikan pembersihan; ia cuma membuktikan suite-nya menunggu.
 *
 * Bentuk akhirnya menutup ketiganya sekaligus:
 *
 *   - klasifikasi dijalankan di PROSES ANAK `detached` (punya process group
 *     sendiri). Saat tenggat tercapai, seluruh GRUP dibunuh — pembungkusnya,
 *     biner palsunya, dan `sleep`-nya. Sesudah itu diasersi bahwa tidak ada
 *     satu pun proses tersisa di grup itu;
 *   - PATH palsu hanya hidup di lingkungan anak. Test induk tidak pernah
 *     memutasi `process.env` miliknya sendiri, jadi tidak ada yang bisa bocor
 *     ke test lain walau anak dibunuh di tengah jalan;
 *   - biner sebelumnya dipalsukan SUKSES supaya eksekusi benar-benar sampai ke
 *     biner yang sedang diuji;
 *   - `exec /bin/sleep` (path absolut) dan asersi DURASI membuktikan jalur
 *     menggantung benar-benar dilewati, bukan diasumsikan.
 */
/**
 * BINER PALSU YANG BENAR-BENAR BERPERILAKU, dan MENINGGALKAN JEJAK.
 *
 * Temuan Reviewer ronde 9: `SUKSES_FFMPEG` versi sebelumnya hanya `exit 0` dan
 * tidak pernah membuat `besar.png`. Implementasi P0-B2 yang secara SAH memeriksa
 * keberadaan keluaran ffmpeg akan mengembalikan `belum_diperiksa` sebelum
 * memanggil ffprobe — jadi ketiga mode ffprobe bisa hijau tanpa pernah mencapai
 * ffprobe, dan mode tesseract-menggantung gagal di `minimalMs` karena alasan
 * FIXTURE, bukan karena produk. Fixture yang lulus tanpa menjalankan hal yang
 * diklaimnya adalah kelas cacat yang sama dengan yang sudah tiga kali ditemukan
 * di gelombang ini.
 *
 * Dua perbaikan, dan keduanya perlu:
 *
 *   1. ffmpeg palsu MENYALIN PNG SUNGGUHAN ke path keluaran (argumen terakhir),
 *      jadi tahap berikutnya punya artefak yang memadai untuk diperiksa;
 *   2. setiap biner palsu MENINGGALKAN MARKER. Setiap mode lalu menuntut marker
 *      tahap mana yang WAJIB ada dan mana yang WAJIB TIDAK ada — jadi "biner
 *      target benar-benar dipanggil" dibuktikan, bukan diasumsikan dari urutan
 *      pemanggilan di kode produksi.
 *
 * Ditambah satu KONTROL HARNESS (semua biner sukses) yang wajib menghasilkan
 * `product_photo` layak: tanpa itu, seluruh mode kegagalan bisa hijau hanya
 * karena pipeline palsunya memang tidak pernah bisa berhasil.
 */
interface KonteksBin {
  /** PNG sungguhan yang disalin ffmpeg palsu ke path keluarannya. */
  asli: string;
  /** Direktori marker per tahap. */
  mark: string;
}

type SkripPalsu = (ctx: KonteksBin) => string;

const tandai = (mark: string, nama: string) => `: >> "${mark}/${nama}"\n`;

const SUKSES_FFMPEG: SkripPalsu = ({ asli, mark }) =>
  "#!/bin/sh\n" +
  tandai(mark, "ffmpeg") +
  // Argumen TERAKHIR adalah path keluaran (lihat pemanggilan di
  // lib/media/klasifikasi-gambar.ts). Disalin dari PNG sungguhan supaya tahap
  // berikutnya punya artefak yang memadai.
  'for a in "$@"; do keluar="$a"; done\n' +
  `cp "${asli}" "$keluar"\n` +
  "exit 0\n";

const SUKSES_FFPROBE: SkripPalsu = ({ mark }) =>
  "#!/bin/sh\n" + tandai(mark, "ffprobe") + "echo 1440,810\n";

const SUKSES_TESSERACT: SkripPalsu = ({ mark }) =>
  "#!/bin/sh\n" +
  tandai(mark, "tesseract") +
  // Header TSV tanpa satu pun baris kata -> 0 kata, rasio 0 -> foto produk.
  "printf 'level\\tpage\\tblock\\tpar\\tline\\tword\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'\n";

const GAGAL = (nama: string): SkripPalsu => ({ mark }) =>
  "#!/bin/sh\n" + tandai(mark, nama) + "exit 1\n";

const MENGGANTUNG = (nama: string, detik: number): SkripPalsu => ({ mark }) =>
  // Marker ditulis SEBELUM menggantung, jadi "tahap ini tercapai" tetap
  // terbukti walau prosesnya nanti dibunuh.
  "#!/bin/sh\n" + tandai(mark, nama) + `exec /bin/sleep ${detik}\n`;

const TAHAP = ["ffmpeg", "ffprobe", "tesseract"] as const;

const ANAK = path.join(process.cwd(), "tests", "fixtures", "klasifikasi-anak.ts");

interface HasilAnak {
  jenis: string;
  layakReferensi: boolean;
  alasan: string;
}

/** Menjalankan klasifikasi di proses anak; membunuh SELURUH grup saat tenggat. */
async function klasifikasiTerkendali(
  foto: string,
  binDir: string,
  batasMs: number
): Promise<{ hasil: HasilAnak | null; durasiMs: number; pgid: number; lewatBatas: boolean }> {
  const { spawn } = await import("node:child_process");
  const anak = spawn(process.execPath, ["--import", "tsx", ANAK, foto], {
    // PATH palsu HANYA di sini; `as` diperlukan karena tipe ProcessEnv Node
    // menuntut NODE_ENV, sementara lingkungan minimal justru yang diinginkan.
    env: { PATH: binDir, HOME: process.env.HOME ?? "" } as unknown as NodeJS.ProcessEnv,
    detached: true, // process group sendiri -> bisa dibunuh berikut anak-anaknya
    stdio: ["ignore", "pipe", "pipe"] as const,
  });
  const pgid = anak.pid ?? -1;
  let keluaran = "";
  anak.stdout?.on("data", (b: Buffer) => (keluaran += b.toString()));
  anak.stderr?.on("data", () => {
    /* diabaikan: kegagalan biner memang berisik */
  });

  const mulai = Date.now();
  let lewatBatas = false;
  const tenggat = setTimeout(() => {
    lewatBatas = true;
    try {
      process.kill(-pgid, "SIGKILL"); // seluruh GRUP, bukan cuma pembungkusnya
    } catch {
      /* sudah mati */
    }
  }, batasMs);
  tenggat.unref();

  await new Promise<void>((selesai) => anak.on("close", () => selesai()));
  clearTimeout(tenggat);
  const durasiMs = Date.now() - mulai;

  let hasil: HasilAnak | null = null;
  try {
    hasil = keluaran ? (JSON.parse(keluaran) as HasilAnak) : null;
  } catch {
    hasil = null;
  }
  return { hasil, durasiMs, pgid, lewatBatas };
}

/** Berapa proses yang masih hidup di process group itu. */
function sisaDiGrup(pgid: number): number {
  if (pgid <= 1) return 0;
  const keluaran = execFileSync("ps", ["-o", "pgid=", "-ax"], { encoding: "utf8" });
  return keluaran.split("\n").filter((baris) => baris.trim() === String(pgid)).length;
}

interface ModeKegagalan {
  judul: string;
  /** Isi bin palsu; biner yang TIDAK disebut berarti hilang dari PATH. */
  bin: Partial<Record<(typeof TAHAP)[number], SkripPalsu>>;
  /** Tahap yang WAJIB benar-benar terpanggil. */
  tahapWajib: (typeof TAHAP)[number][];
  /** Tenggat yang dipaksakan test, dalam ms. */
  batasMs: number;
  /** Bila diisi: jalur timeout wajib benar-benar dilewati (durasi minimum). */
  minimalMs?: number;
  /** Bila true: produksi memang belum punya batas untuk biner ini. */
  tanpaTimeoutProduksi?: boolean;
}

const modeKegagalan: ModeKegagalan[] = [
  // --- ffmpeg: panggilan pertama ---
  { judul: "ffmpeg HILANG dari PATH", bin: {}, tahapWajib: [], batasMs: 20_000 },
  {
    judul: "ffmpeg GAGAL (exit bukan nol)",
    bin: { ffmpeg: GAGAL("ffmpeg") },
    tahapWajib: ["ffmpeg"],
    batasMs: 20_000,
  },
  {
    judul: "ffmpeg MENGGANTUNG (wajib berhenti di timeout 20 detik)",
    bin: { ffmpeg: MENGGANTUNG("ffmpeg", 90) },
    tahapWajib: ["ffmpeg"],
    batasMs: 35_000,
    minimalMs: 15_000,
  },

  // --- ffprobe: hanya tercapai kalau ffmpeg sukses DAN menghasilkan keluaran ---
  {
    judul: "ffprobe HILANG (ffmpeg sukses)",
    bin: { ffmpeg: SUKSES_FFMPEG },
    tahapWajib: ["ffmpeg"],
    batasMs: 20_000,
  },
  {
    judul: "ffprobe GAGAL (ffmpeg sukses)",
    bin: { ffmpeg: SUKSES_FFMPEG, ffprobe: GAGAL("ffprobe") },
    tahapWajib: ["ffmpeg", "ffprobe"],
    batasMs: 20_000,
  },
  {
    judul: "ffprobe MENGGANTUNG — produksi TIDAK punya timeout untuk ffprobe",
    bin: { ffmpeg: SUKSES_FFMPEG, ffprobe: MENGGANTUNG("ffprobe", 90) },
    tahapWajib: ["ffmpeg", "ffprobe"],
    batasMs: 25_000,
    tanpaTimeoutProduksi: true,
  },

  // --- tesseract: hanya tercapai kalau ffmpeg DAN ffprobe sukses ---
  {
    judul: "tesseract HILANG (ffmpeg + ffprobe sukses)",
    bin: { ffmpeg: SUKSES_FFMPEG, ffprobe: SUKSES_FFPROBE },
    tahapWajib: ["ffmpeg", "ffprobe"],
    batasMs: 20_000,
  },
  {
    judul: "tesseract GAGAL (ffmpeg + ffprobe sukses)",
    bin: { ffmpeg: SUKSES_FFMPEG, ffprobe: SUKSES_FFPROBE, tesseract: GAGAL("tesseract") },
    tahapWajib: ["ffmpeg", "ffprobe", "tesseract"],
    batasMs: 20_000,
  },
  {
    judul: "tesseract MENGGANTUNG (wajib berhenti di timeout 20 detik)",
    bin: { ffmpeg: SUKSES_FFMPEG, ffprobe: SUKSES_FFPROBE, tesseract: MENGGANTUNG("tesseract", 90) },
    tahapWajib: ["ffmpeg", "ffprobe", "tesseract"],
    batasMs: 35_000,
    minimalMs: 15_000,
  },
];

/** Menyiapkan direktori kerja + bin palsu + marker untuk satu mode. */
async function siapkanMode(bin: Partial<Record<string, SkripPalsu>>): Promise<{
  kerja: string;
  binDir: string;
  markDir: string;
  foto: string;
}> {
  const kerja = fs.mkdtempSync(path.join(os.tmpdir(), "klas-gagal-"));
  const binDir = path.join(kerja, "bin");
  const markDir = path.join(kerja, "mark");
  fs.mkdirSync(binDir);
  fs.mkdirSync(markDir);
  const foto = await gambarSahSementara(kerja);
  // PNG sungguhan yang disalin ffmpeg palsu ke path keluarannya.
  const sharp = (await import("sharp")).default;
  const asli = path.join(kerja, "asli.png");
  await sharp({ create: { width: 1440, height: 810, channels: 3, background: { r: 210, g: 210, b: 210 } } })
    .png()
    .toFile(asli);
  for (const [nama, skrip] of Object.entries(bin)) {
    if (skrip) binPalsu(binDir, nama, skrip({ asli, mark: markDir }));
  }
  return { kerja, binDir, markDir, foto };
}

const tahapTerpanggil = (markDir: string) => TAHAP.filter((t) => fs.existsSync(path.join(markDir, t)));

// KONTROL HARNESS. Tanpa ini, seluruh mode kegagalan di bawah bisa hijau hanya
// karena pipeline palsunya memang tidak pernah bisa berhasil — dan "gagal di
// tahap X" tidak bisa dibedakan dari "tidak pernah sampai ke tahap mana pun".
test("KONTROL HARNESS: pipeline palsu yang SEMUA suksesnya menghasilkan foto produk layak", async () => {
  const { kerja, binDir, markDir, foto } = await siapkanMode({
    ffmpeg: SUKSES_FFMPEG,
    ffprobe: SUKSES_FFPROBE,
    tesseract: SUKSES_TESSERACT,
  });
  try {
    const { hasil, pgid } = await klasifikasiTerkendali(foto, binDir, 20_000);
    assert.equal(sisaDiGrup(pgid), 0, "ada proses tersisa di grup kontrol");
    assert.deepEqual(
      tahapTerpanggil(markDir),
      ["ffmpeg", "ffprobe", "tesseract"],
      "pipeline palsu tidak melewati ketiga tahap — fixture-nya yang rusak, bukan produknya"
    );
    assert.equal(hasil?.jenis, "product_photo", "pipeline palsu yang sukses tidak menghasilkan foto produk");
    assert.equal(hasil?.layakReferensi, true);
  } finally {
    fs.rmSync(kerja, { recursive: true, force: true });
  }
});

for (const mode of modeKegagalan) {
  test(`gagal memeriksa — ${mode.judul} = BELUM DIPERIKSA, dan tetap tidak layak`, async (t) => {
    const { kerja, binDir, markDir, foto } = await siapkanMode(mode.bin);
    try {
      const { hasil, durasiMs, pgid, lewatBatas } = await klasifikasiTerkendali(foto, binDir, mode.batasMs);
      const tahap = tahapTerpanggil(markDir);
      t.diagnostic(`durasi ${durasiMs}ms, lewatBatas=${lewatBatas}, tahap=[${tahap.join(",")}]`);

      // Pembersihan diasersi LEBIH DULU: kalau grupnya masih hidup, sisa test
      // ini berjalan di atas mesin yang tercemar dan hasilnya tidak berarti.
      assert.equal(
        sisaDiGrup(pgid),
        0,
        `${mode.judul}: masih ada proses hidup di process group ${pgid} sesudah tenggat. ` +
          "Membunuh pembungkusnya saja tidak cukup — biner yang menggantung dan `sleep`-nya " +
          "adalah anak-anaknya, dan merekalah yang menahan mesin."
      );

      // Lalu: biner yang diuji BENAR-BENAR terpanggil. Tanpa ini, mode ffprobe
      // dan tesseract bisa hijau tanpa pernah mencapai binernya — misalnya
      // karena implementasi berhenti lebih awal saat keluaran ffmpeg tidak ada.
      assert.deepEqual(
        tahap,
        mode.tahapWajib,
        `${mode.judul}: tahap yang benar-benar terpanggil [${tahap.join(",")}] tidak sama dengan ` +
          `yang dituntut [${mode.tahapWajib.join(",")}]. Mode ini tidak menguji apa yang ` +
          "judulnya klaim — kegagalannya (atau kelulusannya) datang dari tahap yang lain."
      );

      if (lewatBatas) {
        assert.fail(
          `${mode.judul}: klasifikasi TIDAK KEMBALI dalam ${mode.batasMs}ms dan harus dibunuh. ` +
            (mode.tanpaTimeoutProduksi
              ? "Di klasifikasi-gambar.ts, ffmpeg dan tesseract dipanggil dengan timeout 20 detik; " +
                "ffprobe dipanggil TANPA opsi timeout sama sekali, jadi satu proses anak bisa " +
                "menahan jalur unggah tanpa batas."
              : "Satu proses anak menahan jalur unggah tanpa batas — di produksi itu berarti " +
                "permintaan unggah pengguna menggantung sampai platform memutusnya.")
        );
      }

      if (mode.minimalMs !== undefined) {
        assert.ok(
          durasiMs >= mode.minimalMs,
          `${mode.judul}: selesai dalam ${durasiMs}ms, di bawah minimum ${mode.minimalMs}ms — ` +
            "jalur TIMEOUT tidak pernah dilewati. Itu persis cacat fixture ronde 7: skrip " +
            "palsunya gagal seketika sehingga kasusnya cuma mengulang mode exit-nonzero."
        );
      }

      assert.ok(hasil, `${mode.judul}: proses anak tidak mengembalikan hasil apa pun`);
      assert.equal(
        hasil.layakReferensi,
        false,
        `${mode.judul}: RAGU = TIDAK LOLOS masih berlaku — pemeriksaan yang gagal tidak boleh ` +
          "menghasilkan referensi"
      );
      assert.notEqual(
        hasil.jenis,
        "promotional_graphic",
        `${mode.judul}: kegagalan biner dicatat sebagai VONIS "promotional_graphic" atas gambar ` +
          "yang SAH dan BENAR-BENAR ADA. Inilah cacat P0-B2: service web Render (runtime: node) " +
          "tidak dijamin punya ffmpeg/ffprobe/tesseract, jadi setiap foto produk yang sah akan " +
          "dicap promosi selamanya oleh sidecar yang tidak bisa dibedakan dari banner sungguhan."
      );
      assert.equal(
        hasil.jenis,
        STATUS_BELUM_DIPERIKSA,
        `${mode.judul}: status non-vonis eksplisit "${STATUS_BELUM_DIPERIKSA}" belum ada. ` +
          "Reason code penolakannya CLASSIFIER_FAILED (PATH-CASE-MATRIX C7)."
      );
      assert.ok(hasil.alasan.length > 10, `${mode.judul}: penolakan tanpa alasan yang bisa dibaca`);
    } finally {
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
