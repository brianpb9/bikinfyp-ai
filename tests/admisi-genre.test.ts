// Reviewer ronde 4 (18 Agu), tiga temuan P0 — direproduksi di sini supaya
// tidak bisa kembali diam-diam:
//
//   1. TVC yang melanggar T-01, T-02, DAN T-03 sekaligus tetap passed:true di
//      light, lalu jadi job QUEUED + hold Rp24.000.
//   2. Snapshot admisi hilang: wordBudget tidak dibawa satu pun pemanggil, dan
//      genre bisa dibelokkan oleh isi request (template afiliasi + format:"tvc").
//   3. Genre Ads tidak punya kontrak: CTA resminya justru ditolak L-03,
//      sementara harga yang ditulis dengan KATA lolos gerbang kebenaran.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-genre-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-genre-storage-${process.pid}`;

const { periksaAdmisi, konteksAdmisi, amplopValidasi, bacaJejak } = await import("../lib/script-engine/admisi");
const { validateScript, hargaTerbilang, SELALU_KERAS } = await import("../lib/script-engine/validator");

const produk = {
  hookFamily: "H1",
  register: "netral",
  productName: "Serum Glow",
  productPriceIdr: 85000,
  qualityTier: "super_hq" as const,
};

/** TVC yang cacat rangkap tiga: penutup tanpa merek (T-01), menyebut keranjang
 *  (T-02), dan kalimat dua negasi (T-03). */
const tvcCacat = [
  { role: "hook", start: 0, end: 5, text: "Pagi yang tidak pernah tidak sibuk di rumah ini", visual_direction: "x" },
  { role: "demo", start: 5, end: 11, text: "Rangkaian perawatan lembut untuk kulit setiap hari", visual_direction: "x" },
  { role: "cta", start: 11, end: 15, text: "Cek keranjang kuning sekarang ya", visual_direction: "x" },
] as never[];

test("(1) TVC yang melanggar T-01/T-02/T-03 DITOLAK di light — dulu passed:true", () => {
  const hasil = periksaAdmisi({ ...produk, segments: tvcCacat, durationSec: 15, format: "tvc" });
  assert.equal(hasil.passed, false, "TVC cacat rangkap tiga tidak boleh sampai ke hold kredit");
  for (const aturan of ["T-01", "T-02", "T-03"]) {
    assert.ok(hasil.errors.some((e) => e.rule === aturan), `${aturan} harus keras: ${JSON.stringify(hasil.errors)}`);
  }
  // Ketiganya wajib ada di daftar keras — bukan kebetulan lolos lewat jalur lain.
  for (const aturan of ["T-01", "T-02", "T-03", "A-01", "A-02"]) assert.ok(SELALU_KERAS.has(aturan), aturan);
});

test("(2a) snapshot membawa wordBudget — naskah template pendek tidak lagi salah ditolak", () => {
  // 25 kata, jatah template 24 (toleransi +15% = 28). Dengan jendela default
  // 15 dtk bersuara (maks 22) ia ditolak L-05; dengan jatah templatenya sah.
  const pendek = [
    { role: "hook", start: 0, end: 5, text: "Nah, kenapa sih wajah kelihatan kusam banget tiap kali siang begini?", visual_direction: "x" },
    { role: "demo", start: 5, end: 11, text: "Serum Glow aku pakai tiap pagi dan malam deh", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "cek aja langsung di keranjang kuning ya", visual_direction: "x" },
  ] as never[];
  const sumber = {
    ...produk, register: "bestie", segments: pendek,
    productSourceUrl: "https://www.tiktok.com/@x/video/1", qualityTier: "high_quality" as const,
  };
  const tanpa = periksaAdmisi(sumber);
  const dengan = periksaAdmisi({ ...sumber, snapshot: { durationSec: 15, wordBudget: 24 } });
  assert.ok(tanpa.errors.some((e) => e.rule === "L-05"), "tanpa jatah kata memang ditolak — itulah lubangnya");
  assert.equal(dengan.errors.some((e) => e.rule === "L-05"), false, JSON.stringify(dengan.errors));
});

test("(2b) genre TIDAK bisa dibelokkan oleh isi request", () => {
  const afiliasi = [
    { role: "hook", start: 0, end: 5, text: "Nah, kenapa wajah kelihatan kusam banget pas siang begini sih?", visual_direction: "x" },
    { role: "demo", start: 5, end: 11, text: "Serum Glow aku pakai tiap pagi deh", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "beli sekarang juga ya", visual_direction: "x" },
  ] as never[];
  // "diskon-gede" adalah template AFILIASI. Request yang menyebut format:"tvc"
  // dulu membuat L-03 dilewati — genre naskah ditentukan oleh pengirimnya.
  const k = konteksAdmisi({
    ...produk, register: "bestie", segments: afiliasi,
    productSourceUrl: "https://www.tiktok.com/@x/video/1",
    templateId: "diskon-gede", format: "tvc",
  }) as Record<string, unknown>;
  assert.notEqual(k.format, "tvc", "katalog template yang menentukan genre, bukan request");
  assert.ok(validateScript(k as never, "light").errors.some((e) => e.rule === "L-03"),
    "naskah afiliasi tetap wajib menyebut keranjang");
});

test("(3a) CTA resmi Ads lolos, dan Ads tidak boleh menyebut keranjang", () => {
  const ads = (cta: string) => [
    { role: "hook", start: 0, end: 5, text: "Nah, meja penuh ini sebenarnya butuh berapa alat sih?", visual_direction: "x" },
    { role: "demo", start: 5, end: 11, text: "Jasa Rapi ngurusin semuanya buat kamu deh", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: cta, visual_direction: "x" },
  ] as never[];
  const dasar = {
    ...produk, register: "bestie", productName: "Jasa Rapi", productPriceIdr: 85000,
    qualityTier: "high_quality" as const, durationSec: 15,
    snapshot: { contentType: "ads" as const, durationSec: 15 },
  };

  const benar = periksaAdmisi({ ...dasar, segments: ads("Detailnya ada di bawah ya") });
  assert.equal(benar.errors.some((e) => e.rule === "L-03"), false,
    `CTA resmi Ads tidak boleh ditolak L-03: ${JSON.stringify(benar.errors)}`);
  assert.equal(benar.errors.some((e) => e.rule.startsWith("A-")), false, JSON.stringify(benar.errors));

  // Bukti bahwa genre-nyalah sebabnya: sebagai afiliasi, CTA yang sama ditolak.
  const sebagaiAfiliasi = periksaAdmisi({ ...dasar, snapshot: { durationSec: 15 }, segments: ads("Detailnya ada di bawah ya") });
  assert.ok(sebagaiAfiliasi.errors.some((e) => e.rule === "L-03"), "itulah kenapa setiap naskah Ads yang benar ditolak");

  const keranjang = periksaAdmisi({ ...dasar, segments: ads("cek keranjang kuning ya") });
  assert.ok(keranjang.errors.some((e) => e.rule === "A-02"), JSON.stringify(keranjang.errors));
  const tanpaArah = periksaAdmisi({ ...dasar, segments: ads("Kami tunggu ya") });
  assert.ok(tanpaArah.errors.some((e) => e.rule === "A-01"), JSON.stringify(tanpaArah.errors));
});

test("(3b) L-14 membaca harga yang ditulis dengan KATA", () => {
  assert.deepEqual(hargaTerbilang("sembilan puluh sembilan ribu"), [{ frasa: "sembilan puluh sembilan ribu", nilai: 99000 }]);
  assert.deepEqual(hargaTerbilang("seratus dua puluh ribu"), [{ frasa: "seratus dua puluh ribu", nilai: 120000 }]);
  assert.deepEqual(hargaTerbilang("dua juta"), [{ frasa: "dua juta", nilai: 2000000 }]);
  // "85 ribu" angkanya digit — jalur digit yang memeriksanya, bukan jalur ini.
  assert.deepEqual(hargaTerbilang("cuma 85 ribu aja"), []);
  assert.deepEqual(hargaTerbilang("tiga puluh detik"), []);

  const naskah = (harga: string) => [
    { role: "hook", start: 0, end: 5, text: "Nah, kenapa wajah kelihatan kusam banget pas siang begini sih?", visual_direction: "x" },
    { role: "demo", start: 5, end: 11, text: `Serum Glow cuma ${harga} deh`, visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "cek keranjang kuning ya", visual_direction: "x" },
  ] as never[];
  const dasar = {
    ...produk, register: "bestie", qualityTier: "high_quality" as const,
    productSourceUrl: "https://www.tiktok.com/@x/video/1", durationSec: 15,
  };
  const bohong = periksaAdmisi({ ...dasar, segments: naskah("sembilan puluh sembilan ribu") });
  assert.ok(bohong.errors.some((e) => e.rule === "L-14"), `harga karangan harus tertangkap: ${JSON.stringify(bohong.errors)}`);
  const jujur = periksaAdmisi({ ...dasar, segments: naskah("delapan puluh lima ribu") });
  assert.equal(jujur.errors.some((e) => e.rule === "L-14"), false, JSON.stringify(jujur.errors));
});

test("(3c) angka DI NAMA PRODUK bukan klaim — tidak lagi false-reject", () => {
  const segs = [
    { role: "hook", start: 0, end: 5, text: "Nah, kenapa wajah kelihatan kusam banget pas siang begini sih?", visual_direction: "x" },
    { role: "demo", start: 5, end: 11, text: "SPF Serum 50 aku pakai tiap pagi deh", visual_direction: "x" },
    { role: "cta", start: 11, end: 15, text: "cek keranjang kuning ya", visual_direction: "x" },
  ] as never[];
  const hasil = periksaAdmisi({
    ...produk, register: "bestie", productName: "SPF Serum 50", qualityTier: "high_quality",
    productSourceUrl: "https://www.tiktok.com/@x/video/1", durationSec: 15, segments: segs,
  });
  assert.equal(hasil.errors.some((e) => e.rule === "L-14"), false, JSON.stringify(hasil.errors));
});

test("provenance selamat melewati approve — vonis diganti, jejak dibawa", () => {
  const disimpanSaatGenerate = amplopValidasi(
    { passed: true, errors: [], warnings: [], checked_at: "t0" },
    { script_source: "llm", admisi: { contentType: "ads", durationSec: 15, wordBudget: 24 } }
  );
  const jejak = bacaJejak(JSON.stringify(disimpanSaatGenerate));
  assert.equal(jejak.script_source, "llm");
  assert.equal(jejak.admisi?.wordBudget, 24);

  // Yang dulu terjadi: approve menimpa seluruh kolom dengan vonis baru.
  const caraLama = { passed: true, errors: [], warnings: [], checked_at: "t1" };
  assert.equal(bacaJejak(JSON.stringify(caraLama)).script_source, undefined, "itulah cara provenance-nya hilang");

  const caraBaru = amplopValidasi(caraLama, jejak);
  assert.equal(bacaJejak(JSON.stringify(caraBaru)).script_source, "llm");
  assert.equal(bacaJejak(JSON.stringify(caraBaru)).admisi?.contentType, "ads");
  assert.equal(caraBaru.checked_at, "t1", "vonisnya tetap yang terbaru");
});

test("provenance manual eksplisit selamat melewati amplop validasi", () => {
  const jejak = bacaJejak(JSON.stringify({
    passed: true, errors: [], warnings: [], checked_at: "2026-08-31T00:00:00.000Z",
    script_source: "manual",
    admisi: { contentType: "affiliate", format: "hands_only", durationSec: 15 },
  }));
  assert.equal(jejak.script_source, "manual");
  assert.equal(amplopValidasi({ passed: true, errors: [], warnings: [], checked_at: "t1" }, jejak).script_source, "manual");
});
