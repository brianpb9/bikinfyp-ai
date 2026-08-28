// PACKSHOT PENUTUP FOTO ASLI (keputusan Brian 20 Agu, jalan keluar A).
//
// Label merek dijamin bukan dengan meminta model video mengeja dengan benar —
// tiga putaran prompt dan empat render berbayar membuktikan ia selalu mengarang
// huruf — melainkan dengan tidak pernah mengirim shot itu ke model sama sekali.
//
// Yang diuji di sini adalah kontraknya, bukan keindahannya: segmen benar-benar
// ditambahkan, durasinya diperhitungkan QC-05 supaya video lengkap tidak
// dinilai kelebihan durasi, dan QC-10 tidak lagi berpura-pura membuktikan
// keterbacaan visual saat yang diperiksanya asal-usul berkas.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-packshot-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-packshot-storage-${process.pid}`;

const { appendPackshot, sidikFoto, PACKSHOT_EKOR_DTK } = await import("../lib/media/packshot-asli");
const { probeDurationSec, probeVideoSize } = await import("../lib/media/ffmpeg");

function punyaFfmpeg(): boolean {
  try {
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/** Video pendek + foto sintetis: yang diuji rantai ffmpeg-nya, bukan isi gambar. */
function siapkan(dir: string) {
  const video = path.join(dir, "utama.mp4");
  const foto = path.join(dir, "produk.jpg");
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=3",
    "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
    "-t", "3", "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest", video]);
  execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=800x800:rate=1:duration=1",
    "-frames:v", "1", foto]);
  return { video, foto };
}

test("segmen packshot ditambahkan di ujung, durasinya bertambah sebesar ekor", async (t) => {
  if (!punyaFfmpeg()) return t.skip("ffmpeg tidak ada di mesin ini");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packshot-uji-"));
  try {
    const { video, foto } = siapkan(dir);
    const sebelum = await probeDurationSec(video);
    const hasil = await appendPackshot({ videoPath: video, workDir: dir, fotoPath: foto });
    assert.equal(hasil.ditambahkan, true, "packshot tidak ditambahkan");
    assert.equal(hasil.ekorSec, PACKSHOT_EKOR_DTK);
    const sesudah = await probeDurationSec(hasil.path);
    assert.ok(
      Math.abs(sesudah - (sebelum + PACKSHOT_EKOR_DTK)) < 0.4,
      `durasi tidak bertambah sebesar ekor: ${sebelum} -> ${sesudah}`
    );
    // Dimensi harus ikut video utama — packshot berdimensi lain menghasilkan
    // berkas campuran yang tidak sah (pelajaran TVC 16:9).
    const dim = await probeVideoSize(hasil.path);
    assert.deepEqual(dim, await probeVideoSize(video));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("foto hilang TIDAK merusak video — penutup dilewati apa adanya", async (t) => {
  if (!punyaFfmpeg()) return t.skip("ffmpeg tidak ada di mesin ini");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packshot-uji2-"));
  try {
    const { video } = siapkan(dir);
    const hasil = await appendPackshot({ videoPath: video, workDir: dir, fotoPath: path.join(dir, "tidak-ada.jpg") });
    assert.equal(hasil.ditambahkan, false);
    assert.equal(hasil.path, video, "video utama harus dikembalikan utuh");
    assert.equal(hasil.ekorSec, 0, "ekor 0 supaya QC-05 tidak menunggu detik yang tidak pernah ditambahkan");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("sidik foto ikut, dan berubah kalau fotonya berbeda", async (t) => {
  if (!punyaFfmpeg()) return t.skip("ffmpeg tidak ada di mesin ini");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packshot-uji3-"));
  try {
    const { video, foto } = siapkan(dir);
    const hasil = await appendPackshot({ videoPath: video, workDir: dir, fotoPath: foto });
    assert.equal(hasil.sidik, sidikFoto(foto), "sidik tidak cocok dengan isi fotonya");
    const lain = path.join(dir, "lain.jpg");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "color=c=red:size=800x800:duration=1",
      "-frames:v", "1", lain]);
    assert.notEqual(sidikFoto(lain), hasil.sidik, "dua foto berbeda tidak boleh bersidik sama");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// PENANDA AIGC HARUS SELAMAT DARI PACKSHOT.
//
// Ditemukan dari QC-08 FAIL pada render video penuh pertama (20 Agu):
// watermark_param=true tapi metadata_tag=false. Concat me-reencode, dan
// re-encode tanpa -map_metadata membuang tag kustom. Syarat & Ketentuan
// menjanjikan setiap video membawa penanda AI di dalam berkasnya, jadi
// menghapusnya diam-diam membuat janji itu tidak benar.
test("tag racun_aigc ikut menyeberang ke video ber-packshot", async (t) => {
  if (!punyaFfmpeg()) return t.skip("ffmpeg tidak ada di mesin ini");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packshot-aigc-"));
  try {
    const { foto } = siapkan(dir);
    // Video utama yang MEMBAWA tag, seperti keluaran compositor.
    const bertag = path.join(dir, "bertag.mp4");
    execFileSync("ffmpeg", ["-y", "-v", "error", "-f", "lavfi", "-i", "testsrc=size=360x640:rate=24:duration=3",
      "-f", "lavfi", "-i", "anullsrc=channel_layout=stereo:sample_rate=44100", "-t", "3",
      "-pix_fmt", "yuv420p", "-c:a", "aac", "-shortest",
      "-movflags", "faststart+use_metadata_tags", "-metadata", "racun_aigc=true", bertag]);

    const hasil = await appendPackshot({ videoPath: bertag, workDir: dir, fotoPath: foto });
    assert.equal(hasil.ditambahkan, true);
    const tags = execFileSync("ffprobe", ["-v", "error", "-show_entries", "format_tags",
      "-of", "default=noprint_wrappers=1", hasil.path]).toString();
    assert.match(
      tags, /racun_aigc=true/,
      `penanda AIGC hilang sesudah packshot — janji Syarat & Ketentuan jadi tidak benar:\n${tags}`
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// KOMPOSISI: crop penuh-bleed punya batas.
//
// Bukti 20 Agu: foto JJ Glow (landscape 1280x558) dipotong penuh-bleed ke 9:16
// menyisakan pita tengah — nama produk terbaca tapi LOGO MEREK terpotong keluar
// frame, di shot yang seluruh alasan keberadaannya adalah menampilkan merek.
test("foto landscape lebar DIMUAT UTUH, bukan dipotong sampai merek hilang", async (t) => {
  if (!punyaFfmpeg()) return t.skip("ffmpeg tidak ada di mesin ini");
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "packshot-rasio-"));
  try {
    const { buildPackshotAsli } = await import("../lib/media/packshot-asli");
    // Landscape lebar dengan penanda MERAH di tepi kiri — berperan sebagai
    // logo merek yang hilang duluan begitu sisi frame dipotong.
    const lebar = path.join(dir, "lebar.png");
    execFileSync("ffmpeg", ["-y", "-v", "error",
      "-f", "lavfi", "-i", "color=c=red:size=200x400",
      "-f", "lavfi", "-i", "color=c=blue:size=1000x400",
      "-filter_complex", "[0:v][1:v]hstack=inputs=2", "-frames:v", "1", lebar]);
    const out = await buildPackshotAsli({
      fotoPath: lebar, durationSec: 0.5, width: 360, height: 640,
      outPath: path.join(dir, "keluar.mp4"),
    });

    // Baca piksel frame apa adanya (rgb24 mentah) dan cari merah pekat.
    const raw = execFileSync("ffmpeg", ["-v", "error", "-ss", "0.1", "-i", out,
      "-frames:v", "1", "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
      { maxBuffer: 64 * 1024 * 1024 });
    let merah = 0;
    for (let i = 0; i + 2 < raw.length; i += 3) {
      if (raw[i] > 140 && raw[i + 1] < 90 && raw[i + 2] < 90) merah++;
    }
    assert.ok(
      merah > 500,
      `penanda merah di tepi kiri foto hilang dari frame (${merah} piksel) — ` +
        "artinya foto landscape masih dipotong, dan logo merek ikut terpotong"
    );
    assert.deepEqual(await probeVideoSize(out), { width: 360, height: 640 },
      "kanvas harus tetap terisi penuh, bukan mengecil mengikuti foto");
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
