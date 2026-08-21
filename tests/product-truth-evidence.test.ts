// P0-03 RED WAVE R2 (P0-A) — kontrak BUKTI (C8) di pusat: referensiLayak().
//
// STATUS YANG DIHARAPKAN: MERAH pada 0c443ff.
// Kode sekarang FAIL-OPEN: `referensiLayak` mendorong rel ke daftar layak
// setiap kali sidecar tidak ada / tidak terbaca (`if (!meta || meta.layakReferensi)`,
// lib/product-images.ts:144), dan ia TIDAK PERNAH memverifikasi ulang sha256
// sidecar terhadap bytes yang benar-benar tersimpan, juga tidak mengenal
// versi bukti sama sekali (MetaGambar, lib/product-images.ts:98-105).
//
// Yang diuji di sini adalah KEPUTUSAN, bukan implementasi: bukti hilang /
// korup / basi / hash beda => gambar TIDAK boleh keluar dari referensiLayak.
//
// KONTRAK BUKTI TIDAK SAH — DIPILIH SATU, BUKAN TIGA (temuan Reviewer 21 Agu).
//
// Versi R1 menulis "daftar kosong, throw, atau reason code — urusan
// implementasi". Itu bukan kontrak, itu tiga kontrak yang saling bertabrakan:
// pemanggil yang menyiapkan try/catch akan meledak kalau resolver memilih
// daftar kosong, dan pemanggil yang memeriksa `.length` akan melewatkan
// throw. Ditetapkan sekarang, dan seluruh test + pemanggil diselaraskan ke ini:
//
//   1. RESOLVER TIDAK PERNAH MELEMPAR untuk bukti tidak sah. Bukti tidak sah
//      adalah keadaan data yang normal dan terduga, bukan kondisi luar biasa.
//      Yang boleh melempar hanya kegagalan infrastruktur (storage mati).
//   2. Bukti tidak sah = gambarnya TIDAK muncul di daftar tersetujui.
//      `referensiLayak([...])` mengembalikan daftar tanpa gambar itu; kalau
//      tidak ada satu pun yang sah, hasilnya `[]`.
//   3. Alasan penolakan per gambar tetap dilaporkan (reason code) supaya
//      pemanggil bisa memberi pesan yang bisa ditindaklanjuti — tapi ia
//      dilaporkan sebagai DATA, bukan sebagai exception.
//   4. GAGAL-TERTUTUP ADALAH TUGAS PEMANGGIL. Worker yang tidak mendapat
//      referensi tersetujui wajib berhenti SEBELUM langkah berbayar. Itu
//      diuji di tests/product-truth-worker-reference.test.ts, bukan di sini.
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

/**
 * TIPE FIELD SALAH — SATU FIELD RUSAK PER FIXTURE, bukan dua sekaligus.
 *
 * Versi sebelumnya menggabungkan `layakReferensi: "false"` DAN
 * `rasioAreaTeks: "0.19"` dalam satu sidecar. Temuan Reviewer 21 Agu, dan ia
 * benar: implementasi yang hanya memvalidasi `rasioAreaTeks` akan menolak
 * fixture gabungan itu dan MENGHIJAUKAN test — sambil tetap menerima
 * `layakReferensi` bertipe string setiap kali rasionya kebetulan angka. Persis
 * perilaku truthy yang test ini ada untuk menguncinya.
 *
 * Jadi setiap fixture di bawah merusak TEPAT SATU field; seluruh field lain
 * sah. Test yang hijau karena alasan yang salah tidak bisa dibedakan dari test
 * yang hijau karena alasan yang benar, kecuali fixture-nya memaksa demikian.
 *
 * `layakReferensi: "false"` adalah yang paling berbahaya dan karena itu berdiri
 * sendiri: di JavaScript string "false" itu TRUTHY, jadi `if (meta.layakReferensi)`
 * membaca bukti 180 derajat terbalik dari isinya sendiri.
 */
function sidecarDenganField(ubah: Record<string, unknown>): Buffer {
  return Buffer.from(
    JSON.stringify({
      sha256: sha(PACKSHOT),
      jenis: "product_photo",
      layakReferensi: true,
      rasioAreaTeks: 0.004,
      jumlahKata: 2,
      alasan: "foto produk",
      versiBukti: VERSI_BUKTI_TERKINI,
      ...ubah,
    })
  );
}

const fieldTakSah: { judul: string; ubah: Record<string, unknown>; kenapa: string }[] = [
  {
    judul: 'layakReferensi STRING "false"',
    ubah: { layakReferensi: "false" },
    kenapa: 'string "false" TRUTHY — bukti dibaca terbalik dari isinya sendiri',
  },
  {
    judul: "layakReferensi ANGKA 1",
    ubah: { layakReferensi: 1 },
    kenapa: "angka truthy lolos pemeriksaan kebenaran, padahal kontraknya boolean",
  },
  {
    judul: "rasioAreaTeks STRING",
    ubah: { rasioAreaTeks: "0.004" },
    kenapa: "perbandingan ambang atas string memaksa coercion diam-diam",
  },
  {
    judul: "jumlahKata STRING",
    ubah: { jumlahKata: "2" },
    kenapa: "sama: ambang dibandingkan terhadap tipe yang salah",
  },
  {
    judul: "sha256 bukan string",
    ubah: { sha256: 12345 },
    kenapa: "hash yang bukan string tidak bisa dibandingkan dengan digest bytes",
  },
  {
    judul: "sha256 panjangnya salah",
    ubah: { sha256: "abc123" },
    kenapa: "digest sha256 selalu 64 hex; yang lain bukan hash apa pun",
  },
  {
    judul: "jenis di luar enum",
    ubah: { jenis: "banner" },
    kenapa: "nilai jenis yang tidak dikenal berarti bukti ditulis aturan lain",
  },
  {
    judul: "alasan bukan string",
    ubah: { alasan: 42 },
    kenapa: "alasan dipakai untuk pesan ke pengguna; tipe salah = pesan rusak",
  },
];

/**
 * BUKTI YANG BERTENTANGAN DENGAN DIRINYA SENDIRI — seluruh tipe SAH.
 *
 * Temuan Reviewer ronde 3, dan ia menutup celah yang fixture tipe di atas
 * tidak bisa tutup: implementasi yang memvalidasi seluruh tipe, hash, dan versi
 * dengan benar TAPI memutuskan kelayakan dari `layakReferensi === true` saja
 * akan lulus SEMUA test sekarang — sambil meloloskan sidecar
 * `{jenis:"promotional_graphic", layakReferensi:true}`. Yaitu: banner, yang
 * buktinya sendiri menyebut dirinya banner, dikirim ke model sebagai acuan
 * "beginilah rupa produknya".
 *
 * Kedua arah diuji, dan keduanya EVIDENCE_INVALID — bukan REF_PROMOTIONAL:
 * ketika dua field bukti saling membantah, tidak ada satu pun dari keduanya
 * yang bisa dipercaya sebagai vonis. Melaporkannya sebagai "promosi" berarti
 * memilih salah satu field secara sewenang-wenang; melaporkannya sebagai bukti
 * tidak sah menyatakan yang sebenarnya terjadi, dan itulah yang membuat
 * karantina/revalidasi bisa menanganinya nanti.
 */
/**
 * AMBANG CLASSIFIER VERSI 1 — disalin dari lib/media/klasifikasi-gambar.ts.
 *
 *     AMBANG_RASIO = 0.02        AMBANG_KATA = 6
 *     promosi = rasioAreaTeks >= AMBANG_RASIO || jumlahKata >= AMBANG_KATA
 *
 * Disalin, bukan diimpor, karena konstantanya tidak diekspor.
 *
 * KOREKSI (temuan Reviewer ronde 5): versi sebelumnya komentar ini menulis
 * bahwa "test versi-basi yang menangkapnya" kalau ambang digeser tanpa
 * menaikkan versi. Itu SALAH, dan salahnya penting. Test versi-basi hanya
 * menolak sidecar yang versiBukti-nya LEBIH KECIL dari nilai kini; ambang yang
 * digeser diam-diam tetap menghasilkan sidecar versi 1, jadi ia lolos di sana
 * tanpa perlawanan.
 *
 * Yang benar-benar menangkapnya adalah SALINAN ini beserta fixture batasnya:
 * begitu AMBANG_RASIO atau AMBANG_KATA di produksi digeser, fixture di sini
 * berhenti cocok dengan aturan yang berlaku dan test jadi merah — memaksa
 * penulisnya memutuskan secara sadar: naikkan `versiBukti` dan perbarui
 * fixture, atau batalkan pergeserannya. Kopling yang disengaja, bukan
 * duplikasi yang lupa.
 */
const AMBANG_RASIO_V1 = 0.02;
const AMBANG_KATA_V1 = 6;

/**
 * SATU SUMBER KEBIJAKAN — classifier dan validator wajib membaca yang SAMA.
 *
 * Temuan Reviewer ronde 6, dan ia membongkar klaim saya sendiri: test ini
 * memanggil `referensiLayak`, bukan classifier. Jadi kalau resolver menyalin
 * 0.02/6 miliknya sendiri, menggeser AMBANG_RASIO/AMBANG_KATA di classifier
 * tanpa menaikkan versi akan membiarkan SELURUH fixture hijau — sementara
 * producer dan validator diam-diam memakai aturan yang berbeda. Itu keadaan
 * terburuk: bukti diterbitkan dengan satu aturan dan dinilai dengan aturan lain,
 * tanpa satu pun test merah.
 *
 * Kontraknya karena itu dinaikkan ke produksi: `lib/media/klasifikasi-gambar.ts`
 * WAJIB mengekspor satu objek kebijakan, dan kebijakan itulah yang dipakai
 * classifier saat menerbitkan bukti DAN validator saat menilainya.
 *
 *     KEBIJAKAN_KLASIFIKASI = { versiBukti: 1, ambangRasio: 0.02, ambangKata: 6 }
 *
 * Dua test di bawah mengunci dua hal berbeda:
 *   1. nilai kebijakan versi 1 adalah 0.02/6 — kalau digeser tanpa menaikkan
 *      versiBukti, test ini merah, dan penulisnya dipaksa memutuskan sadar;
 *   2. fixture yang DIBANGUN DARI objek kebijakan itu (bukan dari literal)
 *      dinilai konsisten oleh resolver — kalau validator punya salinan sendiri,
 *      geseran kebijakan membuat keduanya berselisih dan test ini merah.
 */
const MODUL_CLASSIFIER = "lib/media/klasifikasi-gambar";
const EKSPOR_KEBIJAKAN = "KEBIJAKAN_KLASIFIKASI";

interface KebijakanKlasifikasi {
  versiBukti: number;
  ambangRasio: number;
  ambangKata: number;
}

async function muatKebijakan(): Promise<KebijakanKlasifikasi> {
  const modul = (await import(`../${MODUL_CLASSIFIER}`)) as Record<string, unknown>;
  const kebijakan = modul[EKSPOR_KEBIJAKAN];
  assert.ok(
    kebijakan && typeof kebijakan === "object",
    `${MODUL_CLASSIFIER}.ts tidak mengekspor ${EKSPOR_KEBIJAKAN}. Selama ambang classifier dan ` +
      "ambang validator adalah dua salinan, bukti bisa diterbitkan dengan satu aturan dan " +
      "dinilai dengan aturan lain tanpa satu pun test merah."
  );
  return kebijakan as KebijakanKlasifikasi;
}

test("KEBIJAKAN: classifier mengekspor kebijakan versi 1 dengan ambang yang dipakai fixture", async () => {
  const k = await muatKebijakan();
  assert.deepEqual(
    { versiBukti: k.versiBukti, ambangRasio: k.ambangRasio, ambangKata: k.ambangKata },
    { versiBukti: VERSI_BUKTI_TERKINI, ambangRasio: AMBANG_RASIO_V1, ambangKata: AMBANG_KATA_V1 },
    `Kebijakan produksi tidak lagi sama dengan kebijakan yang dikunci fixture di berkas ini. ` +
      "Kalau ambangnya memang sengaja digeser, versiBukti WAJIB naik dan fixture di sini WAJIB " +
      "diperbarui bersamaan — bukti versi lama tidak boleh dinilai dengan aturan baru. Kalau " +
      "versinya tidak naik, geseran itu membuat producer dan validator berselisih diam-diam."
  );
});

/** Double terbesar yang masih lebih kecil dari x. Dipakai untuk uji tepat-di-bawah-ambang. */
function nextDown(x: number): number {
  const buf = new DataView(new ArrayBuffer(8));
  buf.setFloat64(0, x);
  const bits = buf.getBigUint64(0);
  // x positif dan berhingga di seluruh pemakaian di sini.
  buf.setBigUint64(0, bits - 1n);
  return buf.getFloat64(0);
}

test("KEBIJAKAN: resolver menilai TEPAT DI AMBANG produksi, bukan di salinannya sendiri", async () => {
  // BERPASANGAN, dan pasangannya wajib ada (temuan Reviewer ronde 7).
  //
  // Menguji tepat-di-ambang SAJA hanya mendeteksi pergeseran satu arah. Kalau
  // kebijakan NAIK — rasio 0.02 -> 0.03, kata 6 -> 7 — sementara validator
  // masih memakai nilai lama, nilai di ambang BARU tetap ditolak oleh keduanya
  // dan test itu lulus. Bahkan sesudah versiBukti dinaikkan dan literal di
  // berkas ini diperbarui, salinan validator yang basi tetap tak terdeteksi.
  //
  // Pasangannya menutup arah itu: nilai TEPAT DI BAWAH ambang produksi wajib
  // DITERIMA sebagai foto produk. Validator yang ambangnya basi (0.02) akan
  // menolak 0.0299… — dan test ini yang menangkapnya.
  //
  // Keduanya dibangun DARI objek kebijakan produksi, bukan dari literal.
  const k = await muatKebijakan();

  const tolak: [string, Record<string, unknown>][] = [
    [`rasioAreaTeks TEPAT ambang produksi (${k.ambangRasio})`, { rasioAreaTeks: k.ambangRasio }],
    [`jumlahKata TEPAT ambang produksi (${k.ambangKata})`, { jumlahKata: k.ambangKata }],
  ];
  for (const [judul, ubah] of tolak) {
    pasang([
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecarDenganField({ jenis: "product_photo", layakReferensi: true, ...ubah })],
    ]);
    assert.deepEqual(
      await referensiLayak([relFoto(1)]),
      [],
      `${judul}: aturan produksi memakai >=, jadi nilai TEPAT di ambang sudah promosi dan vonis ` +
        `"foto produk layak" mustahil. Kalau ini hijau, validator memakai ambang yang berbeda ` +
        "dari classifier — dua aturan bukti, persis cacat yang modul pusat ada untuk menutupnya."
    );
  }

  const terima: [string, Record<string, unknown>][] = [
    [
      `rasioAreaTeks TEPAT DI BAWAH ambang produksi (${nextDown(k.ambangRasio)})`,
      { rasioAreaTeks: nextDown(k.ambangRasio) },
    ],
    [`jumlahKata TEPAT DI BAWAH ambang produksi (${k.ambangKata - 1})`, { jumlahKata: k.ambangKata - 1 }],
  ];
  for (const [judul, ubah] of terima) {
    pasang([
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecarDenganField({ jenis: "product_photo", layakReferensi: true, ...ubah })],
    ]);
    assert.deepEqual(
      await referensiLayak([relFoto(1)]),
      [relFoto(1)],
      `${judul}: nilai di BAWAH ambang produksi wajib DITERIMA sebagai foto produk. Kalau ini ` +
        "merah, validator memakai ambang yang lebih rendah daripada classifier — salinan basi " +
        "yang menolak bukti yang sah. Tanpa pasangan ini, kebijakan yang NAIK tidak pernah " +
        "terdeteksi: nilai di ambang baru tetap ditolak oleh keduanya dan testnya lulus."
    );
  }
});

const kontradiktif: { judul: string; ubah: Record<string, unknown>; kenapa: string }[] = [
  // --- sumbu 1: jenis vs layakReferensi ---
  {
    judul: 'jenis "promotional_graphic" TAPI layakReferensi true',
    ubah: { jenis: "promotional_graphic", layakReferensi: true, rasioAreaTeks: 0.19, jumlahKata: 14 },
    kenapa:
      "banner yang buktinya sendiri menyebut dirinya banner tetap terkirim ke model sebagai " +
      'acuan "beginilah rupa produknya"',
  },
  {
    judul: 'jenis "product_photo" TAPI layakReferensi false',
    ubah: { jenis: "product_photo", layakReferensi: false },
    kenapa: "arah sebaliknya: bukti menyangkal dirinya sendiri, jadi tidak ada vonis yang bisa dibaca",
  },
  {
    judul: 'jenis "belum_diperiksa" TAPI layakReferensi true',
    ubah: { jenis: "belum_diperiksa", layakReferensi: true, rasioAreaTeks: 0, jumlahKata: 0 },
    kenapa:
      "belum diperiksa TIDAK BISA layak — kalau ia layak, berarti ia sudah diperiksa. Ini " +
      "kontradiksi, bukan status; bedakan dari belum_diperiksa + layakReferensi false yang " +
      "justru bukti sah dan ditolak dengan CLASSIFIER_FAILED",
  },

  // --- sumbu 2: METRIK vs vonis, satu sumbu per fixture ---
  //
  // Temuan Reviewer ronde 4. Fixture sumbu 1 hanya mengunci hubungan jenis <->
  // layakReferensi; implementasi yang memvalidasi pasangan itu TAPI mengabaikan
  // metriknya tetap meloloskan bukti yang bertentangan dengan aturan classifier
  // yang menghasilkannya. Metrik bukan hiasan — metriklah yang MENENTUKAN vonis
  // di klasifikasiGambar, jadi bukti yang metriknya membantah vonisnya sendiri
  // tidak pernah bisa dihasilkan classifier versi 1. Ia ditulis pihak lain.
  {
    judul: `rasioAreaTeks ${0.19} (>= ambang ${AMBANG_RASIO_V1}) TAPI divonis foto produk layak`,
    ubah: { jenis: "product_photo", layakReferensi: true, rasioAreaTeks: 0.19 },
    kenapa:
      `rasio ${0.19} >= AMBANG_RASIO ${AMBANG_RASIO_V1}, jadi aturan versi 1 WAJIB memvonis ` +
      "promosi; bukti ini tidak mungkin keluar dari classifier versi 1",
  },
  {
    judul: `jumlahKata 14 (>= ambang ${AMBANG_KATA_V1}) TAPI divonis foto produk layak`,
    ubah: { jenis: "product_photo", layakReferensi: true, jumlahKata: 14 },
    kenapa:
      `jumlahKata 14 >= AMBANG_KATA ${AMBANG_KATA_V1}, jadi aturan versi 1 WAJIB memvonis promosi`,
  },

  // BATAS INKLUSIF, TEPAT DI AMBANG. Temuan Reviewer ronde 5.
  //
  // Fixture 0.19 dan 14 berada jauh di atas ambang, jadi validator yang keliru
  // memakai `>` alih-alih `>=` tetap menolak keduanya dan lulus — sambil
  // menerima sidecar `product_photo` PERSIS di 0.02 dan PERSIS di 6, padahal
  // aturan versi 1 (`rasio >= 0.02 || kata >= 6`) wajib memvonis keduanya
  // promosi. Ambang yang tidak diuji di titiknya sendiri bukan ambang yang
  // terkunci.
  {
    judul: `rasioAreaTeks TEPAT ${AMBANG_RASIO_V1} (batas inklusif) TAPI divonis foto produk layak`,
    ubah: { jenis: "product_photo", layakReferensi: true, rasioAreaTeks: AMBANG_RASIO_V1 },
    kenapa:
      `aturan v1 memakai >= , jadi rasio TEPAT ${AMBANG_RASIO_V1} sudah promosi. Validator ` +
      "yang memakai > akan meloloskan ini sambil tetap menolak 0.19",
  },
  {
    judul: `jumlahKata TEPAT ${AMBANG_KATA_V1} (batas inklusif) TAPI divonis foto produk layak`,
    ubah: { jenis: "product_photo", layakReferensi: true, jumlahKata: AMBANG_KATA_V1 },
    kenapa:
      `aturan v1 memakai >= , jadi jumlahKata TEPAT ${AMBANG_KATA_V1} sudah promosi. Validator ` +
      "yang memakai > akan meloloskan ini sambil tetap menolak 14",
  },

  // --- ARAH SEBALIKNYA: vonis PROMOSI dengan metrik di BAWAH ambang ---
  //
  // Temuan Reviewer ronde 6. Fixture di atas hanya menolak `product_photo` saat
  // metriknya mencapai ambang; tidak ada yang menolak `promotional_graphic`
  // ketika KEDUA metriknya di bawah ambang. Validator yang meloloskan setiap
  // vonis promosi "karena toh fail-closed" lulus semuanya — sambil MEMBEKUKAN
  // vonis palsu.
  //
  // Ini bukan kasus akademis: sidecar yang persis begini adalah yang ditulis
  // blok catch `saveProductImages` di runtime tanpa biner — jenis promosi,
  // layakReferensi false, rasio 0 dan kata 0. Di bawah kontrak baru keadaan itu
  // WAJIB `belum_diperiksa`; vonis "promosi" dengan metrik di bawah ambang
  // tidak mungkin keluar dari classifier v1, jadi ia bukan vonis — ia
  // kegagalan yang menyamar.
  {
    judul: "vonis promosi TAPI kedua metrik di bawah ambang (vonis palsu yang membeku)",
    ubah: { jenis: "promotional_graphic", layakReferensi: false, rasioAreaTeks: 0.001, jumlahKata: 1 },
    kenapa:
      "aturan v1 hanya memvonis promosi bila rasio >= ambang ATAU kata >= ambang; dengan " +
      "keduanya di bawah, vonis ini mustahil dihasilkan classifier v1. Bentuk inilah yang " +
      "ditulis blok catch saveProductImages saat biner tidak ada — dan sekarang wajib " +
      "belum_diperiksa, bukan promosi",
  },
  {
    judul: "vonis promosi dengan metrik NOL (bentuk persis dari blok catch produksi)",
    ubah: { jenis: "promotional_graphic", layakReferensi: false, rasioAreaTeks: 0, jumlahKata: 0 },
    kenapa:
      "lib/product-images.ts:228-233 menulis persis ini saat klasifikasi gagal: rasio 0, kata 0, " +
      "vonis promosi. Bukti yang berbohong tentang apa yang terjadi",
  },

  // --- sumbu 3: DOMAIN NUMERIK, satu sumbu per fixture ---
  //
  // Tipenya number dan vonisnya konsisten, tapi angkanya tidak mungkin berasal
  // dari pengukuran mana pun. rasioAreaTeks adalah luas kotak teks dibagi luas
  // gambar: ia tidak bisa negatif dan tidak bisa melebihi 1. jumlahKata adalah
  // cacahan: ia tidak bisa negatif dan tidak bisa pecahan.
  {
    judul: "rasioAreaTeks negatif",
    ubah: { rasioAreaTeks: -0.1 },
    kenapa: "luas tidak bisa negatif; angka ini tidak berasal dari pengukuran",
  },
  {
    judul: "rasioAreaTeks > 1",
    ubah: { rasioAreaTeks: 1.5 },
    kenapa: "luas teks tidak bisa melebihi luas gambarnya sendiri",
  },
  {
    judul: "jumlahKata negatif",
    ubah: { jumlahKata: -1 },
    kenapa: "cacahan kata tidak bisa negatif",
  },
  {
    judul: "jumlahKata pecahan",
    ubah: { jumlahKata: 2.5 },
    kenapa: "cacahan kata tidak bisa pecahan",
  },
];

for (const kasus of kontradiktif) {
  test(`C8: bukti BERTENTANGAN — ${kasus.judul} -> fail-closed`, async () => {
    const tulisan = pasang([
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecarDenganField(kasus.ubah)],
    ]);
    const layak = await referensiLayak([relFoto(1)]);
    assert.deepEqual(
      layak,
      [],
      `EVIDENCE_INVALID: sidecar ${kasus.judul} tetap diterima (${JSON.stringify(layak)}). ` +
        `Seluruh TIPE di fixture ini sah, hash cocok, versi terkini — jadi validator bentuk saja ` +
        `tidak menangkapnya. ${kasus.kenapa}.`
    );
    assert.deepEqual(tulisan, [], `jalur baca menulis bukti baru: ${JSON.stringify(tulisan)}`);
  });
}

for (const kasus of fieldTakSah) {
  test(`C8: TIPE FIELD salah — ${kasus.judul} -> tidak boleh lolos`, async () => {
    const tulisan = pasang([
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecarDenganField(kasus.ubah)],
    ]);
    const layak = await referensiLayak([relFoto(1)]);
    assert.deepEqual(
      layak,
      [],
      `EVIDENCE_INVALID: sidecar dengan ${kasus.judul} tetap diterima (${JSON.stringify(layak)}). ` +
        `${kasus.kenapa}. SELURUH field lain di fixture ini SAH, jadi test ini hanya bisa hijau ` +
        `kalau field itu sendiri yang diperiksa — bukan karena field lain kebetulan ikut rusak.`
    );
    assert.deepEqual(tulisan, [], `jalur baca menulis bukti baru: ${JSON.stringify(tulisan)}`);
  });
}

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

// VERSI BUKTI YANG TIPENYA SALAH — tiga bentuk, satu akar.
//
// Ditambahkan atas temuan Reviewer 21 Agu. Test versi R1 hanya menguji versi
// HILANG dan versi BASI, jadi implementasi yang memeriksa versinya dengan
// `meta.versiBukti >= VERSI_BUKTI_TERKINI` saja akan hijau — padahal:
//
//     "1" >= 1   -> true   (string dipaksa jadi angka)
//     1.5 >= 1   -> true   (bukan integer, tapi lolos perbandingan)
//     null >= 1  -> false  (kebetulan tertolak, bukan karena diperiksa)
//
// Kontraknya sudah dikunci sebagai INTEGER (lihat VERSI_BUKTI_TERKINI di atas),
// jadi perbandingan angka saja tidak cukup: bentuknya harus diperiksa. `null`
// ikut diuji supaya alasan penolakannya benar dan tetap benar kalau nilai
// terkini suatu saat naik — bukan lulus karena kebetulan coercion-nya kecil.

const versiTakSah: [string, unknown][] = [
  ['versi bukti STRING "1" (bukan integer)', "1"],
  ["versi bukti PECAHAN 1.5 (bukan integer)", 1.5],
  ["versi bukti null", null],
];

for (const [judul, nilai] of versiTakSah) {
  test(`C8: ${judul} -> tidak boleh lolos`, async () => {
    const sidecar = Buffer.from(
      JSON.stringify({
        sha256: sha(PACKSHOT),
        jenis: "product_photo",
        layakReferensi: true,
        rasioAreaTeks: 0.004,
        jumlahKata: 2,
        alasan: "foto produk",
        versiBukti: nilai,
      })
    );
    const tulisan = pasang([
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecar],
    ]);
    const layak = await referensiLayak([relFoto(1)]);
    assert.deepEqual(
      layak,
      [],
      `EVIDENCE_INVALID: sidecar dengan ${judul} tetap diterima (${JSON.stringify(layak)}). ` +
        `Kontraknya integer ${VERSI_BUKTI_TERKINI}; ${JSON.stringify(nilai)} bukan integer, jadi ` +
        "bukti ini tidak bisa dipetakan ke aturan klasifikasi mana pun. Perbandingan angka saja " +
        "(`versiBukti >= 1`) TIDAK cukup — periksa bentuknya."
    );
    assert.deepEqual(tulisan, [], `jalur baca menulis bukti baru saat versi tidak sah: ${JSON.stringify(tulisan)}`);
  });
}

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

// ===========================================================================
// KONTRAK API PUSAT — resolveApprovedReference
// ===========================================================================
//
// Ditambahkan atas temuan Reviewer 21 Agu, dan temuannya benar: kontrak yang
// ditulis di kepala berkas ini (baris 13-32) TIDAK PERNAH DIUJI. Seluruh test
// di atas hanya memanggil `referensiLayak` dan hanya memeriksa array string.
// Test wiring pun hanya memastikan ekspornya sebuah fungsi.
//
// Akibatnya, implementasi berikut LULUS SEMUA test lama sambil melanggar
// kontraknya sendiri:
//
//     export async function resolveApprovedReference(rels: string[]) {
//       const layak = await referensiLayak(rels);
//       if (layak.length === 0) throw new Error("EVIDENCE_INVALID");  // MELEMPAR
//       return layak;                                                 // tanpa alasan
//     }
//
// Test C8 di worker pun tetap hijau, karena processJob gagal-tertutup entah
// resolvernya melempar atau mengembalikan kosong. Jadi kontrak "kembalikan
// data, jangan melempar, sertakan alasan per gambar" tidak dijaga siapa pun.
//
// Blok ini menguji API pusatnya LANGSUNG: bentuk data, penyingkiran, reason
// code, dan yang paling penting — TIDAK MELEMPAR.

/** Reason code diambil dari PATH-CASE-MATRIX.md; tidak ada kosakata baru. */
const ALASAN = {
  BUKTI: "EVIDENCE_INVALID", // sidecar hilang/korup/bentuk salah/versi tidak sah
  HILANG: "REF_MISSING", // bytes tidak ada di storage
  HASH: "REF_HASH_MISMATCH", // sha256 sidecar != bytes tersimpan
  PROMOSI: "REF_PROMOTIONAL", // diperiksa, dan memang materi promosi
  BELUM: "CLASSIFIER_FAILED", // BELUM diperiksa — bukan vonis (PATH-CASE C7)
} as const;

type Resolver = (rels: string[]) => Promise<{
  utama: { rel: string; sha256: string; versiBukti: number } | null;
  tersetujui: { rel: string; sha256: string; versiBukti: number }[];
  ditolak: { rel: string; alasan: string; pesan: string }[];
}>;

/**
 * Specifier-nya dirakit dari konstanta, bukan literal.
 *
 * Bukan gaya-gayaan: modul ini memang BELUM ADA, dan `import("../lib/product-truth")`
 * sebagai literal membuat `npx tsc --noEmit` gagal dengan TS2307 — kegagalan
 * KOMPILASI, bukan kegagalan asersi. Itu menukar bukti merah yang berbicara
 * ("kontraknya belum ada") dengan error toolchain yang menutupi seluruh
 * berkas, dan sekaligus mematahkan gerbang rilis `tsc` untuk alasan yang salah.
 * Bentuk ini membuat kegagalannya muncul di tempat yang benar: saat test
 * berjalan, dengan pesan yang menjelaskan kontraknya.
 */
const MODUL_PUSAT = "lib/product-truth";

async function muatResolver(): Promise<Resolver> {
  let modul: Record<string, unknown>;
  try {
    modul = (await import(`../${MODUL_PUSAT}`)) as Record<string, unknown>;
  } catch (err) {
    assert.fail(
      `${MODUL_PUSAT}.ts tidak bisa di-import: ${(err as Error).message}. ` +
        "Kontrak bukti tidak punya rumah pusat, jadi setiap pemanggil menyusun aturannya sendiri."
    );
  }
  assert.equal(
    typeof modul.resolveApprovedReference,
    "function",
    `${MODUL_PUSAT}.ts ada tapi resolveApprovedReference bukan fungsi`
  );
  return modul.resolveApprovedReference as Resolver;
}

/**
 * Memanggil resolver dan MENUNTUT ia tidak melempar.
 *
 * Ini asersi kontrak nomor satu, bukan sekadar pembungkus kenyamanan: bukti
 * tidak sah adalah keadaan data yang normal dan terduga. Resolver yang
 * melempar memaksa setiap pemanggil memasang try/catch, dan pemanggil yang
 * lupa memasangnya akan menjatuhkan job dengan cara yang berbeda-beda —
 * persis divergensi W1 vs W2 yang modul pusat ini ada untuk mengakhirinya.
 */
async function resolveTanpaLempar(resolver: Resolver, rels: string[], konteks: string) {
  try {
    return await resolver(rels);
  } catch (err) {
    assert.fail(
      `${konteks}: resolveApprovedReference MELEMPAR (${(err as Error).message}). ` +
        "Kontraknya: bukti tidak sah dikembalikan sebagai DATA (utama=null + alasan per gambar), " +
        "bukan sebagai exception. Yang boleh melempar hanya kegagalan infrastruktur."
    );
  }
}

test("API pusat: bukti SAH -> utama terisi lengkap dengan sha256 dan versiBukti", async () => {
  const resolver = await muatResolver();
  const tulisan = pasang([
    [relFoto(1), PACKSHOT],
    [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")],
  ]);
  const hasil = await resolveTanpaLempar(resolver, [relFoto(1)], "kontrol positif");
  assert.deepEqual(
    hasil.utama,
    { rel: relFoto(1), sha256: sha(PACKSHOT), versiBukti: VERSI_BUKTI_TERKINI },
    "utama harus membawa identitas byte yang tersetujui, bukan sekadar nama berkas — " +
      "tanpa sha256, admission tidak punya apa pun untuk di-snapshot"
  );
  assert.deepEqual(hasil.tersetujui.map((r) => r.rel), [relFoto(1)]);
  assert.deepEqual(hasil.ditolak, [], "bukti sah tidak boleh menghasilkan penolakan");
  assert.deepEqual(tulisan, [], "resolver tidak boleh menulis apa pun ke storage");
});

/**
 * STATUS `belum_diperiksa` DIKUNCI DI KONTRAK SIDECAR, bukan hanya di classifier.
 *
 * Temuan Reviewer ronde 6: ronde sebelumnya memperkenalkan keadaan ketiga di
 * `klasifikasiGambar`, tapi tidak satu pun test mengunci apa yang terjadi
 * ketika keadaan itu SAMPAI KE SIDECAR. Implementasi bisa memperlakukannya
 * sebagai enum asing dan menolaknya dengan EVIDENCE_INVALID — dan seluruh test
 * tetap hijau, sementara perbedaan epistemik yang baru saja diperkenalkan
 * lenyap tepat di tempat ia paling dibutuhkan.
 *
 * Perbedaannya bukan kosmetik. EVIDENCE_INVALID berarti "bukti ini rusak,
 * karantina"; CLASSIFIER_FAILED berarti "bukti ini jujur mengatakan belum
 * diperiksa, revalidasi di boundary yang punya binernya". Yang pertama tidak
 * bisa dipulihkan otomatis, yang kedua bisa — dan seluruh rencana P0-B2
 * bergantung pada bedanya.
 */
test("KONTRAK: sidecar belum_diperiksa DIPERTAHANKAN pembaca meta, bukan dianggap rusak", async () => {
  const { bacaMetaGambar } = await import("../lib/product-images");
  pasang([
    [relFoto(1), PACKSHOT],
    [
      relSidecar(1),
      sidecarDenganField({ jenis: "belum_diperiksa", layakReferensi: false, rasioAreaTeks: 0, jumlahKata: 0 }),
    ],
  ]);
  const meta = (await bacaMetaGambar(relFoto(1))) as { jenis?: string; layakReferensi?: boolean } | null;
  assert.equal(
    meta?.jenis,
    "belum_diperiksa",
    'Pembaca meta tidak mempertahankan status "belum_diperiksa". Kalau ia menelannya jadi null ' +
      "atau menormalkannya jadi promosi, bukti yang jujur berubah jadi bukti yang berbohong " +
      "tepat di lapisan yang seharusnya menjaganya."
  );
  assert.equal(meta?.layakReferensi, false, "status belum diperiksa tidak boleh layak");
});

test("KONTRAK: sidecar belum_diperiksa TIDAK disetujui, dan alasannya CLASSIFIER_FAILED", async () => {
  const resolver = await muatResolver();
  pasang([
    [relFoto(1), PACKSHOT],
    [
      relSidecar(1),
      sidecarDenganField({ jenis: "belum_diperiksa", layakReferensi: false, rasioAreaTeks: 0, jumlahKata: 0 }),
    ],
  ]);
  const layak = await referensiLayak([relFoto(1)]);
  assert.deepEqual(layak, [], "gambar yang belum diperiksa tetap lolos jadi referensi");

  const hasil = await resolveTanpaLempar(resolver, [relFoto(1)], "belum_diperiksa");
  assert.equal(hasil.utama, null);
  assert.deepEqual(hasil.tersetujui, []);
  assert.deepEqual(
    hasil.ditolak.map((d) => [d.rel, d.alasan]),
    [[relFoto(1), ALASAN.BELUM]],
    `Alasan penolakan wajib ${ALASAN.BELUM}, bukan ${ALASAN.BUKTI}. Bukti yang JUJUR menyatakan ` +
      "dirinya belum diperiksa tidak rusak — ia bisa direvalidasi oleh boundary yang punya " +
      "binernya. Menyamakannya dengan bukti rusak membuang satu-satunya informasi yang membuat " +
      "pemulihan otomatis mungkin."
  );
});

test("API pusat: SETIAP entri tersetujui membawa metadata lengkap, bukan hanya rel", async () => {
  // Temuan Reviewer 21 Agu: kontrol positif sebelumnya hanya memetakan `rel`,
  // jadi implementasi yang mengembalikan `utama` lengkap tapi `tersetujui`
  // berisi objek `{rel}` saja tetap lulus semuanya. Padahal justru daftar
  // tersetujui itulah yang dipakai worker untuk referensi ke-2 dst, dan
  // admission butuh sha256 SETIAP entri untuk di-snapshot — bukan hanya yang
  // utama. Diuji dengan DUA foto sah supaya "utama" tidak bisa menyamar
  // sebagai seluruh daftar.
  const resolver = await muatResolver();
  const KEDUA = Buffer.from("BYTES-PACKSHOT-KEDUA-SAH");
  pasang([
    [relFoto(1), PACKSHOT],
    [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")],
    [relFoto(2), KEDUA],
    [relSidecar(2), sidecarSah(KEDUA, true, "product_photo")],
  ]);
  const hasil = await resolveTanpaLempar(resolver, [relFoto(1), relFoto(2)], "dua foto sah");
  assert.deepEqual(
    hasil.tersetujui,
    [
      { rel: relFoto(1), sha256: sha(PACKSHOT), versiBukti: VERSI_BUKTI_TERKINI },
      { rel: relFoto(2), sha256: sha(KEDUA), versiBukti: VERSI_BUKTI_TERKINI },
    ],
    "setiap entri tersetujui wajib membawa rel + sha256 + versiBukti. Referensi ke-2 dst juga " +
      "dikirim ke model dan juga harus bisa di-snapshot admission; daftar berisi {rel} saja " +
      "memindahkan pekerjaan verifikasi kembali ke setiap pemanggil."
  );
  assert.deepEqual(
    hasil.utama,
    hasil.tersetujui[0],
    "utama wajib entri pertama daftar tersetujui yang SAMA objeknya — dua sumber kebenaran " +
      "untuk 'referensi utama' adalah cara divergensi lahir kembali"
  );
  assert.deepEqual(hasil.ditolak, []);
});

test("API pusat C1: banner ditolak REF_PROMOTIONAL, packshot jadi utama", async () => {
  const resolver = await muatResolver();
  pasang([
    [relFoto(0), BANNER],
    [relSidecar(0), sidecarSah(BANNER, false, "promotional_graphic")],
    [relFoto(1), PACKSHOT],
    [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")],
  ]);
  const hasil = await resolveTanpaLempar(resolver, [relFoto(0), relFoto(1)], "C1");
  assert.equal(hasil.utama?.rel, relFoto(1), "utama harus packshot, bukan foto pertama");
  assert.deepEqual(
    hasil.ditolak.map((d) => [d.rel, d.alasan]),
    [[relFoto(0), ALASAN.PROMOSI]],
    "banner wajib dilaporkan sebagai REF_PROMOTIONAL — itu STATUS FOTO, dan pemanggil " +
      "membutuhkannya untuk memberi pesan yang bisa ditindaklanjuti"
  );
});

// Setiap fixture tidak sah diuji LANGSUNG di API pusat: tidak melempar,
// tersetujui kosong, utama null, dan alasannya BENAR — bukan sekadar "ditolak".
const kasusTakSah: { judul: string; entri: [string, Buffer][]; alasan: string }[] = [
  {
    judul: "berkas referensi hilang, sidecar ada",
    entri: [[relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")]],
    alasan: ALASAN.HILANG,
  },
  {
    judul: "sidecar hilang, bytes ada",
    entri: [[relFoto(1), PACKSHOT]],
    alasan: ALASAN.BUKTI,
  },
  {
    judul: "sidecar JSON korup",
    entri: [
      [relFoto(1), PACKSHOT],
      [relSidecar(1), Buffer.from('{"sha256": "abc", "jenis":')],
    ],
    alasan: ALASAN.BUKTI,
  },
  // Bukti yang bertentangan dengan dirinya sendiri, seluruh tipe sah.
  ...kontradiktif.map((k) => ({
    judul: `bertentangan — ${k.judul}`,
    entri: [
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecarDenganField(k.ubah)],
    ] as [string, Buffer][],
    alasan: ALASAN.BUKTI,
  })),
  // Satu field rusak per fixture, seluruh field lain sah — alasan lengkapnya
  // ada di komentar `fieldTakSah` di atas.
  ...fieldTakSah.map((f) => ({
    judul: `tipe field salah — ${f.judul}`,
    entri: [
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecarDenganField(f.ubah)],
    ] as [string, Buffer][],
    alasan: ALASAN.BUKTI,
  })),
  {
    judul: "tanpa versiBukti",
    entri: [
      [relFoto(1), PACKSHOT],
      [
        relSidecar(1),
        Buffer.from(
          JSON.stringify({
            sha256: sha(PACKSHOT),
            jenis: "product_photo",
            layakReferensi: true,
            rasioAreaTeks: 0.004,
            jumlahKata: 2,
            alasan: "foto produk",
          })
        ),
      ],
    ],
    alasan: ALASAN.BUKTI,
  },
  ...versiTakSah.map(([judul, nilai]) => ({
    judul,
    entri: [
      [relFoto(1), PACKSHOT],
      [
        relSidecar(1),
        Buffer.from(
          JSON.stringify({
            sha256: sha(PACKSHOT),
            jenis: "product_photo",
            layakReferensi: true,
            rasioAreaTeks: 0.004,
            jumlahKata: 2,
            alasan: "foto produk",
            versiBukti: nilai,
          })
        ),
      ],
    ] as [string, Buffer][],
    alasan: ALASAN.BUKTI,
  })),
  {
    judul: "versiBukti basi",
    entri: [
      [relFoto(1), PACKSHOT],
      [
        relSidecar(1),
        Buffer.from(
          JSON.stringify({
            sha256: sha(PACKSHOT),
            jenis: "product_photo",
            layakReferensi: true,
            rasioAreaTeks: 0.004,
            jumlahKata: 2,
            alasan: "foto produk",
            versiBukti: VERSI_BUKTI_TERKINI - 1,
          })
        ),
      ],
    ],
    alasan: ALASAN.BUKTI,
  },
  {
    judul: "sha256 sidecar beda dari bytes tersimpan",
    entri: [
      [relFoto(1), Buffer.from("BYTES-DITUKAR-SESUDAH-KLASIFIKASI")],
      [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")],
    ],
    alasan: ALASAN.HASH,
  },
];

for (const kasus of kasusTakSah) {
  test(`API pusat: ${kasus.judul} -> data, bukan exception; alasan ${kasus.alasan}`, async () => {
    const resolver = await muatResolver();
    const tulisan = pasang(kasus.entri);
    const hasil = await resolveTanpaLempar(resolver, [relFoto(1)], kasus.judul);

    assert.equal(hasil.utama, null, `${kasus.judul}: utama harus null — tidak ada bukti yang sah`);
    assert.deepEqual(hasil.tersetujui, [], `${kasus.judul}: daftar tersetujui harus kosong`);
    assert.deepEqual(
      hasil.ditolak.map((d) => [d.rel, d.alasan]),
      [[relFoto(1), kasus.alasan]],
      `${kasus.judul}: reason code salah atau tidak dilaporkan. Pemanggil tidak bisa memberi ` +
        "pesan yang bisa ditindaklanjuti dari penolakan tanpa alasan, dan operator tidak bisa " +
        "membedakan bukti rusak dari berkas hilang saat mengaudit."
    );
    assert.ok(
      (hasil.ditolak[0]?.pesan ?? "").length > 10,
      `${kasus.judul}: penolakan tanpa pesan yang bisa dibaca manusia`
    );
    assert.deepEqual(tulisan, [], `${kasus.judul}: resolver menulis ke storage saat menolak`);
  });
}

/**
 * KONTROL SISI TERIMA — banner yang SAH tidak boleh dicap bukti rusak.
 *
 * Seluruh fixture kontradiktif di atas menuntut penolakan, jadi validator yang
 * menolak SEGALANYA akan lulus semuanya. Dua kontrol ini menutup arah itu:
 * sidecar promosi yang metriknya BENAR-BENAR mencapai ambang adalah bukti SAH,
 * dan penolakannya wajib `REF_PROMOTIONAL` — status foto, bukan bukti rusak.
 *
 * Sekaligus mengunci `>=` dari sisi terima: tepat di ambang harus diterima
 * sebagai vonis promosi yang sah, bukan ditolak sebagai kontradiksi.
 */
for (const [judul, ubah] of [
  [
    `rasioAreaTeks TEPAT ${AMBANG_RASIO_V1} dengan vonis promosi (bukti SAH)`,
    { jenis: "promotional_graphic", layakReferensi: false, rasioAreaTeks: AMBANG_RASIO_V1, jumlahKata: 1 },
  ],
  [
    `jumlahKata TEPAT ${AMBANG_KATA_V1} dengan vonis promosi (bukti SAH)`,
    { jenis: "promotional_graphic", layakReferensi: false, rasioAreaTeks: 0.001, jumlahKata: AMBANG_KATA_V1 },
  ],
] as [string, Record<string, unknown>][]) {
  test(`API pusat KONTROL: ${judul} -> ditolak REF_PROMOTIONAL, bukan EVIDENCE_INVALID`, async () => {
    const resolver = await muatResolver();
    pasang([
      [relFoto(1), PACKSHOT],
      [relSidecar(1), sidecarDenganField(ubah)],
    ]);
    const hasil = await resolveTanpaLempar(resolver, [relFoto(1)], judul);
    assert.equal(hasil.utama, null, "banner tetap tidak boleh jadi referensi");
    assert.deepEqual(
      hasil.ditolak.map((d) => [d.rel, d.alasan]),
      [[relFoto(1), ALASAN.PROMOSI]],
      `${judul}: bukti ini SAH — metriknya mencapai ambang, jadi vonis promosi memang yang ` +
        `dihasilkan aturan v1. Menolaknya sebagai ${ALASAN.BUKTI} berarti validator menolak ` +
        "segalanya, dan validator yang menolak segalanya lulus setiap fixture negatif tanpa " +
        "benar-benar memeriksa apa pun."
    );
  });
}

test("API pusat: referensiLayak adalah proyeksi dari resolver, bukan aturan kedua", async () => {
  // Dua jalur baca yang bisa berbeda jawaban adalah cara divergensi W1/W2 lahir
  // kembali lewat pintu belakang. Diuji pada kasus campur: satu banner, satu
  // packshot sah, satu bukti rusak.
  const resolver = await muatResolver();
  const rels = [relFoto(0), relFoto(1), relFoto(2)];
  pasang([
    [relFoto(0), BANNER],
    [relSidecar(0), sidecarSah(BANNER, false, "promotional_graphic")],
    [relFoto(1), PACKSHOT],
    [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")],
    [relFoto(2), PACKSHOT],
    [relSidecar(2), Buffer.from("{bukan json")],
  ]);
  const hasil = await resolveTanpaLempar(resolver, rels, "campur");
  const layak = await referensiLayak(rels);
  assert.deepEqual(
    layak,
    hasil.tersetujui.map((r) => r.rel),
    "referensiLayak() dan resolveApprovedReference() memberi jawaban berbeda untuk daftar yang " +
      "sama — itu dua aturan bukti, dan dua aturan bukti adalah cacat yang modul pusat ini " +
      "seharusnya menutupnya"
  );
  assert.deepEqual(layak, [relFoto(1)], "hanya packshot bersidik sah yang boleh lolos");
});

// ===========================================================================
// KONTRAK `rinci` — sub-kategori penolakan, dipakai AUDIT bukan gerbang
// ===========================================================================
//
// Temuan Reviewer 21 Agu: versi pertama menurunkan kategori ini dari TEKS pesan
// (`sebab.startsWith("versiBukti")`), jadi `versiBukti` bertipe string, pecahan,
// atau null — semuanya kegagalan BENTUK — ikut dilaporkan sebagai
// ketidakcocokan VERSI. Padahal field ini ada justru untuk menentukan tindakan
// pemulihan yang BERBEDA:
//
//   SIDECAR_MISSING       bukti bisa diterbitkan ulang dari bytes yang ada
//   SIDECAR_CORRUPT       storage bermasalah, perlu diselidiki
//   SIDECAR_SCHEMA        bukti ditulis penulis lain, perlu diperiksa satuan
//   SIDECAR_VERSION       satu ANGKATAN bukti perlu direvalidasi
//   SIDECAR_CONTRADICTORY bukti membantah dirinya sendiri
//
// Kategori yang dipakai mengambil keputusan tidak boleh diturunkan dari
// kalimat. Test ini menguncinya secara struktural.

const kasusRinci: [string, [string, Buffer][], string][] = [
  ["sidecar HILANG", [[relFoto(1), PACKSHOT]], "SIDECAR_MISSING"],
  [
    "sidecar KORUP",
    [[relFoto(1), PACKSHOT], [relSidecar(1), Buffer.from("{bukan json")]],
    "SIDECAR_CORRUPT",
  ],
  [
    "BENTUK salah (layakReferensi string)",
    [[relFoto(1), PACKSHOT], [relSidecar(1), sidecarDenganField({ layakReferensi: "false" })]],
    "SIDECAR_SCHEMA",
  ],
  [
    "versiBukti STRING — kegagalan BENTUK, bukan versi",
    [[relFoto(1), PACKSHOT], [relSidecar(1), sidecarDenganField({ versiBukti: "1" })]],
    "SIDECAR_SCHEMA",
  ],
  [
    "versiBukti PECAHAN — kegagalan BENTUK, bukan versi",
    [[relFoto(1), PACKSHOT], [relSidecar(1), sidecarDenganField({ versiBukti: 1.5 })]],
    "SIDECAR_SCHEMA",
  ],
  [
    "versiBukti HILANG — kegagalan BENTUK, bukan versi",
    [
      [relFoto(1), PACKSHOT],
      [
        relSidecar(1),
        Buffer.from(
          JSON.stringify({
            sha256: sha(PACKSHOT),
            jenis: "product_photo",
            layakReferensi: true,
            rasioAreaTeks: 0.004,
            jumlahKata: 2,
            alasan: "foto produk",
          })
        ),
      ],
    ],
    "SIDECAR_SCHEMA",
  ],
  [
    "versiBukti INTEGER tapi revisinya tidak cocok — inilah SIDECAR_VERSION",
    [[relFoto(1), PACKSHOT], [relSidecar(1), sidecarDenganField({ versiBukti: VERSI_BUKTI_TERKINI - 1 })]],
    "SIDECAR_VERSION",
  ],
  [
    "BERTENTANGAN (promosi tapi layakReferensi true)",
    [
      [relFoto(1), PACKSHOT],
      [
        relSidecar(1),
        sidecarDenganField({ jenis: "promotional_graphic", layakReferensi: true, rasioAreaTeks: 0.19, jumlahKata: 14 }),
      ],
    ],
    "SIDECAR_CONTRADICTORY",
  ],
];

for (const [judul, entri, rinciDiharapkan] of kasusRinci) {
  test(`RINCI: ${judul} -> ${rinciDiharapkan}`, async () => {
    const resolver = await muatResolver();
    pasang(entri);
    const hasil = await resolveTanpaLempar(resolver, [relFoto(1)], judul);
    assert.equal(hasil.ditolak[0]?.alasan, ALASAN.BUKTI, `${judul}: alasan tingkat atas salah`);
    assert.equal(
      (hasil.ditolak[0] as { rinci?: string })?.rinci,
      rinciDiharapkan,
      `${judul}: sub-kategori salah. Ia menentukan TINDAKAN PEMULIHAN — bukti yang versinya ` +
        "tidak cocok bisa direvalidasi seangkatan, sementara bukti yang bentuknya rusak harus " +
        "diperiksa satu per satu. Menyamakan keduanya membuat keputusan itu mustahil diambil."
    );
  });
}

test("RINCI: penolakan SELAIN EVIDENCE_INVALID tidak membawa sub-kategori", async () => {
  // Kontrol arah sebaliknya: reason code tingkat atas sudah cukup spesifik di
  // sana, dan sub-kategori yang muncul tanpa sebab akan membuat cacah audit
  // menghitung hal yang sama dua kali.
  const resolver = await muatResolver();
  const kasus: [string, [string, Buffer][], string][] = [
    ["berkas hilang", [[relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")]], ALASAN.HILANG],
    [
      "hash beda",
      [[relFoto(1), Buffer.from("BYTES-LAIN")], [relSidecar(1), sidecarSah(PACKSHOT, true, "product_photo")]],
      ALASAN.HASH,
    ],
    [
      "banner sah",
      [[relFoto(1), BANNER], [relSidecar(1), sidecarSah(BANNER, false, "promotional_graphic")]],
      ALASAN.PROMOSI,
    ],
    [
      "belum diperiksa",
      [
        [relFoto(1), PACKSHOT],
        [
          relSidecar(1),
          sidecarDenganField({ jenis: "belum_diperiksa", layakReferensi: false, rasioAreaTeks: 0, jumlahKata: 0 }),
        ],
      ],
      ALASAN.BELUM,
    ],
  ];
  for (const [judul, entri, alasanDiharapkan] of kasus) {
    pasang(entri);
    const hasil = await resolveTanpaLempar(resolver, [relFoto(1)], judul);
    assert.equal(hasil.ditolak[0]?.alasan, alasanDiharapkan, `${judul}: alasan salah`);
    assert.equal(
      (hasil.ditolak[0] as { rinci?: string })?.rinci,
      undefined,
      `${judul}: membawa sub-kategori padahal reason code tingkat atasnya sudah spesifik — ` +
        "cacah audit akan menghitung hal yang sama dua kali"
    );
  }
});
