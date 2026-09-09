// FRAME PERTAMA VIDEO ADALAH FOTO KATALOG (Brian memilih opsi C, 9 Sep 2026).
//
// Terukur pada job 9789aa55, video yang Brian tinjau:
//   detik 0  foto katalog produk di dinding beton, pita blur kiri-kanan
//   detik 1  potong keras ke ruang mesin — lompatan terbesar di video, MAD 0,223
//
// Foto katalog itu acuan kami sendiri: acuanTegak() menambal foto jadi 9:16
// dengan pita buram, dan mesin video MENIRU komposisi berpitanya sepanjang
// video. Pada job 2a040ce1 pitanya memakan 57% frame.
//
// Akibatnya berlapis: produk mengecil sehingga labelnya sulit dibaca, pita
// menggandakan konten warna-kulit sehingga QC-02 salah menuduh, dan pembukaan
// videonya menyentak.
//
// Brian memilih C: pakai kartu storyboard sebagai frame pertama — Seedream
// menggambarnya asli 9:16 sebagai ADEGAN, bukan foto katalog.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";
import { readFileSync } from "node:fs";
import { acuanTegak } from "../lib/media/acuan-tegak";

/** Sumber bergaris tajam. Garisnya yang membuat potong vs tambal bisa DIUKUR:
 *  potongan mempertahankan garis tajam sampai ke tepi kanvas, sementara pita
 *  buram (blur 40) meratakannya jadi abu. */
async function buatBergaris(dir: string, nama: string, w: number, h: number): Promise<string> {
  const px = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const v = Math.floor(x / 12) % 2 === 0 ? 245 : 15;
      const i = (y * w + x) * 3;
      px[i] = px[i + 1] = px[i + 2] = v;
    }
  }
  const f = path.join(dir, nama);
  await sharp(px, { raw: { width: w, height: h, channels: 3 } }).png().toFile(f);
  return f;
}

/** Energi tepi rata-rata pada sebuah pita kolom — tinggi = tajam, rendah = buram. */
async function energiTepi(file: string, x0: number, x1: number): Promise<number> {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  let total = 0, n = 0;
  const y = Math.floor(info.height / 2);
  for (let x = x0; x < Math.min(x1, info.width) - 1; x++) {
    total += Math.abs(data[y * info.width + x] - data[y * info.width + x + 1]);
    n++;
  }
  return n ? total / n : 0;
}

/** Energi tepi pada pita BARIS — untuk foto mendatar yang pitanya atas-bawah. */
async function energiTepiBaris(file: string, y0: number, y1: number): Promise<number> {
  const { data, info } = await sharp(file).greyscale().raw().toBuffer({ resolveWithObject: true });
  let total = 0, n = 0;
  for (let y = y0; y < Math.min(y1, info.height); y += 4) {
    for (let x = 0; x < info.width - 1; x++) {
      total += Math.abs(data[y * info.width + x] - data[y * info.width + x + 1]);
      n++;
    }
  }
  return n ? total / n : 0;
}

test("foto LEBIH TEGAK dari 9:16 DIPOTONG — tepi kanvas masih tajam, bukan pita buram", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acuan-"));
  // Bentuk yang paling sering dikirim penjual: foto ponsel tegak.
  const asal = await buatBergaris(dir, "tegak.png", 600, 1400);
  const hasil = await acuanTegak(asal, path.join(dir, "out"));
  const m = await sharp(hasil).metadata();
  assert.equal(m.width, 720);
  assert.equal(m.height, 1280);

  // Kalau ditambal, kolom terluar berasal dari latar ber-blur 40 dan energinya
  // runtuh. Kalau dipotong, garis tajam sumbernya sampai ke tepi.
  const tepi = await energiTepi(hasil, 0, 60);
  const tengah = await energiTepi(hasil, 330, 390);
  assert.ok(tengah > 10, `sumber ujinya sendiri tidak bergaris (tengah=${tengah.toFixed(1)})`);
  assert.ok(
    tepi > tengah * 0.5,
    `tepi kanvas buram (tepi=${tepi.toFixed(1)} vs tengah=${tengah.toFixed(1)}) — foto tegak masih ditambal pita`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("foto LEBIH MENDATAR TETAP ditambal — label ada di sisi, tidak boleh dibuang", async () => {
  // Batas yang disengaja: memadatkan foto mendatar berarti membuang SISI, dan
  // sisi adalah tempat label. Menukar pita dengan label yang hilang berarti
  // membatalkan seluruh gunanya foto acuan.
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "acuan2-"));
  const asal = await buatBergaris(dir, "datar.png", 646, 488);
  const hasil = await acuanTegak(asal, path.join(dir, "out"));
  const m = await sharp(hasil).metadata();
  assert.equal(m.width, 720);
  assert.equal(m.height, 1280);

  // Foto mendatar ditambal atas-bawah: baris teratas harus JAUH lebih buram
  // daripada bagian tengah yang berisi fotonya sendiri.
  const atas = await energiTepiBaris(hasil, 0, 120);
  const tengah = await energiTepiBaris(hasil, 600, 700);
  assert.ok(tengah > 10, `sumber ujinya sendiri tidak bergaris (tengah=${tengah.toFixed(1)})`);
  assert.ok(
    atas < tengah * 0.5,
    `pita atas tidak buram (atas=${atas.toFixed(1)} vs tengah=${tengah.toFixed(1)}) — foto mendatar ikut dipotong dan labelnya terbuang`,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test("kartu storyboard tidak lagi ditolak seborong untuk format berwajah", () => {
  const src = readFileSync(new URL("../lib/postgres/worker.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  // Penolakan seborong dulu berupa return awal sebelum kartu dibaca sama sekali.
  assert.ok(
    !/if \(format === "talking_head" && !config\.seedanceFaceRef\) \{[\s\S]{0,200}?return \{ spec, sudahAda: new Set\(\) \};/.test(src),
    "kartu masih ditolak seborong untuk talking_head",
  );
  assert.match(src, /tolakKartuTerpotong/, "keputusan per-kartu tidak ada");
});

test("kekhawatiran crop-torso tetap dihormati — kartu BERWAJAH kembali ke jalur lama", () => {
  // Penyaring aman-orang "mengamankan" kartu berwajah dengan MEMOTONG wajahnya,
  // dan hasilnya crop torso — bukan frame yang dirancang untuk shot itu. Itu
  // alasan asli penolakan seborong, dan alasan itu masih benar per kartu.
  const src = readFileSync(new URL("../lib/postgres/worker.ts", import.meta.url), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.match(src, /tolakKartuTerpotong && aman\.cropped > 0/, "kartu yang wajahnya dipotong masih dipakai");
});
