// P0-B4 — KANARI BUKTI: melihat tanpa menegakkan.
//
// Yang dijaga test ini, urut dari yang paling penting:
//
//   1. KANARI TIDAK MENEGAKKAN. Vonis sesudah kanari dipasang wajib SAMA
//      PERSIS dengan sebelumnya — termasuk teks pesannya. Kanari yang mengubah
//      vonis bukan alat ukur, ia perubahan perilaku yang menyamar jadi alat ukur.
//   2. KANARI TIDAK BISA MENJATUHKAN RENDER. Ia tidak pernah melempar, bahkan
//      saat penulisannya sendiri melempar. Alat ukur yang bisa menggagalkan
//      pekerjaan berbayar lebih berbahaya daripada ketiadaan alat ukur.
//   3. KODE, BUKAN KALIMAT. Alasan dibawa sebagai data. Selama ia hanya ada di
//      dalam Error.message, satu-satunya cara menghitungnya adalah mencocokkan
//      teks — bentuk cacat yang sudah dua kali muncul di gelombang ini.
//   4. PENYEBUT IKUT DICATAT. Yang dibutuhkan adalah RASIO. Mencatat kegagalan
//      saja memberi pembilang tanpa penyebut dan tidak bisa dipakai memutuskan
//      apa pun.

import { test, after, beforeEach } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";

process.env.RACUN_NO_DOTENV = "1";
process.env.STORAGE_MODE = "filesystem";
process.env.STORAGE_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "kanari-store-"));

const { setMediaStorageForTests } = await import("../lib/storage");
const { resolveApprovedReference, pesanTanpaReferensi, ALASAN_TOLAK, RINCI_TOLAK } = await import("../lib/product-truth");
const { catatKanariReferensi, ringkasanKanari, resetKanariUntukTest, GagalTanpaReferensi, TAG_KANARI, KODE_KANARI } =
  await import("../lib/kanari-bukti");

const sha = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");
const PACKSHOT = Buffer.from("BYTES-PACKSHOT-KANARI");
const BANNER = Buffer.from("BYTES-BANNER-KANARI");

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
      labelOcrStatus: "READABLE", labelOcrVersion: 1,
      ...ubah,
    })
  );
}

const isi = new Map<string, Buffer>();
setMediaStorageForTests({
  async put(key: string, body: Buffer) { isi.set(key, body); },
  async delete(key: string) { isi.delete(key); },
  async get(key: string) { const b = isi.get(key); return b ? { body: b, size: b.length } : null; },
  async stat(key: string) { const b = isi.get(key); return b ? { size: b.length } : null; },
  async materialize() { return null; },
} as never);

after(() => {
  setMediaStorageForTests(undefined);
  fs.rmSync(process.env.STORAGE_DIR!, { recursive: true, force: true });
});

beforeEach(() => {
  isi.clear();
  resetKanariUntukTest();
});

/** Menampung baris log supaya bentuknya bisa diperiksa, bukan sekadar diasumsikan. */
function penampung() {
  const baris: string[] = [];
  return { baris, tulis: (b: string) => void baris.push(b) };
}

const pasangSah = (rel: string) => { isi.set(rel, PACKSHOT); isi.set(`${rel}.meta.json`, sidecar(PACKSHOT)); };
const pasangBanner = (rel: string) => {
  isi.set(rel, BANNER);
  isi.set(`${rel}.meta.json`, sidecar(BANNER, { jenis: "promotional_graphic", layakReferensi: false, rasioAreaTeks: 0.3, jumlahKata: 20 }));
};
const pasangBelumDiperiksa = (rel: string) => {
  isi.set(rel, PACKSHOT);
  isi.set(`${rel}.meta.json`, sidecar(PACKSHOT, { jenis: "belum_diperiksa", layakReferensi: false, rasioAreaTeks: 0, jumlahKata: 0 }));
};

test("KANARI: TIDAK mengubah vonis — lolos tetap lolos, ditolak tetap ditolak dengan pesan yang SAMA", async () => {
  pasangSah("p1/0.webp");
  const lolos = await resolveApprovedReference(["p1/0.webp"]);
  const pesanLolosSebelum = pesanTanpaReferensi(lolos);
  const { tulis } = penampung();
  catatKanariReferensi(lolos, { runtime: "uji" }, tulis);
  assert.equal(lolos.utama?.rel, "p1/0.webp", "kanari mengubah hasil resolusi yang LOLOS");
  assert.equal(pesanTanpaReferensi(lolos), pesanLolosSebelum, "kanari mengubah pesan");

  pasangBanner("p2/0.webp");
  const ditolak = await resolveApprovedReference(["p2/0.webp"]);
  const pesanSebelum = pesanTanpaReferensi(ditolak);
  catatKanariReferensi(ditolak, { runtime: "uji" }, tulis);
  assert.equal(ditolak.utama, null);
  assert.equal(
    pesanTanpaReferensi(ditolak),
    pesanSebelum,
    "teks yang dibaca pengguna berubah gara-gara kanari; alat ukur tidak boleh terasa oleh siapa pun"
  );
});

test("KANARI: TIDAK PERNAH melempar, bahkan saat penulisannya melempar", async () => {
  pasangBanner("p2/0.webp");
  const hasil = await resolveApprovedReference(["p2/0.webp"]);
  assert.doesNotThrow(
    () => catatKanariReferensi(hasil, { runtime: "uji" }, () => { throw new Error("log meledak"); }),
    "kanari melempar dan akan menjatuhkan render berbayar — alat ukur berubah jadi sumber kegagalan baru"
  );
  // Dan kegagalan pencatatan tidak boleh diam-diam merusak cacah berikutnya.
  const { tulis, baris } = penampung();
  catatKanariReferensi(hasil, { runtime: "uji" }, tulis);
  assert.equal(baris.length, 1, "kanari berhenti bekerja sesudah sekali gagal menulis");
});

test("KANARI: mencatat PENYEBUT, bukan cuma pembilang", async () => {
  // Rasio butuh keduanya. Mencatat kegagalan saja memberi angka yang tidak bisa
  // dipakai memutuskan apa pun.
  pasangSah("a/0.webp");
  pasangBanner("b/0.webp");
  const { tulis } = penampung();
  catatKanariReferensi(await resolveApprovedReference(["a/0.webp"]), { runtime: "uji" }, tulis);
  catatKanariReferensi(await resolveApprovedReference(["b/0.webp"]), { runtime: "uji" }, tulis);
  catatKanariReferensi(await resolveApprovedReference(["a/0.webp"]), { runtime: "uji" }, tulis);

  const r = ringkasanKanari();
  assert.equal(r.dinilai, 3, "penilaian yang LOLOS tidak dihitung; rasio jadi mustahil dihitung");
  assert.equal(r.lolos, 2);
  assert.equal(r.ditolak, 1);
});

test("KANARI: alasan dicatat sebagai KODE per foto, termasuk sub-kategori", async () => {
  pasangBanner("c/0.webp");                       // PROMOSI
  isi.set("c/1.webp", PACKSHOT);                  // sidecar hilang -> BUKTI_TIDAK_SAH/SIDECAR_HILANG
  isi.set("c/2.webp.meta.json", sidecar(PACKSHOT)); // bytes hilang -> BERKAS_HILANG
  const { tulis, baris } = penampung();
  catatKanariReferensi(await resolveApprovedReference(["c/0.webp", "c/1.webp", "c/2.webp"]), { runtime: "uji", jobId: "j1" }, tulis);

  const r = ringkasanKanari();
  assert.equal(r.perAlasan[ALASAN_TOLAK.PROMOSI], 1);
  assert.equal(r.perAlasan[ALASAN_TOLAK.BUKTI_TIDAK_SAH], 1);
  assert.equal(r.perAlasan[ALASAN_TOLAK.BERKAS_HILANG], 1);
  assert.equal(r.perRinci[RINCI_TOLAK.SIDECAR_HILANG], 1);

  // Baris lognya wajib bisa dibaca MESIN, bukan dibaca manusia lalu ditebak.
  assert.equal(baris.length, 1);
  assert.ok(baris[0].startsWith(`${TAG_KANARI} `), `tag log tidak stabil: ${baris[0]}`);
  const json = JSON.parse(baris[0].slice(TAG_KANARI.length + 1));
  assert.deepEqual(json.perAlasan, {
    [ALASAN_TOLAK.PROMOSI]: 1,
    [ALASAN_TOLAK.BUKTI_TIDAK_SAH]: 1,
    [ALASAN_TOLAK.BERKAS_HILANG]: 1,
  });
  assert.deepEqual(json.perRinci, { [RINCI_TOLAK.SIDECAR_HILANG]: 1 });
  assert.equal(json.lolos, false);
  assert.equal(json.foto, 3);
  assert.equal(json.tersetujui, 0);
  assert.equal(json.jobId, "j1");
});

test("KANARI: 'semuanya BELUM DIPERIKSA' dihitung TERPISAH — itu angka penentu T43", async () => {
  // Bedanya material: BELUM_DIPERIKSA berarti runtime-nya tidak bisa memeriksa,
  // bukan berarti fotonya buruk. Menggabungkannya dengan penolakan biasa
  // menyembunyikan satu-satunya angka yang membedakan "produknya memang tidak
  // layak" dari "kita yang tidak bisa memeriksanya".
  pasangBelumDiperiksa("d/0.webp");
  pasangBelumDiperiksa("d/1.webp");
  const { tulis, baris } = penampung();
  catatKanariReferensi(await resolveApprovedReference(["d/0.webp", "d/1.webp"]), { runtime: "uji" }, tulis);
  assert.equal(ringkasanKanari().ditolakSemuaBelumDiperiksa, 1);
  assert.equal(JSON.parse(baris[0].slice(TAG_KANARI.length + 1)).semuaBelumDiperiksa, true);

  // CAMPURAN tidak boleh ikut terhitung: satu foto promosi berarti produknya
  // memang punya masalah sendiri, bukan semata runtime yang tidak mampu.
  resetKanariUntukTest();
  isi.clear();
  pasangBelumDiperiksa("e/0.webp");
  pasangBanner("e/1.webp");
  catatKanariReferensi(await resolveApprovedReference(["e/0.webp", "e/1.webp"]), { runtime: "uji" }, tulis);
  assert.equal(
    ringkasanKanari().ditolakSemuaBelumDiperiksa,
    0,
    "penolakan campuran ikut dihitung sebagai 'semua belum diperiksa'; angka penentu T43 jadi terlalu tinggi"
  );

  // Dan yang LOLOS jelas tidak boleh terhitung, walau ada satu foto belum diperiksa.
  resetKanariUntukTest();
  isi.clear();
  pasangSah("f/0.webp");
  pasangBelumDiperiksa("f/1.webp");
  const campur = await resolveApprovedReference(["f/0.webp", "f/1.webp"]);
  catatKanariReferensi(campur, { runtime: "uji" }, tulis);
  assert.equal(campur.utama?.rel, "f/0.webp");
  assert.equal(ringkasanKanari().ditolakSemuaBelumDiperiksa, 0);
  assert.equal(ringkasanKanari().lolos, 1);
});

test("KANARI: galat membawa KODE dan rincian sebagai data — tidak ada yang perlu membaca kalimat", async () => {
  pasangBanner("g/0.webp");
  isi.set("g/1.webp", PACKSHOT); // sidecar hilang
  const hasil = await resolveApprovedReference(["g/0.webp", "g/1.webp"]);
  const pesan = pesanTanpaReferensi(hasil);
  const e = new GagalTanpaReferensi(pesan, hasil);

  assert.ok(e instanceof Error, "pencatat kegagalan lama memperlakukannya sebagai Error");
  assert.equal(e.message, pesan, "pesan untuk manusia berubah");
  assert.equal(e.kode, KODE_KANARI.TANPA_REFERENSI);
  assert.deepEqual(e.rincian, [
    { rel: "g/0.webp", alasan: ALASAN_TOLAK.PROMOSI },
    { rel: "g/1.webp", alasan: ALASAN_TOLAK.BUKTI_TIDAK_SAH, rinci: RINCI_TOLAK.SIDECAR_HILANG },
  ]);
});

test("KANARI: ringkasan yang dikembalikan adalah SALINAN", async () => {
  // Kalau bukan salinan, satu pemanggil bisa merusak cacah semua pemanggil lain
  // tanpa satu pun tanda — dan angka yang rusak diam-diam lebih buruk daripada
  // tidak ada angka.
  pasangBanner("h/0.webp");
  const { tulis } = penampung();
  catatKanariReferensi(await resolveApprovedReference(["h/0.webp"]), { runtime: "uji" }, tulis);
  const r = ringkasanKanari();
  r.dinilai = 999;
  r.perAlasan[ALASAN_TOLAK.PROMOSI] = 999;
  assert.equal(ringkasanKanari().dinilai, 1);
  assert.equal(ringkasanKanari().perAlasan[ALASAN_TOLAK.PROMOSI], 1);
});
