// P0-B2 — PROBE KAPABILITAS: apakah runtime INI benar-benar bisa mengklasifikasi.
//
// KENAPA PROBE, BUKAN ASUMSI. Seluruh jalur unggah berjalan di service web
// (lima route, lihat B1-B2-MATRIKS-INGESTION.md), sementara ffmpeg/ffprobe/
// tesseract hanya dijamin oleh `Dockerfile.worker`. `render.yaml` dan
// `render.production.yaml` keduanya memakai `runtime: node` untuk service web.
// Tidak ada satu pun bukti, ke arah mana pun, tentang apakah runtime itu punya
// ketiga biner — dan Mac pengembang punya ketiganya, jadi hijau lokal tidak
// membuktikan apa-apa.
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

const SUKSES_VERSI = 'echo "versi palsu"\nexit 0\n';
const GAGAL = "exit 1\n";
/** tesseract --list-langs: yang penting `eng` ADA di daftarnya. */
const LANGS = (daftar: string) =>
  `case "$1" in\n  --list-langs) printf 'List of available languages:\\n${daftar}\\n'; exit 0 ;;\nesac\necho "versi palsu"\nexit 0\n`;

interface Siap {
  dir: string;
  bin: string;
  mark: string;
}

function siapkan(isiBin: Partial<Record<(typeof BIN)[number], string>>): Siap {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "kap-"));
  const bin = path.join(dir, "bin");
  const mark = path.join(dir, "mark");
  fs.mkdirSync(bin);
  fs.mkdirSync(mark);
  for (const [nama, isi] of Object.entries(isiBin)) tulisPalsu(bin, mark, nama, isi!);
  return { dir, bin, mark };
}

/** Berapa kali biner palsu itu benar-benar dijalankan. */
const jumlahTanda = (mark: string, nama: string) => {
  const f = path.join(mark, nama);
  return fs.existsSync(f) ? fs.readFileSync(f, "utf8").split("\n").filter(Boolean).length : 0;
};

const LENGKAP = {
  ffmpeg: SUKSES_VERSI,
  ffprobe: SUKSES_VERSI,
  tesseract: LANGS("eng\nosd"),
};

test("MAMPU: ketiga biner jalan dan tesseract punya data bahasa eng", async () => {
  const { dir, bin } = siapkan(LENGKAP);
  try {
    const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    assert.equal(k.mampu, true, `runtime dengan ketiga biner lengkap dilaporkan tidak mampu: ${k.alasan}`);
    assert.deepEqual(k.biner, { ffmpeg: true, ffprobe: true, tesseract: true });
    assert.equal(k.bahasaOcr, true);
    assert.ok(k.diperiksaPada.length > 0, "kapan diperiksa wajib tercatat — probe tanpa waktu tidak bisa diaudit");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("TIDAK MAMPU: PATH kosong — dan alasannya menyebut biner mana yang hilang", async () => {
  const { dir, bin } = siapkan({});
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
  const { dir, bin } = siapkan({ ...LENGKAP, ffprobe: GAGAL });
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
  const { dir, bin } = siapkan({ ...LENGKAP, tesseract: LANGS("osd\nind") });
  try {
    const k = await periksaKapabilitasKlasifikasi({ pathOverride: bin, segarkan: true });
    assert.equal(k.biner.tesseract, true, "binernya sendiri jalan — yang hilang datanya");
    assert.equal(k.bahasaOcr, false);
    assert.equal(k.mampu, false, "tesseract tanpa data bahasa eng tetap berarti runtime ini tidak mampu");
    assert.ok(k.alasan.toLowerCase().includes("eng"), `alasan tidak menyebut data bahasa: "${k.alasan}"`);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("CACHE: hasil dipakai ulang — /api/health tidak menelurkan proses tiap permintaan", async () => {
  const { dir, bin, mark } = siapkan(LENGKAP);
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
  const { dir, bin, mark } = siapkan(LENGKAP);
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
