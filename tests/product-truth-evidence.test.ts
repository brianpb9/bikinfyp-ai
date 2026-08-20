// P0-03 RED WAVE R1 — kontrak BUKTI (C8) di pusat: referensiLayak().
//
// STATUS YANG DIHARAPKAN: MERAH pada 66b4b33.
// Kode sekarang FAIL-OPEN: `referensiLayak` mendorong rel ke daftar layak
// setiap kali sidecar tidak ada / tidak terbaca (`if (!meta || meta.layakReferensi)`,
// lib/product-images.ts:144), dan ia TIDAK PERNAH memverifikasi ulang sha256
// sidecar terhadap bytes yang benar-benar tersimpan, juga tidak mengenal
// versi bukti sama sekali (MetaGambar, lib/product-images.ts:98-105).
//
// Yang diuji di sini adalah KEPUTUSAN, bukan implementasi: bukti hilang /
// korup / basi / hash beda => gambar TIDAK boleh keluar dari referensiLayak.
// Bagaimana caranya kode nanti menolak (reason code EVIDENCE_INVALID, daftar
// kosong, throw) urusan implementasi; test menuntut minimal "tidak lolos".
//
// LARANGAN YANG DIPATUHI: nol jaringan, nol provider, nol OCR/ffmpeg nyata,
// nol DB produksi. PATH sengaja dikosongkan (lihat catatan di bawah) supaya
// backfillMetaGambar TIDAK PERNAH bisa memanggil ffmpeg/tesseract sungguhan.
//
// PENTING soal classifier: klasifikasiGambar MENELAN errornya sendiri dan
// mengembalikan "promotional_graphic" (RAGU = PROMOSI). Jadi kalau sebuah
// asersi digantungkan pada VONIS classifier, ia bisa hijau semu hanya karena
// binernya tidak ada. Dua kasus yang menyentuh backfill (sidecar hilang /
// korup) karena itu diasersi pada hal yang tidak bergantung vonis sama sekali:
// jalur BACA tidak boleh MENULIS bukti baru ke storage.

import { test, after, before } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "p003-evidence-store-"));

// Sandbox biner: direktori kosong sebagai satu-satunya PATH. ffmpeg/ffprobe/
// tesseract jadi ENOENT seketika — nol OCR nyata, nol ffmpeg nyata, dan
// hasilnya deterministik di mesin mana pun (ada atau tidak ada binernya).
const PATH_KOSONG = fs.mkdtempSync(path.join(os.tmpdir(), "p003-nobin-"));
process.env.PATH = PATH_KOSONG;

// Bukti "nol jaringan": setiap fetch dihitung dan dilempar.
let panggilanJaringan = 0;
globalThis.fetch = (async (...args: unknown[]) => {
  panggilanJaringan++;
  throw new Error(`Test ini dilarang menyentuh jaringan: ${String(args[0])}`);
}) as unknown as typeof fetch;

const { referensiLayak } = await import("../lib/product-images");
const { setMediaStorageForTests } = await import("../lib/storage");
type MediaStorage = import("../lib/storage").MediaStorage;
type StoredObject = import("../lib/storage").StoredObject;

/**
 * KONTRAK VERSI BUKTI — DIKUNCI, bukan usulan.
 *
 *     nama field : `versiBukti`
 *     tipe       : integer
 *     nilai kini : 1
 *
 * Ditulis di test dan bukan diimpor karena konstantanya BELUM ADA di produksi —
 * itu bagian dari cacatnya. Tapi jangan salah baca: test ini sudah MENGUNCI
 * nama fieldnya lewat fixture-fixture di bawah, jadi implementasi R2 WAJIB
 * memakai `versiBukti` (integer) dan menaikkan nilainya setiap kali aturan
 * klasifikasi berubah. Sidecar tanpa field itu, atau dengan nilai lebih kecil
 * dari nilai kini, adalah EVIDENCE_INVALID.
 */
const VERSI_BUKTI_TERKINI = 1;

type Isi = { body: Buffer; contentType?: string };

function storageMemori(isi: Map<string, Isi>, tulisan: string[]): MediaStorage {
  return {
    async put(key, body, contentType) {
      tulisan.push(key);
      isi.set(key, { body, contentType });
    },
    async delete(key) {
      isi.delete(key);
    },
    async get(key, range): Promise<StoredObject | null> {
      const found = isi.get(key);
      if (!found) return null;
      const body = range ? found.body.subarray(range.start, range.end + 1) : found.body;
      return { body, size: found.body.length, contentType: found.contentType };
    },
    async stat(key) {
      const found = isi.get(key);
      return found ? { size: found.body.length, contentType: found.contentType } : null;
    },
    async materialize() {
      // Tidak dipakai jalur ini; kalau terpakai, itu regresi yang harus terlihat.
      throw new Error("materialize() tidak boleh dipanggil oleh referensiLayak");
    },
  };
}

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

function sidecarSah(bytes: Buffer, layak: boolean, jenis: "product_photo" | "promotional_graphic") {
  return Buffer.from(
    JSON.stringify({
      sha256: sha(bytes),
      jenis,
      layakReferensi: layak,
      rasioAreaTeks: layak ? 0.004 : 0.19,
      jumlahKata: layak ? 2 : 14,
      alasan: layak ? "foto produk" : "materi promosi",
      versiBukti: VERSI_BUKTI_TERKINI,
    })
  );
}

const PACKSHOT = Buffer.from("BYTES-PACKSHOT-SAH-P0-03");
const BANNER = Buffer.from("BYTES-BANNER-PROMO-P0-03");

const relFoto = (n: number) => `uploads/p0-03/${n}.webp`;
const relSidecar = (n: number) => `${relFoto(n)}.meta.json`;

/**
 * Setiap test memakai storage bersih; tidak ada kebocoran state antar-kasus.
 * Mengembalikan daftar KUNCI YANG DITULIS selama test — jalur baca (render)
 * tidak boleh mencetak bukti baru, dan itu harus bisa dibuktikan.
 */
function pasang(entri: [string, Buffer][]): string[] {
  const isi = new Map<string, Isi>();
  for (const [key, body] of entri) isi.set(key, { body });
  const tulisan: string[] = [];
  setMediaStorageForTests(storageMemori(isi, tulisan));
  return tulisan;
}

before(() => {
  assert.equal(panggilanJaringan, 0, "jaringan sudah tersentuh sebelum test mulai");
});

// ---------------------------------------------------------------- KONTROL (+)

test("kontrol positif: sidecar sah (sha256 cocok + versi terkini) diterima", async () => {
  const tulisan = pasang([
    [relFoto(1), PACKSHOT],
    [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")],
  ]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    layak,
    [relFoto(1)],
    "bukti SAH harus diterima — kalau ini merah, gerbangnya terlalu ketat, bukan terlalu longgar"
  );
  assert.deepEqual(tulisan, [], "membaca bukti yang sah tidak boleh menulis apa pun ke storage");
});

test("kontrol positif: foto#1 promosi ditolak, foto#2 sah dipilih (C1)", async () => {
  pasang([
    [relFoto(0), BANNER],
    [relSidecar(0), sidecarSah(BANNER, false, "promotional_graphic")],
    [relFoto(1), PACKSHOT],
    [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")],
  ]);
  const layak = await referensiLayak([relFoto(0), relFoto(1)]);
  assert.deepEqual(
    layak,
    [relFoto(1)],
    "REF_PROMOTIONAL adalah status FOTO, bukan penolakan produk: foto#2 wajib terpilih, foto#1 wajib tersingkir"
  );
});

// -------------------------------------------------------------------- C8 (–)

test("C8: berkas referensi hilang, sidecar masih ada -> tidak boleh lolos", async () => {
  // Sidecar sah tapi bytes-nya tidak ada: hash tidak mungkin diverifikasi,
  // dan tidak ada yang bisa dikirim ke model. Fail-closed.
  pasang([[relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")]]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    layak,
    [],
    `EVIDENCE_INVALID: berkas ${relFoto(1)} TIDAK ADA di storage, tapi referensiLayak() tetap ` +
      `mengembalikan ${JSON.stringify(layak)} karena ia hanya membaca sidecar dan tidak pernah ` +
      "membuktikan bytes-nya ada."
  );
});

// Dua kasus di bawah menuntut hal yang SAMA dan sengaja tidak bergantung pada
// vonis classifier: jalur BACA (render) tidak boleh MENCETAK bukti baru. Kalau
// sidecar hilang atau rusak, jawabannya "tidak sah", bukan "biar diklasifikasi
// ulang sekarang" — sebab bukti yang dicetak saat render tidak pernah dilihat
// siapa pun, tidak punya rantai kustodi, dan menempel pada bytes apa pun yang
// kebetulan ada di storage detik itu.

test("C8: sidecar hilang (berkas ada) -> tidak boleh MENCETAK bukti baru saat render", async () => {
  const tulisan = pasang([[relFoto(1), PACKSHOT]]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    tulisan,
    [],
    `EVIDENCE_INVALID: referensiLayak() MENULIS bukti baru saat dibaca: ${JSON.stringify(tulisan)}. ` +
      "backfillMetaGambar (lib/product-images.ts:156-178) mengklasifikasi ulang dan mem-put sidecar " +
      "di tengah jalur render — bukti dicetak sendiri oleh pemakainya, tanpa rantai kustodi."
  );
  assert.deepEqual(layak, [], `EVIDENCE_INVALID: gambar tanpa sidecar tetap lolos: ${JSON.stringify(layak)}`);
});

test("C8: sidecar JSON korup -> tidak boleh ditimpa diam-diam lalu diloloskan", async () => {
  const korup = Buffer.from('{"sha256": "abc", "jenis":');
  const tulisan = pasang([
    [relFoto(1), PACKSHOT],
    [relSidecar(1), korup],
  ]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    tulisan,
    [],
    `EVIDENCE_INVALID: sidecar KORUP diperlakukan sama dengan "tidak ada" (bacaMetaGambar menelan ` +
      `error, lib/product-images.ts:113-115), lalu backfill MENIMPANYA: ${JSON.stringify(tulisan)}. ` +
      "Bukti yang rusak justru dihapus jejaknya, bukan dilaporkan."
  );
  assert.deepEqual(layak, [], `EVIDENCE_INVALID: gambar dengan sidecar korup tetap lolos: ${JSON.stringify(layak)}`);
});

test("C8: skema sah tapi TIPE FIELD salah -> tidak boleh lolos", async () => {
  // JSON-nya parse bersih dan semua field ada; yang rusak adalah TIPE-nya.
  // `layakReferensi` datang sebagai string "false" — dan di JavaScript string
  // "false" itu TRUTHY, jadi pemeriksaan `meta.layakReferensi` membacanya
  // sebagai "layak". Bukti yang dibuat penulis lain (jalur org, migrasi, skrip
  // tangan) bisa persis seperti ini, dan hasilnya kebalikan 180 derajat dari
  // yang tertulis di buktinya sendiri.
  const tipeSalah = Buffer.from(
    JSON.stringify({
      sha256: sha(PACKSHOT),
      jenis: "promotional_graphic",
      layakReferensi: "false", // string, bukan boolean
      rasioAreaTeks: "0.19", // string, bukan number
      jumlahKata: 14,
      alasan: "materi promosi",
      versiBukti: VERSI_BUKTI_TERKINI,
    })
  );
  pasang([
    [relFoto(1), PACKSHOT],
    [relSidecar(1), tipeSalah],
  ]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    layak,
    [],
    `EVIDENCE_INVALID: sidecar dengan TIPE FIELD salah (layakReferensi: "false" sebagai STRING) ` +
      `tetap diterima (${JSON.stringify(layak)}). bacaMetaGambar hanya JSON.parse lalu meng-cast ` +
      "ke MetaGambar (lib/product-images.ts:112) — tidak ada satu pun pemeriksaan bentuk, jadi " +
      'string "false" yang truthy dibaca sebagai LAYAK. Buktinya sendiri berkata sebaliknya.'
  );
});

test("C8: sidecar tanpa versi bukti -> tidak boleh lolos", async () => {
  const tanpaVersi = Buffer.from(
    JSON.stringify({
      sha256: sha(PACKSHOT),
      jenis: "product_photo",
      layakReferensi: true,
      rasioAreaTeks: 0.004,
      jumlahKata: 2,
      alasan: "foto produk",
    })
  );
  pasang([
    [relFoto(1), PACKSHOT],
    [relSidecar(1), tanpaVersi],
  ]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    layak,
    [],
    `EVIDENCE_INVALID: sidecar TANPA versi bukti tetap diterima (${JSON.stringify(layak)}). ` +
      "MetaGambar (lib/product-images.ts:98-105) tidak punya field versi sama sekali, jadi bukti " +
      "yang dibuat aturan lama tidak bisa dibedakan dari bukti yang dibuat aturan sekarang."
  );
});

test("C8: versi bukti basi -> tidak boleh lolos", async () => {
  const versiBasi = Buffer.from(
    JSON.stringify({
      sha256: sha(PACKSHOT),
      jenis: "product_photo",
      layakReferensi: true,
      rasioAreaTeks: 0.004,
      jumlahKata: 2,
      alasan: "foto produk",
      versiBukti: VERSI_BUKTI_TERKINI - 1,
    })
  );
  pasang([
    [relFoto(1), PACKSHOT],
    [relSidecar(1), versiBasi],
  ]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    layak,
    [],
    `EVIDENCE_INVALID: sidecar dengan versi bukti BASI (${VERSI_BUKTI_TERKINI - 1} < ` +
      `${VERSI_BUKTI_TERKINI}) tetap diterima (${JSON.stringify(layak)}). Aturan klasifikasi ` +
      "yang diperketat tidak akan pernah berlaku surut selama versi tidak diperiksa."
  );
});

test("C8: sha256 sidecar beda dari bytes tersimpan -> tidak boleh lolos", async () => {
  // Skenario nyata: berkas ditukar/ditimpa sesudah klasifikasi; sidecar lama
  // (layakReferensi: true) masih menempel pada bytes yang sudah lain.
  const ditukar = Buffer.from("BYTES-DITUKAR-SESUDAH-KLASIFIKASI");
  pasang([
    [relFoto(1), ditukar],
    [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")], // hash milik PACKSHOT
  ]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(
    layak,
    [],
    `EVIDENCE_INVALID / REF_HASH_MISMATCH: sidecar membawa sha256 ${sha(PACKSHOT).slice(0, 16)}… ` +
      `sementara bytes tersimpan ber-sha256 ${sha(ditukar).slice(0, 16)}…, tapi referensiLayak() ` +
      `tetap mengembalikan ${JSON.stringify(layak)}. Hash di sidecar tidak pernah diverifikasi ` +
      "ulang terhadap isi berkas — jadi bukti bisa ditempeli gambar apa pun."
  );
});

test("nol jaringan selama seluruh berkas test ini", () => {
  assert.equal(panggilanJaringan, 0, "ada panggilan fetch — test bukti tidak boleh menyentuh jaringan");
});

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
  fs.rmSync(PATH_KOSONG, { recursive: true, force: true });
});
