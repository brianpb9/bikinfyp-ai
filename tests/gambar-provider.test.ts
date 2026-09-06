// GERBANG GAMBAR TANPA SESI — satu-satunya jalur baca di aplikasi ini yang
// tidak menuntut login. Tes ini menjaga pagarnya, bukan fiturnya: kalau salah
// satu syarat lepas, yang bocor adalah foto pengguna ke siapa pun yang menebak.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import crypto from "node:crypto";

process.env.AUTH_SECRET = "rahasia-uji-yang-cukup-panjang-32byte!!";
process.env.DB_PATH = `/tmp/racun-test-gambarprov-${process.pid}.db`;
const storage = `/tmp/racun-test-gambarprov-storage-${process.pid}`;
process.env.STORAGE_DIR = storage;
process.env.APP_BASE_URL = "https://aiugc.id";

const G = await import("../lib/gambar-provider");

const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "gp-"));
const berkas = path.join(dir, "foto.png");
fs.writeFileSync(berkas, png);

function bagian(url: string) {
  const u = new URL(url);
  return {
    rel: decodeURIComponent(u.pathname.replace("/api/provider-image/", "")),
    exp: Number(u.searchParams.get("exp")),
    sig: u.searchParams.get("sig") ?? "",
  };
}

test("URL yang diterbitkan MUTLAK — server orang lain tidak bisa membuka alamat relatif", async () => {
  const url = await G.terbitkanGambarProvider(berkas, "job-1", 0);
  assert.match(url, /^https:\/\/aiugc\.id\/api\/provider-image\/provider-in\/job-1\/0\.png\?/);
  const { rel, exp, sig } = bagian(url);
  assert.equal(G.verifikasiGambarProvider(rel, exp, sig), true);
});

test("APP_BASE_URL kosong = MENOLAK, bukan menerbitkan alamat yang pasti gagal diunduh", async () => {
  const asal = process.env.APP_BASE_URL;
  const { config } = await import("../lib/config");
  const asalCfg = config.appBaseUrl;
  (config as { appBaseUrl: string }).appBaseUrl = "";
  try {
    await assert.rejects(() => G.terbitkanGambarProvider(berkas, "job-2", 0), /APP_BASE_URL kosong/);
  } finally {
    (config as { appBaseUrl: string }).appBaseUrl = asalCfg;
    process.env.APP_BASE_URL = asal;
  }
});

test("tanda tangan yang SAH untuk kunci di luar provider-in/ tetap ditolak", async () => {
  const url = await G.terbitkanGambarProvider(berkas, "job-3", 0);
  const { exp } = bagian(url);
  // Ditandatangani dengan kunci yang sama persis, hanya kuncinya di luar kotak.
  const luar = "jobs/rahasia-orang-lain/output.mp4";
  const kunci = Buffer.from(
    crypto.hkdfSync("sha256", Buffer.from(process.env.AUTH_SECRET!, "utf8"), Buffer.alloc(0),
      Buffer.from("bikinfyp/gambar-provider/v1", "utf8"), 32),
  );
  const sig = crypto.createHmac("sha256", kunci).update(`${luar}:${exp}`).digest("hex");
  assert.equal(G.verifikasiGambarProvider(luar, exp, sig), false,
    "kunci di luar provider-in/ bisa dibaca tanpa sesi — seluruh penyimpanan terbuka");
});

test("tautan kedaluwarsa dan tanda tangan palsu ditolak", async () => {
  const url = await G.terbitkanGambarProvider(berkas, "job-4", 0);
  const { rel, exp, sig } = bagian(url);
  assert.equal(G.verifikasiGambarProvider(rel, Math.floor(Date.now() / 1000) - 1, sig), false, "tautan mati masih diterima");
  assert.equal(G.verifikasiGambarProvider(rel, exp, "0".repeat(64)), false, "tanda tangan palsu diterima");
  assert.equal(G.verifikasiGambarProvider(rel, exp, ""), false);
  assert.equal(G.verifikasiGambarProvider(rel, Number.NaN, sig), false);
});

test("kuncinya DITURUNKAN TERPISAH dari kunci URL media", async () => {
  const { mediaUrlKey } = await import("../lib/secrets");
  const url = await G.terbitkanGambarProvider(berkas, "job-5", 0);
  const { rel, exp, sig } = bagian(url);
  // Tanda tangan atas (rel, exp) YANG SAMA, hanya kuncinya kunci media. Kalau
  // kedua gerbang memakai kunci yang sama, keduanya identik — dan bocornya
  // salah satu membocorkan yang lain.
  const denganKunciMedia = crypto.createHmac("sha256", mediaUrlKey()).update(`${rel}:${exp}`).digest("hex");
  assert.notEqual(denganKunciMedia, sig, "gerbang provider memakai kunci yang sama dengan URL media");
  assert.equal(G.verifikasiGambarProvider(rel, exp, denganKunciMedia), false);
});

test("hanya JPEG/PNG/WebP yang boleh lewat — dikenali dari BYTES, bukan nama berkas", async () => {
  assert.equal(G.mimeGambar(png), "image/png");
  assert.equal(G.mimeGambar(Buffer.from([0xff, 0xd8, 0xff, 0x00])), "image/jpeg");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
  assert.equal(G.mimeGambar(webp), "image/webp");
  // Berkas yang MENYAMAR sebagai gambar lewat namanya saja tetap ditolak.
  const palsu = path.join(dir, "jahat.png");
  fs.writeFileSync(palsu, "<html><script>alert(1)</script>");
  assert.equal(G.mimeGambar(fs.readFileSync(palsu)), null);
  await assert.rejects(() => G.terbitkanGambarProvider(palsu, "job-6", 0), /bukan JPEG\/PNG\/WebP/);
});

test("salinan job dibuang saat job selesai", async () => {
  await G.terbitkanGambarProvider(berkas, "job-7", 0);
  await G.terbitkanGambarProvider(berkas, "job-7", 1);
  const ada = (i: number) => fs.existsSync(path.join(storage, "provider-in", "job-7", `${i}.png`));
  assert.ok(ada(0) && ada(1), "salinannya tidak pernah tertulis — tes ini tidak menguji apa pun");
  await G.hapusGambarProvider("job-7", 2);
  assert.ok(!ada(0) && !ada(1), "foto produk tertinggal di kotak yang bisa dibaca tanpa sesi");
});
