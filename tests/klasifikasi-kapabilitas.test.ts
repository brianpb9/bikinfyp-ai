// P0-B2 — PROBE KAPABILITAS: apakah runtime INI benar-benar bisa mengklasifikasi.
//
// KENAPA PROBE, BUKAN ASUMSI. Seluruh jalur unggah berjalan di service web
// (lima route, lihat B1-B2-MATRIKS-INGESTION.md), sementara ffmpeg/ffprobe/
// tesseract awalnya hanya dijamin oleh `Dockerfile.worker`. Staging kini punya
// candidate `Dockerfile.web`, sementara production tetap `runtime: node`.
// Konfigurasi/image candidate bukan bukti deployment — dan Mac pengembang punya
// ketiganya, jadi hijau lokal tetap tidak membuktikan runtime managed.
//
// Probe inilah bukti deployment yang diminta: ia dievaluasi DI LINGKUNGAN
// SUNGGUHAN, bukan disimpulkan dari Dockerfile atau dari mesin pengembang.
//
// TIGA HAL YANG DIKUNCI DI SINI, dan ketiganya pernah jadi cacat nyata di
// gelombang ini:
//
//   1. Probe WAJIB MENJALANKAN binernya, bukan sekadar mencari namanya di PATH.
//      Biner yang ada tapi tidak bisa dieksekusi (arsitektur salah, pustaka
//      hilang, exit non-nol) tetap berarti runtime ini tidak mampu.
//   2. Probe WAJIB memeriksa DATA BAHASA OCR. `tesseract` yang terpasang tanpa
//      `eng` akan gagal di setiap gambar, dan kegagalannya baru terlihat
//      saat pengguna sudah mengunggah.
//   3. Probe TIDAK BOLEH menjalankan biner di setiap panggilan. `/api/health`
//      dipanggil terus-menerus oleh platform; empat spawn per permintaan adalah
//      beban yang tidak perlu, dan hasilnya tidak bisa berubah tanpa redeploy.
//
// PATH disuntik lewat opsi, bukan dengan memutasi `process.env` milik proses
// test. Mutasi global adalah cara test saling mencemari, dan itu sudah jadi
// temuan sekali di gelombang ini.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.RACUN_NO_DOTENV = "1";

const { periksaKapabilitasKlasifikasi } = await import("../lib/media/kapabilitas-klasifikasi");

const BIN = ["ffmpeg", "ffprobe", "tesseract"] as const;

/**
 * Skrip palsu yang menandai dirinya terpanggil, lalu berperilaku sesuai mode.
 *
 * Markernya MENAMBAH SATU BARIS, bukan sekadar menyentuh berkas. Versi pertama
 * memakai `: >> berkas`, yang membuat berkasnya ada tapi selalu KOSONG — jadi
 * penghitung invocation selalu menjawab 1, dan test cache "lulus" tanpa pernah
 * benar-benar menghitung apa pun. Itu kelas cacat yang sama yang diburu
 * sepanjang gelombang ini: hijau karena alasan yang salah.
 */
function tulisPalsu(dir: string, mark: string, nama: string, isi: string): void {
  fs.writeFileSync(path.join(dir, nama), `#!/bin/sh\necho dipanggil >> "${mark}/${nama}"\n${isi}`, { mode: 0o755 });
}

// SEJAK PROBE MENJALANKAN SMOKE PIPELINE SUNGGUHAN, biner palsu harus
// BERPERILAKU, bukan cuma menjawab `-version`. Temuan Reviewer: stub yang tidak
// pernah membuat gambar atau mengeluarkan dimensi/TSV tetap dinyatakan "mampu"
// — persis kelemahan yang smoke pipeline ada untuk menutupnya.
const GAGAL = "exit 1\n";

/** ffmpeg palsu: menjawab -version, DAN benar-benar menghasilkan PNG keluaran. */
const FFMPEG_OK = (asli: string) =>
  `case "$1" in\n  -version) echo "ffmpeg palsu"; exit 0 ;;\nesac\n` +
  'for a in "$@"; do keluar="$a"; done\n' +
  `/bin/cp "${asli}" "$keluar" || exit 65\n` +
  'if [ ! -s "$keluar" ]; then exit 66; fi\nexit 0\n';

/** ffmpeg palsu yang LULUS -version tapi GAGAL saat benar-benar men-decode. */
const FFMPEG_VERSI_SAJA =
  `case "$1" in\n  -version) echo "ffmpeg palsu"; exit 0 ;;\nesac\nexit 1\n`;

/**
 * ffprobe palsu: menjawab -version, DAN mengeluarkan dimensi sungguhan.
 * 1440x180 = dimensi fixture smoke sesudah diskalakan; kalau ia berbohong
 * (mis. mengembalikan kosong), classifier jatuh ke cadangan 1440x1440 dan
 * rasio area teks anjlok ~8x — itu yang diuji kontrol negatif di bawah.
 */
const FFPROBE_OK =
  `case "$1" in\n  -version) echo "ffprobe palsu"; exit 0 ;;\nesac\n` +
  'for a in "$@"; do masuk="$a"; done\n' +
  'if [ ! -s "$masuk" ]; then exit 66; fi\necho 1440,180\nexit 0\n';

/** Lulus -version dan exit 0, tapi outputnya KOSONG — classifier pakai cadangan. */
const FFPROBE_KOSONG =
  `case "$1" in\n  -version) echo "ffprobe palsu"; exit 0 ;;\nesac\nexit 0\n`;

const FFPROBE_VERSI_SAJA =
  `case "$1" in\n  -version) echo "ffprobe palsu"; exit 0 ;;\nesac\nexit 1\n`;

/**
 * tesseract palsu: menjawab --version, mendaftar bahasa, DAN mengeluarkan TSV.
 * Header saja (nol baris kata) => rasio 0 => vonis product_photo.
 */
const TESSERACT_OK = (daftar: string) =>
  `case "$1" in\n` +
  `  --version) echo "tesseract palsu"; exit 0 ;;\n` +
  `  --list-langs) printf 'List of available languages:\\n${daftar}\\n'; exit 0 ;;\n` +
  `esac\n` +
  // BERPERILAKU SEPERTI TESSERACT SUNGGUHAN saat bahasa yang diminta tidak
  // terpasang: gagal, bukan diam-diam mengabaikan `-l`. Versi pertama fake ini
  // selalu mengeluarkan TSV apa pun bahasanya, jadi smoke pipeline "berhasil"
  // pada runtime yang sebenarnya tidak punya `eng` — kelemahan yang sama
  // persis dengan berhenti di `-version`.
  'lang=""\nprev=""\nfor a in "$@"; do\n  if [ "$prev" = "-l" ]; then lang="$a"; fi\n  prev="$a"\ndone\n' +
  `if [ -n "$lang" ]; then\n  case " ${daftar.split("\n").join(" ")} " in\n    *" $lang "*) ;;\n` +
  '    *) echo "Error opening data file for language $lang" >&2; exit 1 ;;\n  esac\nfi\n' +
  'if [ ! -s "$1" ]; then exit 66; fi\n' +
  // TSV dengan SATU kata meyakinkan berukuran besar. Header saja (nol kata)
  // membuat smoke gagal — dan itu memang yang diinginkan: tesseract yang
  // berjalan tapi tidak membaca apa-apa bukan tesseract yang berguna.
  "printf 'level\\tpage\\tblock\\tpar\\tline\\tword\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'\n" +
  "printf '5\\t1\\t1\\t1\\t1\\t1\\t40\\t30\\t560\\t120\\t92\\tPROMO\\n'\nexit 0\n";

/** Lulus semuanya tapi TSV-nya KOSONG (header saja) — exit 0, nol kata. */
const TESSERACT_TSV_KOSONG = (daftar: string) =>
  `case "$1" in\n` +
  `  --version) echo "tesseract palsu"; exit 0 ;;\n` +
  `  --list-langs) printf 'List of available languages:\\n${daftar}\\n'; exit 0 ;;\n` +
  `esac\n` +
  "printf 'level\\tpage\\tblock\\tpar\\tline\\tword\\tleft\\ttop\\twidth\\theight\\tconf\\ttext\\n'\nexit 0\n";

/** Lulus --version dan --list-langs, tapi GAGAL menghasilkan TSV. */
const TESSERACT_VERSI_SAJA = (daftar: string) =>
  `case "$1" in\n` +
  `  --version) echo "tesseract palsu"; exit 0 ;;\n` +
  `  --list-langs) printf 'List of available languages:\\n${daftar}\\n'; exit 0 ;;\n` +
  `esac\nexit 1\n`;

interface Siap {
  dir: string;
  bin: string;
  mark: string;
}

async function siapkan(
  buatIsi: (asli: string) => Partial<Record<(typeof BIN)[number], string>>
): Promise<Siap> {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kap-"));
  const bin = path.join(dir, "bin");
  const mark = path.join(dir, "mark");
  fs.mkdirSync(bin);
  fs.mkdirSync(mark);
  // PNG sungguhan yang disalin ffmpeg palsu ke path keluarannya — tanpa ini,
  // tahap ffprobe/tesseract tidak punya artefak untuk diperiksa.
  const sharp = (await import("sharp")).default;
  const asli = path.join(dir, "asli.png");
  await sharp({ create: { width: 1440, height: 810, channels: 3, background: { r: 205, g: 205, b: 205 } } })
    .png()
    .toFile(asli);
  for (const [nama, isi] of Object.entries(buatIsi(asli))) tulisPalsu(bin, mark, nama, isi!);
  return { dir, bin, mark };
}

/** Berapa kali biner palsu itu benar-benar dijalankan. */
const jumlahTanda = (mark: string, nama: string) => {
  const f = path.join(mark, nama);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0;
};

const LENGKAP = (asli: string) => ({
  ffmpeg: FFMPEG_OK(asli),
  ffprobe: FFPROBE_OK,
  tesseract: TESSERACT_OK("eng\nosd"),
});

test("MAMPU: ketiga biner jalan dan tesseract punya data bahasa eng", async () => {
  const { dir, bin } = await siapkan(LENGKAP);
  try {
    const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    assert.equal(k.mampu, true, `runtime dengan ketiga biner lengkap dilaporkan tidak mampu: ${k.alasan}`);
    assert.deepEqual(k.biner, { ffmpeg: true, ffprobe: true, tesseract: true });
    assert.equal(k.bahasaOcr, true);
    assert.equal(k.smoke, true, "smoke pipeline tidak berhasil padahal seluruh biner berperilaku benar");
    assert.ok(k.diperiksaPada.length > 0, "kapan diperiksa wajib tercatat — probe tanpa waktu tidak bisa diaudit");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TIDAK MAMPU: PATH kosong — dan alasannya menyebut biner mana yang hilang", async () => {
  const { dir, bin } = await siapkan(() => ({}));
  try {
    const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    assert.equal(k.mampu, false);
    assert.deepEqual(k.biner, { ffmpeg: false, ffprobe: false, tesseract: false });
    for (const nama of BIN) {
      assert.ok(
        k.alasan.includes(nama),
        `alasan tidak menyebut ${nama}: "${k.alasan}". Operator yang membaca /api/health harus tahu ` +
          "biner mana yang hilang, bukan cuma bahwa sesuatu hilang."
      );
    }
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TIDAK MAMPU: biner ADA tapi tidak bisa dijalankan (exit non-nol)", async () => {
  // Probe yang cuma mencari nama di PATH akan bilang "mampu" di sini. Biner
  // yang ada tapi mati saat dieksekusi — arsitektur salah, pustaka hilang —
  // adalah keadaan nyata di image container yang salah rakit.
  const { dir, bin } = await siapkan((asli) => ({ ...LENGKAP(asli), ffprobe: GAGAL }));
  try {
    const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    assert.equal(k.mampu, false, "biner yang exit non-nol dilaporkan mampu — probe tidak benar-benar menjalankannya");
    assert.equal(k.biner.ffprobe, false);
    assert.equal(k.biner.ffmpeg, true, "biner lain yang sehat tidak boleh ikut dinyatakan mati");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TIDAK MAMPU: tesseract ada tapi TANPA data bahasa eng", async () => {
  // Ini yang paling mudah lolos dari pemeriksaan "apakah binernya ada":
  // tesseract terpasang, versinya jalan, tapi setiap gambar gagal karena
  // traineddata-nya tidak ada. Kegagalannya baru terlihat sesudah pengguna
  // mengunggah.
  const { dir, bin } = await siapkan((asli) => ({ ...LENGKAP(asli), tesseract: TESSERACT_OK("osd\nind") }));
  try {
    const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    assert.equal(k.biner.tesseract, true, "binernya sendiri jalan — yang hilang datanya");
    assert.equal(k.bahasaOcr, false);
    assert.equal(
      k.smoke,
      false,
      "smoke pipeline berhasil padahal tesseract tidak punya data bahasa yang diminta classifier — " +
        "fake-nya mengabaikan `-l`, dan kalau begitu ia tidak menguji apa pun"
    );
    assert.equal(k.mampu, false, "tesseract tanpa data bahasa eng tetap berarti runtime ini tidak mampu");
    assert.ok(k.alasan.toLowerCase().includes("eng"), `alasan tidak menyebut data bahasa: "${k.alasan}"`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CACHE: hasil dipakai ulang — /api/health tidak menelurkan proses tiap permintaan", async () => {
  const { dir, bin, mark } = await siapkan(LENGKAP);
  try {
    await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    const setelahSekali = BIN.map((n) => jumlahTanda(mark, n));
    assert.ok(
      setelahSekali.every((n) => n >= 1),
      `probe pertama tidak menjalankan binernya sama sekali (${JSON.stringify(setelahSekali)}) — ` +
        "penghitungnya yang rusak, dan test cache di bawah tidak akan menghitung apa pun"
    );
    await periksaKapabilitasKlasifikasi({ pathOverride: bin });
    await periksaKapabilitasKlasifikasi({ pathOverride: bin });
    assert.deepEqual(
      BIN.map((n) => jumlahTanda(mark, n)),
      setelahSekali,
      "biner dijalankan lagi pada panggilan kedua/ketiga. /api/health dipanggil terus-menerus oleh " +
        "platform; hasil probe tidak bisa berubah tanpa redeploy, jadi menjalankannya berulang " +
        "adalah beban tanpa informasi baru."
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CACHE: `segarkan` memaksa probe ulang — cache tidak boleh jadi penjara", async () => {
  const { dir, bin, mark } = await siapkan(LENGKAP);
  try {
    await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    const sekali = jumlahTanda(mark, "ffmpeg");
    await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    assert.ok(
      jumlahTanda(mark, "ffmpeg") > sekali,
      "`segarkan: true` tidak menjalankan probe ulang — hasil yang salah tidak akan pernah bisa dikoreksi"
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * KONTROL NEGATIF — lulus `-version`, gagal saat bekerja.
 *
 * Temuan Reviewer 21 Agu: probe yang berhenti di `-version` menyatakan runtime
 * MAMPU untuk biner yang sebenarnya lumpuh. ffmpeg bisa menjawab versinya lalu
 * gagal men-decode; tesseract bisa menjawab versinya DAN menyebut `eng` di
 * `--list-langs` lalu gagal menghasilkan TSV. Ketiganya diuji satu per satu,
 * karena kegagalan di tahap mana pun berarti runtime ini tidak bisa dipakai.
 */
const versiSaja: [string, (asli: string) => Partial<Record<(typeof BIN)[number], string>>, BinerYangSehat][] = [
  ["ffmpeg lulus -version tapi gagal men-decode", (a) => ({ ...LENGKAP(a), ffmpeg: FFMPEG_VERSI_SAJA }), "ffmpeg"],
  ["ffprobe lulus -version tapi gagal memeriksa dimensi", (a) => ({ ...LENGKAP(a), ffprobe: FFPROBE_VERSI_SAJA }), "ffprobe"],
  [
    "tesseract lulus --version + --list-langs tapi gagal menghasilkan TSV",
    (a) => ({ ...LENGKAP(a), tesseract: TESSERACT_VERSI_SAJA("eng\nosd") }),
    "tesseract",
  ],
  // EXIT 0 TAPI OUTPUT KOSONG — kelas yang paling sulit: tidak ada yang gagal,
  // semuanya "sukses", dan hasilnya tetap tidak berguna. Temuan Reviewer.
  [
    "tesseract exit 0 tapi TSV kosong (nol kata terbaca)",
    (a) => ({ ...LENGKAP(a), tesseract: TESSERACT_TSV_KOSONG("eng\nosd") }),
    "tesseract",
  ],
  [
    "ffprobe exit 0 tapi output KOSONG (classifier jatuh ke dimensi cadangan)",
    (a) => ({ ...LENGKAP(a), ffprobe: FFPROBE_KOSONG }),
    "ffprobe",
  ],
];
type BinerYangSehat = (typeof BIN)[number];

for (const [judul, buat, biner] of versiSaja) {
  test(`TIDAK MAMPU: ${judul}`, async () => {
    const { dir, bin } = await siapkan(buat);
    try {
      const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
      assert.equal(
        k.biner[biner],
        true,
        `prasyarat: ${biner} memang lulus -version — kalau tidak, test ini menguji hal yang lain`
      );
      assert.equal(
        k.smoke,
        false,
        `${judul}: smoke pipeline dinyatakan berhasil padahal binernya gagal saat benar-benar bekerja`
      );
      assert.equal(
        k.mampu,
        false,
        `${judul}: runtime dinyatakan MAMPU hanya karena -version lulus. Laporan itu yang dipakai ` +
          "orang untuk memutuskan apakah bukti produksi bisa dipercaya."
      );
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
}

/**
 * BATAS WAKTU — biner yang menggantung DI TAHAP KERJA tidak boleh menahan health.
 *
 * Temuan Reviewer 21 Agu: `BATAS_MS` hanya membatasi probe `-version`. Smoke
 * memanggil `klasifikasiGambar`, yang di produksi menunggu 20 detik untuk
 * ffmpeg, lalu 20 untuk ffprobe, lalu 20 untuk tesseract — dan `/api/health`
 * MENUNGGU promise itu. Runtime dengan biner yang menggantung bisa menahan
 * health check sekitar satu menit, dan platform akan menganggap service-nya
 * mati padahal ia hanya sedang ditanyai.
 *
 * Biner di bawah menjawab `-version` seketika (jadi probe versi lolos) lalu
 * MENGGANTUNG saat benar-benar dipakai — persis kelas yang tidak tertangkap
 * pemeriksaan versi.
 */
// Durasi 97 detik SENGAJA ganjil: tests/klasifikasi-gambar.test.ts juga
// menelurkan `/bin/sleep 90`, dan node --test menjalankan berkas test secara
// PARALEL. Pemindaian `ps` di bawah karena itu pernah melihat proses milik
// berkas LAIN dan merah karenanya — kegagalan yang tidak ada hubungannya
// dengan apa yang diuji di sini. Durasi unik adalah pembeda termurah yang
// tersedia, karena `exec` menghapus jejak direktori dari command line.
const FFMPEG_KERJA_MENGGANTUNG =
  `case "$1" in\n  -version) echo "ffmpeg palsu"; exit 0 ;;\nesac\nexec /bin/sleep 97\n`;

test("BATAS: biner yang menggantung di tahap kerja tidak menahan probe lama-lama", async () => {
  const { dir, bin } = await siapkan((asli) => ({ ...LENGKAP(asli), ffmpeg: FFMPEG_KERJA_MENGGANTUNG }));
  try {
    const mulai = Date.now();
    const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    const durasi = Date.now() - mulai;
    assert.equal(k.mampu, false, "biner yang menggantung dilaporkan mampu");
    assert.ok(
      durasi < 15_000,
      `probe memakan ${durasi}ms. /api/health MENUNGGU promise ini; dengan tiga tahap × 20 detik ` +
        "produksi, health check bisa tertahan satu menit dan platform menganggap service-nya mati."
    );
    // Dan prosesnya benar-benar BERHENTI, bukan sekadar tidak ditunggu.
    //
    // Ditunggu sebentar, bukan diperiksa seketika: SIGKILL sudah dikirim saat
    // `execFile` menyerah, tapi pembersihan prosesnya oleh OS tidak instan.
    // Versi pertama asersi ini memeriksa pada milidetik yang sama dan MERAH
    // karena balapan — padahal sesudah jalan selesai tidak ada satu pun sisa.
    // Yang dituntut kontraknya adalah "berhenti", bukan "berhenti seketika".
    const hitungSisa = () =>
      execFileSync("ps", ["-ax", "-o", "command="], { encoding: "utf8" })
        .split("\n")
        .filter((baris) => baris.includes("/bin/sleep 97")).length;
    let sisa = hitungSisa();
    for (let i = 0; i < 40 && sisa > 0; i++) {
      await new Promise((r) => setTimeout(r, 50));
      sisa = hitungSisa();
    }
    assert.equal(sisa, 0, "proses biner yang menggantung masih hidup dua detik sesudah probe selesai");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

/**
 * COLD START — beberapa permintaan serentak hanya boleh menelurkan SATU probe.
 *
 * Cache hasil saja baru terisi sesudah probe selesai, jadi permintaan
 * `/api/health` yang datang sebelum probe pertama rampung sama-sama cache miss
 * dan masing-masing menelurkan sampai empat proses. Pada biner yang menggantung
 * jendelanya sampai lima detik — persis saat platform paling sering menanyainya.
 */
test("COLD START: enam panggilan serentak hanya menjalankan probe SEKALI", async () => {
  const { dir, bin, mark } = await siapkan(LENGKAP);
  try {
    const hasil = await Promise.all(
      Array.from({ length: 6 }, () => periksaKapabilitasKlasifikasi({ pathOverride: bin }))
    );
    assert.ok(hasil.every((h) => h.mampu), "probe serentak menghasilkan jawaban yang tidak konsisten");
    // ffmpeg dipanggil dua kali per probe (-version, lalu smoke), jadi yang
    // dituntut bukan "tepat satu" melainkan "tidak berlipat enam kali".
    const dipanggil = jumlahTanda(mark, "ffmpeg");
    assert.ok(
      dipanggil > 0 && dipanggil <= 2,
      `ffmpeg dijalankan ${dipanggil} kali untuk enam panggilan serentak. Probe yang sedang ` +
        "berjalan tidak digabungkan, jadi setiap permintaan cold-start menelurkan proses sendiri."
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("/api/health melaporkan kapabilitas klasifikasi", async () => {
  // Probe yang tidak diekspos bukan bukti deployment: ia cuma kode yang
  // kebetulan benar. Operator harus bisa MEMBACANYA dari luar.
  const { GET } = await import("../app/api/health/route");
  const res = await GET();
  const body = (await res.json()) as { klasifikasi?: Record<string, unknown> };
  assert.ok(
    body.klasifikasi,
    "/api/health tidak melaporkan kapabilitas klasifikasi sama sekali. Tanpa itu, tidak ada cara " +
      "membuktikan runtime produksi bisa menerbitkan bukti — dan klaim product-truth hijau jadi " +
      "klaim dari mesin pengembang."
  );
  for (const kunci of ["mampu", "biner", "bahasaOcr", "diperiksaPada"]) {
    assert.ok(kunci in body.klasifikasi!, `/api/health.klasifikasi tidak punya field ${kunci}`);
  }
  assert.equal(typeof body.klasifikasi!.mampu, "boolean");
});
