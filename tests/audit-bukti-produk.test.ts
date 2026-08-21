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
import type { HasilKolomRusak, ProdukUntukAudit } from "../lib/audit-bukti-produk";

process.env.RACUN_NO_DOTENV = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "audit-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const { auditBuktiProduk, laporanAudit, bacaKolomImages, KOLOM_RUSAK } = await import("../lib/audit-bukti-produk");
const { kunciStorageSah } = await import("../lib/storage");

/**
 * Membaca kolom yang HARUS rusak.
 *
 * `ProdukUntukAudit.images` sengaja tidak menerima bentuk `{ok:true}`, jadi
 * hasil baca tidak bisa diserahkan apa adanya. Pembungkus ini sekaligus
 * memastikan fixture-nya memang rusak: fixture "rusak" yang ternyata sah akan
 * membuat test lulus tanpa menguji apa pun.
 */
function kolomRusak(mentah: unknown): HasilKolomRusak {
  const h = bacaKolomImages(mentah);
  assert.equal(h.ok, false, `fixture yang seharusnya rusak ternyata sah: ${String(mentah)}`);
  return h as HasilKolomRusak;
}
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

// ---------------------------------------------------------------------------
// KOLOM images RUSAK vs PRODUK TANPA FOTO
//
// Versi pertama membaca kolom `images` di dalam skrip CLI dan mengembalikan
// `[]` saat parse gagal. Produk itu lalu masuk ember "tanpa foto" dan MELEWATI
// resolver sepenuhnya. Akibatnya cacah terbrick dan seluruh rincian kerusakan
// terlalu rendah — persis pada baris yang paling perlu dilihat manusia — dan
// komentar di atasnya mengklaim hal sebaliknya.
//
// Keduanya menghasilkan nol foto; artinya berlawanan. Tanpa foto = tidak ada
// yang rusak. Kolom rusak = kita TIDAK TAHU berapa yang rusak.
// ---------------------------------------------------------------------------

test("KOLOM: JSON korup TIDAK boleh terbaca sebagai daftar kosong", () => {
  assert.deepEqual(bacaKolomImages("{bukan json"), {
    ok: false,
    sebab: KOLOM_RUSAK.JSON_KORUP,
    contoh: "{bukan json",
  });
  assert.deepEqual(bacaKolomImages('["a.webp",'), { ok: false, sebab: KOLOM_RUSAK.JSON_KORUP, contoh: '["a.webp",' });
});

test("KOLOM: JSON SAH tapi bukan array adalah kerusakan tersendiri", () => {
  // JSON.parse berhasil, jadi kegagalan ini tidak akan pernah tertangkap oleh
  // try/catch — satu-satunya yang menangkapnya adalah pemeriksaan bentuk.
  for (const mentah of ['{"0":"a.webp"}', '"a.webp"', "5", "null", "true"]) {
    const h = bacaKolomImages(mentah);
    assert.equal(h.ok, false, `bentuk non-array diterima: ${mentah}`);
    if (!h.ok) assert.equal(h.sebab, KOLOM_RUSAK.BUKAN_ARRAY, mentah);
  }
});

test("KOLOM: elemen bukan-teks tidak boleh DISARING diam-diam", () => {
  // Menyaringnya akan menghilangkan foto dari cacah tanpa satu pun tanda —
  // kerusakan yang sama, sekadar lebih halus.
  const h = bacaKolomImages('["a.webp", 42]');
  assert.equal(h.ok, false, "elemen bukan-teks disaring diam-diam; satu foto hilang dari cacah tanpa tanda");
  if (!h.ok) assert.equal(h.sebab, KOLOM_RUSAK.ELEMEN_BUKAN_TEKS);
});

test("KOLOM: HANYA `[]` yang berarti 'tidak punya foto'", () => {
  // Versi sebelumnya menerima "", "   ", null, dan undefined sebagai daftar
  // kosong yang sah — dan testnya MENGUNCI perilaku keliru itu. Kedua skema
  // menyatakan `images TEXT NOT NULL DEFAULT '[]'`: kolom kosong yang sah
  // berbentuk teks JSON `[]`. NULL melanggar NOT NULL; string kosong tidak
  // pernah ditulis satu pun jalur ingestion. Menyebut keduanya "tanpa foto"
  // membuat cacah kerusakan kembali terlalu rendah.
  assert.deepEqual(bacaKolomImages("[]"), { ok: true, images: [] });
  assert.deepEqual(bacaKolomImages('["a.webp","b.webp"]'), { ok: true, images: ["a.webp", "b.webp"] });
  assert.deepEqual(bacaKolomImages(["a.webp"]), { ok: true, images: ["a.webp"] });

  for (const [mentah, label] of [
    ["", "string kosong"],
    ["   ", "whitespace"],
  ] as const) {
    const h = bacaKolomImages(mentah);
    assert.equal(h.ok, false, `${label} diterima sebagai daftar kosong yang sah`);
    if (!h.ok) assert.equal(h.sebab, KOLOM_RUSAK.KOSONG, label);
  }
  for (const [mentah, contoh] of [
    [null, "NULL"],
    [undefined, "undefined"],
  ] as const) {
    const h = bacaKolomImages(mentah);
    assert.equal(h.ok, false, `${contoh} diterima sebagai daftar kosong yang sah`);
    if (!h.ok) assert.deepEqual([h.sebab, h.contoh], [KOLOM_RUSAK.KOSONG, contoh]);
  }
});

// ---------------------------------------------------------------------------
// ELEMEN HARUS KUNCI STORAGE YANG SAH
//
// `typeof x === "string"` tidak cukup. `["../x.webp"]` lolos, diteruskan ke
// resolver, dan storage MELEMPAR "Invalid storage object key" — satu baris
// korup menghentikan seluruh audit dan tidak ada satu angka pun dihasilkan.
// Data legacy justru tempat baris seperti itu tinggal.
// ---------------------------------------------------------------------------

test("KOLOM: elemen yang bukan kunci storage sah adalah KERUSAKAN, bukan foto", () => {
  // Catatan: `"/x.webp"` dan `"   "` TIDAK ada di daftar ini. safeKey membuang
  // garis miring di depan, dan whitespace adalah nama berkas yang sah — jadi
  // storage menerima keduanya, dan audit yang MEMINJAM kontraknya wajib ikut
  // menerimanya. Keduanya berakhir sebagai REF_MISSING, vonis yang benar dan
  // bisa ditindaklanjuti. Menebak lebih ketat dari kontrak sebenarnya adalah
  // cara lain audit berbohong; kedua kunci itu dijaga oleh test silang di bawah.
  for (const mentah of ['["../x.webp"]', '["a/../../x.webp"]', '[""]', '["a//b.webp"]', '["./x.webp"]']) {
    const h = bacaKolomImages(mentah);
    assert.equal(h.ok, false, `elemen bukan kunci sah diterima: ${mentah}`);
    if (!h.ok) assert.equal(h.sebab, KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI, mentah);
  }
  // Satu elemen busuk membusukkan barisnya: kita tidak tahu daftar itu masih
  // menggambarkan apa, jadi menilai sisanya berarti menebak.
  const campur = bacaKolomImages('["p1/0.webp","../x.webp"]');
  assert.equal(campur.ok, false, "daftar dengan satu elemen busuk diteruskan sebagian ke resolver");
});

test("KOLOM: kontrak kunci DIPINJAM dari storage, bukan disalin", () => {
  // Aturan yang disalin akan menyimpang diam-diam: audit melaporkan kunci sah
  // yang sebenarnya ditolak storage, atau sebaliknya. Test ini menyilangkan
  // keputusan parser dengan predikat storage yang memanggil safeKey yang sama.
  const contoh = ["p1/0.webp", "a/b/c.webp", "../x.webp", "/x.webp", "   ", "", "a//b.webp", "./x.webp", "a/../b.webp"];
  for (const k of contoh) {
    const lewatParser = bacaKolomImages(JSON.stringify([k])).ok;
    assert.equal(lewatParser, kunciStorageSah(k), `parser dan storage tidak sepakat soal ${JSON.stringify(k)}`);
  }
});

test("AUDIT: satu baris yang melempar TIDAK boleh menihilkan seluruh laporan", async () => {
  // Sifat yang dijaga bukan "jalur safeKey" tapi "alat ini SELALU keluar dengan
  // angka". Audit yang mati di baris ke-9.000 dari 10.000 memberi nol informasi.
  pasangPustaka();
  const meledak = { ...isi };
  void meledak;
  const asli = isi.get.bind(isi);
  isi.get = ((k: string) => {
    if (k.startsWith("boom/")) throw new Error("Invalid storage object key");
    return asli(k);
  }) as typeof isi.get;
  try {
    const h = await auditBuktiProduk([
      { id: "p1", images: ["p1/0.webp"], nama: "sah" },
      { id: "boom", images: ["boom/0.webp"], nama: "meledak", orgId: "org-3" },
      { id: "p3", images: ["p3/0.webp"], nama: "sidecar hilang" },
    ]);
    assert.equal(h.produk, 3, "audit berhenti sebelum baris terakhir");
    assert.equal(h.produkGagalDiperiksa, 1);
    assert.equal(h.gagalDiperiksa[0].id, "boom");
    assert.equal(h.gagalDiperiksa[0].orgId, "org-3");
    assert.match(h.gagalDiperiksa[0].pesan, /Invalid storage object key/);
    assert.equal(h.produkTerbrick, 1, "baris SESUDAH yang meledak tidak ikut dinilai");
    assert.equal(h.foto, 2, "foto dari baris yang gagal diperiksa ikut dihitung padahal tidak dinilai");
    assert.ok(laporanAudit(h).includes("GAGAL DIPERIKSA"), "laporan menyembunyikan baris yang tidak bisa dinilai");
  } finally {
    isi.get = asli;
  }
});

test("KOLOM: potongan mentah dibawa ke laporan tapi dipotong", () => {
  const panjang = "x".repeat(400);
  const h = bacaKolomImages(panjang);
  assert.equal(h.ok, false);
  if (!h.ok) {
    assert.ok(h.contoh.length <= 121, `contoh tidak dipotong (${h.contoh.length}); laporan bisa dibanjiri satu baris`);
    assert.ok(h.contoh.startsWith("xxxx"), "contoh tidak menunjukkan nilai aslinya, jadi barisnya tidak bisa dikenali");
  }
});

test("AUDIT: kolom rusak masuk ember SENDIRI — bukan tanpa-foto, bukan terbrick", async () => {
  pasangPustaka();
  const h = await auditBuktiProduk([
    { id: "p1", images: ["p1/0.webp"], nama: "sah" },
    { id: "r1", images: kolomRusak("{bukan json"), nama: "korup", orgId: "org-9" },
    { id: "r2", images: kolomRusak('{"0":"a.webp"}'), nama: "bukan array" },
    { id: "r3", images: kolomRusak('["a.webp", 42]'), nama: "elemen salah" },
    { id: "k1", images: [], nama: "tanpa foto" },
  ]);

  assert.equal(h.produk, 5);
  assert.equal(h.produkKolomRusak, 3, "kolom rusak tidak dihitung");
  assert.equal(
    h.produkTanpaFoto,
    1,
    "kolom rusak ikut dihitung sebagai produk tanpa foto — kerusakan menyamar jadi kekosongan, dan cacah kerusakan jadi terlalu rendah"
  );
  assert.equal(h.produkTerbrick, 0, "kolom rusak disebut terbrick; gerbang bukti bukan penyebabnya");
  assert.equal(h.foto, 1, "foto dari kolom yang tidak terbaca ikut dihitung — jumlahnya tidak diketahui siapa pun");
  assert.deepEqual(h.perKolomRusak, {
    [KOLOM_RUSAK.JSON_KORUP]: 1,
    [KOLOM_RUSAK.BUKAN_ARRAY]: 1,
    [KOLOM_RUSAK.ELEMEN_BUKAN_TEKS]: 1,
  });
});

test("AUDIT: produk kolom rusak disebut ID-nya — hanya manusia yang bisa memperbaikinya", async () => {
  pasangPustaka();
  const h = await auditBuktiProduk([{ id: "r1", images: kolomRusak("{bukan json"), nama: "korup", orgId: "org-9" }]);
  assert.deepEqual(h.kolomRusak, [
    { id: "r1", nama: "korup", orgId: "org-9", sebab: KOLOM_RUSAK.JSON_KORUP, contoh: "{bukan json" },
  ]);

  const teks = laporanAudit(h);
  assert.match(teks, /KOLOM images RUSAK\s*:\s*1/, "laporan tidak menyebut ember kolom rusak");
  assert.ok(teks.includes("r1"), "laporan tidak menyebut produk yang kolomnya rusak");
  assert.ok(teks.includes(KOLOM_RUSAK.JSON_KORUP), "laporan tidak menyebut sebab yang bisa ditindaklanjuti");
  assert.ok(teks.includes("org-9"), "laporan tidak menyebut organisasi pemilik");
});

test("AUDIT: orgId dipertahankan di daftar terbrick", async () => {
  // Tanpa ini seluruh entri Enterprise dilaporkan tanpa pemilik, dan daftar
  // terbrick tidak bisa dibagikan ke siapa pun yang berwenang memperbaikinya.
  pasangPustaka();
  const h = await auditBuktiProduk([{ id: "p3", images: ["p3/0.webp"], nama: "sidecar hilang", orgId: "org-7" }]);
  assert.equal(h.produkTerbrick, 1);
  assert.equal(h.terbrick[0].orgId, "org-7");
  assert.ok(laporanAudit(h).includes("org-7"), "laporan terbrick tidak menyebut organisasi pemilik");
});

test("AUDIT: batas daftar juga berlaku untuk kolom rusak, tanpa mengubah CACAHNYA", async () => {
  pasangPustaka();
  const rusak = Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, images: kolomRusak("{x") }));
  const h = await auditBuktiProduk(rusak, { simpanTerbrick: 2 });
  assert.equal(h.produkKolomRusak, 5, "cacah kolom rusak ikut terpotong oleh batas daftar");
  assert.equal(h.kolomRusak.length, 2, "batas daftar tidak diterapkan pada kolom rusak");
});

test("AUDIT: array yang diserahkan LANGSUNG tetap lewat validasi kunci — tidak ada jalan memutar", async () => {
  // `ProdukUntukAudit.images` menerima `string[]` sebagai kemudahan. Kemudahan
  // itu sempat jadi pintu kedua: array dibungkus `{ok:true}` di boundary audit,
  // sehingga kunci tidak sah melewati validasi yang dipasang di parser, dan
  // vonisnya bergantung pada adapter storage mana yang kebetulan terpasang.
  pasangPustaka();
  const h = await auditBuktiProduk([
    { id: "p1", images: ["p1/0.webp"], nama: "sah" },
    { id: "t1", images: ["../rahasia.webp"], nama: "traversal", orgId: "org-2" },
    { id: "t2", images: ["p1/0.webp", ""], nama: "elemen kosong" },
    { id: "t3", images: [42 as unknown as string], nama: "bukan teks" },
  ]);

  assert.equal(
    h.produkKolomRusak,
    3,
    "array yang diserahkan langsung melewati validasi kunci — perbaikan yang punya jalan memutar bukan perbaikan"
  );
  assert.equal(h.produkGagalDiperiksa, 0, "kunci tidak sah baru tertangkap saat storage melempar, bukan saat dibaca");
  assert.deepEqual(h.perKolomRusak, {
    [KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI]: 2,
    [KOLOM_RUSAK.ELEMEN_BUKAN_TEKS]: 1,
  });
  assert.deepEqual(
    h.kolomRusak.map((k) => [k.id, k.sebab, k.orgId]),
    [
      ["t1", KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI, "org-2"],
      ["t2", KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI, null],
      ["t3", KOLOM_RUSAK.ELEMEN_BUKAN_TEKS, null],
    ]
  );
  assert.equal(h.produkTerbrick, 0, "baris yang kolomnya rusak diberi vonis terbrick");
  assert.equal(h.produk, 4, "audit berhenti sebelum baris terakhir");
});

test("AUDIT: pembungkus `ok:true` yang diselundupkan TETAP divalidasi ulang", async () => {
  // Kontrak `ProdukUntukAudit.images` sudah melarang bentuk ini — baris di
  // bawah hanya bisa ditulis dengan `as`, dan itulah intinya: tipe mengikat
  // pemanggil TypeScript, TIDAK mengikat pemanggil JavaScript, `as`, atau JSON
  // yang di-cast. Daftar yang MENGAKU sudah sah diperiksa ulang, bukan
  // dipercaya; kalau tidak, vonisnya kembali bergantung pada adapter storage
  // mana yang kebetulan terpasang.
  const selundup = (images: unknown[]) => ({ ok: true, images }) as unknown as ProdukUntukAudit["images"];

  pasangPustaka();
  const h = await auditBuktiProduk([
    { id: "p1", images: ["p1/0.webp"], nama: "sah" },
    { id: "w1", images: selundup(["../rahasia.webp"]), nama: "traversal", orgId: "org-2" },
    { id: "w2", images: selundup(["p1/0.webp", ""]), nama: "elemen kosong" },
    { id: "w3", images: selundup([42]), nama: "bukan teks" },
    { id: "w4", images: selundup(["p1/0.webp"]), nama: "selundupan yang SAH" },
  ]);

  assert.equal(
    h.produkKolomRusak,
    3,
    "pembungkus `ok:true` dipercaya tanpa validasi ulang — satu jalur publik kembali melewati kontrak kunci"
  );
  assert.equal(
    h.produkGagalDiperiksa,
    0,
    "kunci tidak sah baru tertangkap saat storage melempar; vonisnya jadi bergantung pada adapter"
  );
  assert.deepEqual(h.perKolomRusak, {
    [KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI]: 2,
    [KOLOM_RUSAK.ELEMEN_BUKAN_TEKS]: 1,
  });
  assert.deepEqual(h.kolomRusak.map((k) => [k.id, k.sebab, k.orgId]), [
    ["w1", KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI, "org-2"],
    ["w2", KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI, null],
    ["w3", KOLOM_RUSAK.ELEMEN_BUKAN_TEKS, null],
  ]);
  // Arah sebaliknya: validasi ulang tidak boleh MENOLAK daftar yang memang sah.
  assert.equal(h.produkTerbrick, 0, "w4 berisi kunci yang sah dan foto yang tersetujui");
  assert.equal(h.fotoTersetujui, 2, "p1 dan w4");
});
