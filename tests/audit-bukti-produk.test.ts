// P0-B3 — AUDIT BUKTI PRODUK: menghitung kerusakan SEBELUM gerbang menyala.
//
// Pertanyaan yang dijawab audit: kalau penegakan bukti dinyalakan hari ini,
// berapa produk yang berhenti bisa dirender, dan kenapa masing-masing?
//
// Test ini menguntci tiga hal yang membuat jawabannya bisa dipercaya:
//
//   1. HAKIMNYA RESOLVER YANG SAMA. Audit yang menilai dengan aturan tandingan
//      akan melaporkan angka yang tidak pernah cocok dengan apa yang terjadi
//      saat gerbang benar-benar menyala. Diuji dengan menyilangkan hasil audit
//      terhadap `resolveApprovedReference` langsung.
//   2. HANYA BACA. Nol tulis ke storage. Audit yang memperbaiki sambil
//      menghitung tidak bisa dijalankan dua kali dan angkanya tidak bisa
//      direproduksi siapa pun.
//   3. SEBAB DIPISAH. Satu angka "bukti tidak sah" membuat keputusan pemulihan
//      mustahil diambil: sidecar HILANG bisa diterbitkan ulang dari bytes yang
//      masih ada, KORUP menandakan storage bermasalah, VERSI berarti satu
//      angkatan bukti perlu direvalidasi.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "audit-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const { auditBuktiProduk, laporanAudit } = await import("../lib/audit-bukti-produk");
const { resolveApprovedReference, ALASAN_TOLAK, RINCI_TOLAK } = await import("../lib/product-truth");

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const PACKSHOT = Buffer.from("BYTES-PACKSHOT-AUDIT");
const BANNER = Buffer.from("BYTES-BANNER-AUDIT");

function sidecar(bytes: Buffer, ubah: Record<string, unknown> = {}): Buffer {
  return Buffer.from(
    JSON.stringify({
      sha256: sha(bytes),
      jenis: "product_photo",
      layakReferensi: true,
      rasioAreaTeks: 0.004,
      jumlahKata: 2,
      alasan: "foto produk",
      versiBukti: 1,
      ...ubah,
    })
  );
}

const isi = new Map<string, Buffer>();
const tulisan: string[] = [];
setMediaStorageForTests({
  async put(key: string, body: Buffer) {
    tulisan.push(key);
    isi.set(key, body);
  },
  async delete(key: string) {
    isi.delete(key);
  },
  async get(key: string) {
    const body = isi.get(key);
    return body ? { body, size: body.length } : null;
  },
  async stat(key: string) {
    const body = isi.get(key);
    return body ? { size: body.length } : null;
  },
  async materialize() {
    throw new Error("audit tidak boleh mengambil payload");
  },
} as never);

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

/** Satu pustaka sintetis yang memuat SETIAP keadaan yang bisa ditemui audit. */
function pasangPustaka() {
  isi.clear();
  tulisan.length = 0;

  // sah
  isi.set("p1/0.webp", PACKSHOT);
  isi.set("p1/0.webp.meta.json", sidecar(PACKSHOT));
  // banner (diperiksa, memang promosi)
  isi.set("p2/0.webp", BANNER);
  isi.set(
    "p2/0.webp.meta.json",
    sidecar(BANNER, { jenis: "promotional_graphic", layakReferensi: false, rasioAreaTeks: 0.21, jumlahKata: 15 })
  );
  // sidecar hilang
  isi.set("p3/0.webp", PACKSHOT);
  // sidecar korup
  isi.set("p4/0.webp", PACKSHOT);
  isi.set("p4/0.webp.meta.json", Buffer.from("{bukan json"));
  // versi tidak cocok
  isi.set("p5/0.webp", PACKSHOT);
  isi.set("p5/0.webp.meta.json", sidecar(PACKSHOT, { versiBukti: 0 }));
  // hash beda
  isi.set("p6/0.webp", Buffer.from("BYTES-DITUKAR"));
  isi.set("p6/0.webp.meta.json", sidecar(PACKSHOT));
  // bytes hilang, sidecar ada
  isi.set("p7/0.webp.meta.json", sidecar(PACKSHOT));
  // belum diperiksa
  isi.set("p8/0.webp", PACKSHOT);
  isi.set(
    "p8/0.webp.meta.json",
    sidecar(PACKSHOT, { jenis: "belum_diperiksa", layakReferensi: false, rasioAreaTeks: 0, jumlahKata: 0 })
  );
  // bentuk salah
  isi.set("p9/0.webp", PACKSHOT);
  isi.set("p9/0.webp.meta.json", sidecar(PACKSHOT, { layakReferensi: "true" }));
  // satu produk dengan DUA foto: banner + packshot sah -> TIDAK terbrick
  isi.set("p10/0.webp", BANNER);
  isi.set(
    "p10/0.webp.meta.json",
    sidecar(BANNER, { jenis: "promotional_graphic", layakReferensi: false, rasioAreaTeks: 0.21, jumlahKata: 15 })
  );
  isi.set("p10/1.webp", PACKSHOT);
  isi.set("p10/1.webp.meta.json", sidecar(PACKSHOT));
}

const pustaka = [
  { id: "p1", images: ["p1/0.webp"], nama: "sah" },
  { id: "p2", images: ["p2/0.webp"], nama: "banner" },
  { id: "p3", images: ["p3/0.webp"], nama: "sidecar hilang" },
  { id: "p4", images: ["p4/0.webp"], nama: "sidecar korup" },
  { id: "p5", images: ["p5/0.webp"], nama: "versi" },
  { id: "p6", images: ["p6/0.webp"], nama: "hash beda" },
  { id: "p7", images: ["p7/0.webp"], nama: "bytes hilang" },
  { id: "p8", images: ["p8/0.webp"], nama: "belum diperiksa" },
  { id: "p9", images: ["p9/0.webp"], nama: "bentuk salah" },
  { id: "p10", images: ["p10/0.webp", "p10/1.webp"], nama: "banner + sah" },
  { id: "p11", images: [], nama: "tanpa foto" },
];

test("AUDIT: menghitung terbrick, dan produk tanpa foto TIDAK dihitung terbrick", async () => {
  pasangPustaka();
  const h = await auditBuktiProduk(pustaka);

  assert.equal(h.produk, 11);
  assert.equal(h.produkTanpaFoto, 1, "produk tanpa foto wajib dihitung terpisah");
  // p1 dan p10 punya referensi tersetujui; p11 tanpa foto. Sisanya terbrick.
  assert.equal(h.produkTerbrick, 8, `terbrick=${h.produkTerbrick}, daftar=${JSON.stringify(h.terbrick.map((t) => t.id))}`);
  assert.ok(
    !h.terbrick.some((t) => t.id === "p11"),
    "produk tanpa foto disebut terbrick — ia memang belum pernah bisa dirender, jadi gerbang bukti " +
      "tidak mengubah apa pun untuknya. Mencampurnya menggelembungkan angka kerusakan dengan " +
      "kerusakan yang bukan disebabkan perubahan ini."
  );
  assert.ok(!h.terbrick.some((t) => t.id === "p10"), "produk dengan satu foto sah tidak boleh disebut terbrick");
  assert.equal(h.foto, 11, "p11 tidak menyumbang foto");
  assert.equal(h.fotoTersetujui, 2, "hanya p1/0 dan p10/1 yang tersetujui");
});

test("AUDIT: sebab dipisah — satu angka gabungan tidak bisa ditindaklanjuti", async () => {
  pasangPustaka();
  const h = await auditBuktiProduk(pustaka);

  assert.equal(h.perAlasan[ALASAN_TOLAK.PROMOSI], 2, "p2 dan p10/0");
  assert.equal(h.perAlasan[ALASAN_TOLAK.BERKAS_HILANG], 1, "p7");
  assert.equal(h.perAlasan[ALASAN_TOLAK.HASH_BEDA], 1, "p6");
  assert.equal(h.perAlasan[ALASAN_TOLAK.BELUM_DIPERIKSA], 1, "p8");
  assert.equal(h.perAlasan[ALASAN_TOLAK.BUKTI_TIDAK_SAH], 4, "p3, p4, p5, p9");

  assert.deepEqual(
    {
      hilang: h.perRinci[RINCI_TOLAK.SIDECAR_HILANG],
      korup: h.perRinci[RINCI_TOLAK.SIDECAR_KORUP],
      versi: h.perRinci[RINCI_TOLAK.VERSI_TIDAK_COCOK],
      bentuk: h.perRinci[RINCI_TOLAK.BENTUK_SALAH],
    },
    { hilang: 1, korup: 1, versi: 1, bentuk: 1 },
    "keempat sebab EVIDENCE_INVALID wajib terpisah: tindakan pemulihannya berbeda"
  );
});

test("AUDIT: HANYA BACA — nol tulis ke storage", async () => {
  pasangPustaka();
  await auditBuktiProduk(pustaka);
  assert.deepEqual(
    tulisan,
    [],
    `audit menulis ke storage: ${JSON.stringify(tulisan)}. Audit yang memperbaiki sambil menghitung ` +
      "tidak bisa dijalankan dua kali dan angkanya tidak bisa direproduksi siapa pun."
  );
});

test("AUDIT: hakimnya resolver yang SAMA, bukan aturan tandingan", async () => {
  // Kalau audit menilai dengan aturannya sendiri, angkanya tidak akan pernah
  // cocok dengan apa yang terjadi saat gerbang benar-benar menyala.
  pasangPustaka();
  const h = await auditBuktiProduk(pustaka);
  let tersetujuiLangsung = 0;
  for (const p of pustaka) {
    if (p.images.length === 0) continue;
    tersetujuiLangsung += (await resolveApprovedReference(p.images)).tersetujui.length;
  }
  assert.equal(h.fotoTersetujui, tersetujuiLangsung, "audit dan resolver memberi jawaban berbeda");
});

test("AUDIT: laporan menyebut sebab per produk yang akan terbrick", async () => {
  pasangPustaka();
  const teks = laporanAudit(await auditBuktiProduk(pustaka));
  assert.match(teks, /AKAN TERBRICK\s*:\s*8/);
  assert.ok(teks.includes(RINCI_TOLAK.SIDECAR_HILANG), "laporan tidak menyebut sebab yang bisa ditindaklanjuti");
  assert.ok(teks.includes("p3"), "laporan tidak menyebut produk yang terbrick");
});

test("AUDIT: batas daftar terbrick tidak mengubah CACAHNYA", async () => {
  // Laporan boleh dipotong; angkanya tidak boleh. Cacah yang ikut terpotong
  // adalah cara audit berbohong tanpa berbohong.
  pasangPustaka();
  const h = await auditBuktiProduk(pustaka, { simpanTerbrick: 2 });
  assert.equal(h.produkTerbrick, 8, "cacah terbrick ikut terpotong oleh batas daftar");
  assert.equal(h.terbrick.length, 2, "batas daftar tidak diterapkan");
});
