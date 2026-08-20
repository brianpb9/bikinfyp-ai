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
