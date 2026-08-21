// P0-B1 — SETIAP JALUR INGESTION MENERBITKAN BUKTI.
//
// Matriks call-site lengkapnya ada di
// docs/evidence/P0-03/B1-B2-MATRIKS-INGESTION.md. Ringkasnya: lima route
// menulis bytes foto produk, dan hanya SATU dari tiga fungsi penyimpan yang
// menulis sidecar.
//
//   saveProductImages        I1 buat produk manual, I2 tambah foto (Retail)   YA
//   downloadProductImages    I3 ekstrak URL (Retail), I4 produk org (Ent.)    TIDAK
//   saveUniqueProductImages  I5 tambah foto org (Enterprise)                  TIDAK
//
// Akibatnya, begitu resolver ketat menyala, setiap produk yang dibuat lewat
// ekstrak-link atau lewat dashboard enterprise langsung terbrick: tidak ada
// satu pun bukti yang menyatakan fotonya layak, jadi tidak ada satu pun
// referensi yang tersetujui. Reviewer menyebut ini eksplisit — resolver dan
// bukti ingestion adalah SATU slice, bukan dua.
//
// APA YANG DIUJI DI SINI, DAN KENAPA BEGITU.
//
// Test ini TIDAK menuntut vonisnya "foto produk layak", karena vonis itu
// bergantung pada ada-tidaknya ffmpeg/ffprobe/tesseract di mesin yang
// menjalankannya — dan mesin tanpa biner justru mesin yang paling penting
// (service web Render `runtime: node`). Yang dituntut adalah hal yang
// deterministik di mesin mana pun:
//
//   1. setiap rel yang dikembalikan punya sidecar;
//   2. sidecar itu SAH menurut resolver — artinya ia tidak pernah ditolak
//      dengan EVIDENCE_INVALID. Ditolak dengan CLASSIFIER_FAILED (biner tidak
//      ada) atau REF_PROMOTIONAL (memang banner) adalah jawaban yang BENAR dan
//      diterima di sini;
//   3. sha256 di sidecar cocok dengan bytes yang BENAR-BENAR tersimpan.
//
// Butir 2 itu yang menutup celahnya: bukti yang bentuknya salah sama tidak
// bergunanya dengan bukti yang tidak ada, dan keduanya hanya bisa dibedakan
// dari bukti yang SAH oleh resolver — jadi resolver-lah yang jadi hakimnya di
// sini, bukan daftar field yang disalin ulang di test.
//
// Kontrol positif dengan biner sungguhan tetap ada, dijaga `punyaOcr()`: pada
// mesin yang punya binernya, foto polos wajib benar-benar TERSETUJUI. Tanpa
// itu, seluruh berkas ini bisa hijau dengan implementasi yang menulis sidecar
// `belum_diperiksa` untuk segalanya.

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFileSync } from "node:child_process";

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "p0b1-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const { relMeta } = await import("../lib/product-images");
const { resolveApprovedReference, ALASAN_TOLAK } = await import("../lib/product-truth");
type MediaStorage = import("../lib/storage").MediaStorage;
type StoredObject = import("../lib/storage").StoredObject;

function punyaOcr(): boolean {
  try {
    execFileSync("tesseract", ["--version"], { stdio: "ignore" });
    execFileSync("ffmpeg", ["-version"], { stdio: "ignore" });
    execFileSync("ffprobe", ["-version"], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

const isi = new Map<string, Buffer>();
const storage: MediaStorage = {
  async put(key, body) {
    isi.set(key, body);
  },
  async delete(key) {
    isi.delete(key);
  },
  async get(key): Promise<StoredObject | null> {
    const body = isi.get(key);
    return body ? { body, size: body.length } : null;
  },
  async stat(key) {
    const body = isi.get(key);
    return body ? { size: body.length } : null;
  },
  async materialize() {
    throw new Error("materialize() tidak dipakai jalur ingestion");
  },
};

/** PNG polos sungguhan — cukup untuk sharp dan untuk classifier. */
async function fotoPolos(): Promise<Buffer> {
  const sharp = (await import("sharp")).default;
  return sharp({ create: { width: 800, height: 800, channels: 3, background: { r: 190, g: 200, b: 210 } } })
    .png()
    .toBuffer();
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/**
 * Kontrak B1 untuk satu jalur, dijalankan atas rel yang benar-benar
 * dikembalikan fungsinya.
 */
async function assertBuktiTerbit(jalur: string, rels: string[]): Promise<void> {
  assert.ok(rels.length > 0, `${jalur}: tidak menyimpan satu pun foto — fixture salah, bukan cacat`);

  for (const rel of rels) {
    assert.ok(
      isi.has(relMeta(rel)),
      `${jalur}: menyimpan bytes ${rel} TANPA sidecar. Begitu resolver ketat menyala, setiap ` +
        "produk dari jalur ini terbrick: tidak ada satu pun bukti yang menyatakan fotonya layak."
    );
    const meta = JSON.parse(isi.get(relMeta(rel))!.toString("utf8")) as { sha256?: string };
    assert.equal(
      meta.sha256,
      sha256(isi.get(rel)!),
      `${jalur}: sha256 di sidecar ${rel} tidak cocok dengan bytes yang BENAR-BENAR tersimpan. ` +
        "Bukti yang hash-nya salah akan ditolak sebagai korup untuk setiap foto yang sah."
    );
  }

  // Hakimnya resolver, bukan daftar field yang disalin ulang di test.
  const hasil = await resolveApprovedReference(rels);
  const tidakSah = hasil.ditolak.filter((d) => d.alasan === ALASAN_TOLAK.BUKTI_TIDAK_SAH);
  assert.deepEqual(
    tidakSah.map((d) => `${d.rel}: ${d.pesan}`),
    [],
    `${jalur}: bukti yang diterbitkan TIDAK SAH menurut resolver. Bukti yang bentuknya salah ` +
      "sama tidak bergunanya dengan bukti yang tidak ada."
  );
}

before(() => setMediaStorageForTests(storage));
after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

// --------------------------------------------------------------- I1 / I2

test("I1+I2 saveProductImages (Retail) menerbitkan bukti untuk setiap foto", async () => {
  const { saveProductImages } = await import("../lib/product-images");
  isi.clear();
  const rels = await saveProductImages(`retail-${process.pid}`, [
    { mime: "image/png", data: await fotoPolos() },
    { mime: "image/png", data: await fotoPolos() },
  ]);
  await assertBuktiTerbit("saveProductImages", rels);
});

// -------------------------------------------------------------------- I5

test("I5 saveUniqueProductImages (Enterprise) menerbitkan bukti untuk setiap foto", async () => {
  const { saveUniqueProductImages } = await import("../lib/product-images");
  isi.clear();
  const rels = await saveUniqueProductImages(`org-${process.pid}`, [
    { mime: "image/png", data: await fotoPolos() },
  ]);
  await assertBuktiTerbit("saveUniqueProductImages", rels);
});

// --------------------------------------------------------------- I3 / I4

test("I3+I4 downloadProductImages (Retail ekstrak + Enterprise) menerbitkan bukti", async () => {
  const { downloadProductImages } = await import("../lib/product-image-download");
  isi.clear();
  const png = await fotoPolos();
  const fetchAsli = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
  try {
    const rels = await downloadProductImages(`unduh-${process.pid}`, ["https://contoh.test/a.png"]);
    await assertBuktiTerbit("downloadProductImages", rels);
  } finally {
    globalThis.fetch = fetchAsli;
  }
});

// ------------------------------------------------ siklus hidup penyimpanan

/**
 * BYTES TANPA BUKTI TIDAK BOLEH TERTINGGAL — termasuk saat penerbitan gagal.
 *
 * Temuan Reviewer 21 Agu: objek fotonya sudah ada di storage saat `tulisSidecar`
 * berjalan, jadi kalau `put` sidecar-nya ditolak, blok tangkap luar melewati URL
 * itu DIAM-DIAM dan meninggalkan bytes tanpa bukti — plus berkas lokal basi di
 * mode r2. Keadaan itu persis yang seluruh P0-B1 ada untuk menghapusnya, dan ia
 * akan lahir kembali setiap kali object store bermasalah.
 */
test("ROLLBACK: put sidecar yang DITOLAK tidak meninggalkan bytes tanpa bukti", async () => {
  const { downloadProductImages } = await import("../lib/product-image-download");
  isi.clear();
  const png = await fotoPolos();

  // Storage yang menolak KHUSUS penulisan sidecar; penulisan foto tetap sukses,
  // jadi yang diuji benar-benar jendela di antara keduanya.
  setMediaStorageForTests({
    ...storage,
    async put(key: string, body: Buffer) {
      if (key.endsWith(".meta.json")) throw new Error("object store menolak sidecar");
      isi.set(key, body);
    },
  } as never);

  const fetchAsli = globalThis.fetch;
  globalThis.fetch = (async () =>
    new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
  try {
    const rels = await downloadProductImages(`gagal-bukti-${process.pid}`, ["https://contoh.test/a.png"]);
    assert.deepEqual(rels, [], "URL yang buktinya gagal terbit tidak boleh dilaporkan berhasil");
    assert.deepEqual(
      [...isi.keys()],
      [],
      `bytes tertinggal di storage tanpa bukti: ${JSON.stringify([...isi.keys()])}. ` +
        "Foto yang buktinya gagal terbit wajib ikut dibuang, bukan ditinggalkan yatim."
    );
  } finally {
    globalThis.fetch = fetchAsli;
    setMediaStorageForTests(storage);
  }
});

/**
 * BUKTI DIHAPUS BERSAMA FOTONYA.
 *
 * `deleteStoredProductImages` dipakai di tiga tempat yang semuanya berarti
 * "foto ini tidak ada lagi": rollback unggah, rollback penambahan ke DB, dan
 * penghapusan foto oleh pengguna. Menghapus hanya kunci fotonya meninggalkan
 * bukti YATIM — dan bukti yatim bukan cuma sampah: ia menyatakan sesuatu
 * tentang berkas yang sudah tidak ada.
 */
test("HAPUS: foto dan sidecar-nya dibuang sebagai satu unit", async () => {
  const { saveUniqueProductImages, deleteStoredProductImages } = await import("../lib/product-images");
  isi.clear();
  const rels = await saveUniqueProductImages(`hapus-${process.pid}`, [
    { mime: "image/png", data: await fotoPolos() },
    { mime: "image/png", data: await fotoPolos() },
  ]);
  assert.equal(isi.size, 4, "prasyarat: dua foto plus dua sidecar");

  await deleteStoredProductImages(rels);
  assert.deepEqual(
    [...isi.keys()],
    [],
    `sisa objek sesudah penghapusan: ${JSON.stringify([...isi.keys()])} — sidecar tertinggal yatim`
  );
});

test("HAPUS: foto warisan tanpa sidecar tetap bisa dihapus tanpa error", async () => {
  // Foto dari sebelum P0-B1 tidak punya sidecar. Menghapus kunci yang tidak ada
  // wajib aman di kedua backend (`rm --force`; S3 DeleteObject atas kunci yang
  // tidak ada tetap sukses) — kalau tidak, penghapusan foto warisan akan
  // meledak di tangan pengguna.
  const { deleteStoredProductImages } = await import("../lib/product-images");
  isi.clear();
  isi.set("uploads/warisan/0.webp", Buffer.from("BYTES-WARISAN"));
  await deleteStoredProductImages(["uploads/warisan/0.webp"]);
  assert.deepEqual([...isi.keys()], []);
});

// ------------------------------------------------------- kontrol positif

test("KONTROL: dengan biner sungguhan, foto polos dari SETIAP jalur benar-benar TERSETUJUI", async (t) => {
  // Tanpa kontrol ini, seluruh berkas ini bisa hijau dengan implementasi yang
  // menulis sidecar `belum_diperiksa` untuk segalanya — bukti yang sah
  // bentuknya, tapi tidak pernah meloloskan satu foto pun.
  if (!punyaOcr()) return t.skip("ffmpeg/ffprobe/tesseract tidak ada di mesin ini");
  const { saveProductImages, saveUniqueProductImages } = await import("../lib/product-images");
  const { downloadProductImages } = await import("../lib/product-image-download");
  const png = await fotoPolos();

  const jalur: [string, () => Promise<string[]>][] = [
    ["saveProductImages", () => saveProductImages(`k-retail-${process.pid}`, [{ mime: "image/png", data: png }])],
    ["saveUniqueProductImages", () => saveUniqueProductImages(`k-org-${process.pid}`, [{ mime: "image/png", data: png }])],
    [
      "downloadProductImages",
      async () => {
        const fetchAsli = globalThis.fetch;
        globalThis.fetch = (async () =>
          new Response(new Uint8Array(png), { status: 200, headers: { "content-type": "image/png" } })) as typeof fetch;
        try {
          return await downloadProductImages(`k-unduh-${process.pid}`, ["https://contoh.test/a.png"]);
        } finally {
          globalThis.fetch = fetchAsli;
        }
      },
    ],
  ];

  for (const [nama, jalankan] of jalur) {
    isi.clear();
    const rels = await jalankan();
    const hasil = await resolveApprovedReference(rels);
    assert.deepEqual(
      hasil.tersetujui.map((r) => r.rel),
      rels,
      `${nama}: foto polos tidak tersetujui padahal binernya ada. Ditolak: ` +
        JSON.stringify(hasil.ditolak.map((d) => [d.rel, d.alasan]))
    );
  }
});
