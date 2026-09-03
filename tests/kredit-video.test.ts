// KREDIT PER JENIS VIDEO — jalur uang, jadi yang diuji adalah hal-hal yang
// kalau lepas berarti orang kehilangan barang yang sudah dibayar, atau
// menerima barang yang belum dibayar.

import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.DB_PATH = `/tmp/racun-test-kreditvideo-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-kreditvideo-storage-${process.pid}`;

const { getDb, now, uuid } = await import("../lib/db");
const K = await import("../lib/kredit-video-sqlite");
const {
  emberUntukPakai, susunSisa, rapikanItem, totalTagihan, jenisUntukTier,
  akhirDari, langgananBerlaku, PesananTidakSah, MAKS_QTY_PER_JENIS,
} = await import("../lib/kredit-video");

const db = getDb();
let n = 0;
/**
 * Pengguna TANPA paket gratis pendaftaran.
 *
 * Dibuat langsung ke tabel, bukan lewat findOrCreateUser: pendaftaran memberi
 * 1 video premium, dan jatah bawaan itu akan tercampur dengan angka yang
 * sedang diuji di sini. Kebijakan paket gratisnya sendiri diuji terpisah di
 * tests/security-otp.test.ts.
 */
function pengguna() {
  n += 1;
  const id = uuid();
  db.prepare("INSERT INTO users (id, phone, tier, locale, created_at) VALUES (?,?,'free','id-ID',?)")
    .run(id, `0888000${String(1000 + n)}`, now());
  return { id };
}
/** Job nyata — kembalikanKredit memeriksa keadaan job, jadi barisnya harus ada. */
function job(userId: string, state = "QUEUED"): string {
  // Produk dan naskah ikut dibuat: jobs punya foreign key ke keduanya, dan
  // baris job yang tidak sah membuat tes ini menguji constraint, bukan aturan
  // kredit.
  const produkId = uuid();
  const naskahId = uuid();
  db.prepare(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES (?,?,'P',1000,'default','[]',?)",
  ).run(produkId, userId, now());
  db.prepare(
    `INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at)
     VALUES (?,?, 'H1','senang','netral','[]','','[]','{}',?)`,
  ).run(naskahId, produkId, now());
  const id = uuid();
  db.prepare(
    "INSERT INTO jobs (id,user_id,product_id,script_id,format,duration_s,state,created_at,state_changed_at) VALUES (?,?,?,?,'hands_only',15,?,?,?)",
  ).run(id, userId, produkId, naskahId, state, now(), now());
  return id;
}
function paket(over: Partial<Parameters<typeof K.simpanPaket>[0]> = {}) {
  const p = {
    id: `paket-${crypto.randomUUID().slice(0, 8)}`, nama: "Uji", keterangan: "",
    hargaIdr: 100_000, kuotaStandard: 2, kuotaPremium: 1, kuotaUltra: 0,
    masaHari: 30, urutan: 0, aktif: true, ...over,
  };
  K.simpanPaket(p);
  return p;
}

// ── Urutan ember ────────────────────────────────────────────────────────────

test("jatah LANGGANAN dihabiskan lebih dulu — yang akan hangus tidak boleh mengendap", () => {
  const u = pengguna();
  K.mulaiLangganan(u.id, paket({ kuotaPremium: 1, kuotaStandard: 0 }), null);
  K.bonusKredit(u.id, "premium", 1, "uji");
  assert.deepEqual(K.sisaKredit(u.id).premium, { langganan: 1, topup: 1, total: 2 });

  assert.equal(K.pakaiKredit(u.id, "premium", job(u.id)), "langganan");
  const sisa = K.sisaKredit(u.id).premium;
  assert.equal(sisa.langganan, 0, "yang terpakai justru jatah abadi — jatah paket akan hangus percuma");
  assert.equal(sisa.topup, 1);
});

test("kalau jatah paket habis, barulah jatah satuan dipakai", () => {
  const u = pengguna();
  K.bonusKredit(u.id, "ultra", 1, "uji");
  assert.equal(K.pakaiKredit(u.id, "ultra", job(u.id)), "topup");
  assert.equal(K.sisaKredit(u.id).ultra.total, 0);
  assert.equal(K.pakaiKredit(u.id, "ultra", job(u.id)), null, "jatah habis tapi masih boleh render");
});

test("langganan yang paling cepat berakhir dihabiskan lebih dulu", () => {
  const u = pengguna();
  const lamaId = K.mulaiLangganan(u.id, paket({ kuotaUltra: 1, masaHari: 365 }), null)!;
  const dekatId = K.mulaiLangganan(u.id, paket({ kuotaUltra: 1, masaHari: 3 }), null)!;
  const j = job(u.id);
  assert.equal(K.pakaiKredit(u.id, "ultra", j), "langganan");
  const baris = db.prepare("SELECT langganan_id FROM kredit_video WHERE job_id = ?").get(j) as { langganan_id: string };
  assert.equal(baris.langganan_id, dekatId, "yang dipakai justru langganan berumur panjang");
  assert.notEqual(baris.langganan_id, lamaId);
});

// ── Masa berlaku ────────────────────────────────────────────────────────────

test("jatah paket HILANG saat masa berlakunya lewat; jatah satuan tidak ikut hilang", () => {
  const u = pengguna();
  const id = K.mulaiLangganan(u.id, paket({ kuotaPremium: 5, kuotaStandard: 0 }), null)!;
  K.bonusKredit(u.id, "premium", 2, "uji");
  assert.equal(K.sisaKredit(u.id).premium.total, 7);

  // Dimundurkan lewat database, bukan lewat jam sistem: mengubah waktu proses
  // akan menguji jam, bukan aturan.
  db.prepare("UPDATE langganan SET berakhir_pada = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", id);
  const sisa = K.sisaKredit(u.id).premium;
  assert.equal(sisa.langganan, 0, "jatah paket masih dihitung setelah kedaluwarsa");
  assert.equal(sisa.topup, 2, "jatah satuan ikut hangus — padahal ia seumur hidup");
});

test("langganan yang dibatalkan berhenti memberi jatah", () => {
  const u = pengguna();
  const id = K.mulaiLangganan(u.id, paket({ kuotaStandard: 3 }), null)!;
  db.prepare("UPDATE langganan SET status = 'dibatalkan' WHERE id = ?").run(id);
  assert.equal(K.sisaKredit(u.id).standard.langganan, 0);
});

test("akhir masa dihitung dari mulai + masa hari, dalam UTC", () => {
  assert.equal(akhirDari("2026-09-02T00:00:00.000Z", 30), "2026-10-02T00:00:00.000Z");
  assert.equal(langgananBerlaku({ berakhirPada: "2026-10-02T00:00:00.000Z", status: "aktif" }, "2026-09-02T00:00:00.000Z"), true);
  assert.equal(langgananBerlaku({ berakhirPada: "2026-09-01T00:00:00.000Z", status: "aktif" }, "2026-09-02T00:00:00.000Z"), false);
  assert.equal(langgananBerlaku({ berakhirPada: "2099-01-01T00:00:00.000Z", status: "dibatalkan" }, "2026-09-02T00:00:00.000Z"), false);
});

// ── Idempotensi: uang tidak boleh terpotong atau kembali dua kali ───────────

test("satu job memotong jatah PERSIS SEKALI, walau diminta berkali-kali", () => {
  const u = pengguna();
  K.bonusKredit(u.id, "standard", 5, "uji");
  const j = job(u.id);
  assert.equal(K.pakaiKredit(u.id, "standard", j), "topup");
  assert.equal(K.pakaiKredit(u.id, "standard", j), "topup");
  assert.equal(K.pakaiKredit(u.id, "standard", j), "topup");
  assert.equal(K.sisaKredit(u.id).standard.total, 4, "percobaan ulang menagih lebih dari sekali");
});

test("jatah kembali ke EMBER DAN PERIODE yang sama, dan hanya sekali", () => {
  const u = pengguna();
  const id = K.mulaiLangganan(u.id, paket({ kuotaPremium: 1, kuotaStandard: 0 }), null)!;
  const j = job(u.id);
  assert.equal(K.pakaiKredit(u.id, "premium", j), "langganan");
  assert.equal(K.kembalikanKredit(u.id, j), true);
  assert.equal(K.kembalikanKredit(u.id, j), false, "dikembalikan dua kali");

  const sisa = K.sisaKredit(u.id).premium;
  assert.equal(sisa.langganan, 1, "jatah paket tidak kembali ke paketnya");
  assert.equal(sisa.topup, 0, "jatah paket berubah jadi jatah abadi — barang bocor");
  const kembali = db.prepare("SELECT langganan_id FROM kredit_video WHERE job_id = ? AND tipe = 'kembali'").get(j) as { langganan_id: string };
  assert.equal(kembali.langganan_id, id);
});

test("job yang SUDAH READY tidak dikembalikan — videonya sudah diterima", () => {
  const u = pengguna();
  K.bonusKredit(u.id, "ultra", 1, "uji");
  const j = job(u.id);
  K.pakaiKredit(u.id, "ultra", j);
  db.prepare("UPDATE jobs SET state = 'READY' WHERE id = ?").run(j);
  assert.equal(K.kembalikanKredit(u.id, j), false);
  assert.equal(K.sisaKredit(u.id).ultra.total, 0, "video sudah diserahkan tapi jatahnya dikembalikan");
});

test("job yang tidak pernah memotong jatah tidak bisa 'dikembalikan'", () => {
  const u = pengguna();
  assert.equal(K.kembalikanKredit(u.id, job(u.id)), false);
  assert.equal(K.sisaKredit(u.id).premium.total, 0, "jatah muncul dari ketiadaan");
});

// ── Pembelian ───────────────────────────────────────────────────────────────

test("topup dikreditkan sekali walau callback datang berkali-kali", () => {
  const u = pengguna();
  K.setHargaKredit("standard", 10_000, "admin");
  K.setHargaKredit("ultra", 20_000, "admin");
  const bayar = `order-${crypto.randomUUID().slice(0, 8)}`;
  const total = K.catatPesananTopup(bayar, [{ jenis: "standard", qty: 3 }, { jenis: "ultra", qty: 1 }], K.hargaKredit());
  assert.equal(total, 3 * 10_000 + 20_000);

  assert.equal(K.kreditkanTopup(u.id, bayar), 4);
  assert.equal(K.kreditkanTopup(u.id, bayar), 0, "callback ulangan menggandakan jatah");
  const sisa = K.sisaKredit(u.id);
  assert.equal(sisa.standard.topup, 3);
  assert.equal(sisa.ultra.topup, 1);
});

test("harga yang DISALIN saat memesan tidak ikut berubah kalau admin menaikkannya", () => {
  K.setHargaKredit("premium", 15_000, "admin");
  const bayar = `order-${crypto.randomUUID().slice(0, 8)}`;
  K.catatPesananTopup(bayar, [{ jenis: "premium", qty: 2 }], K.hargaKredit());
  K.setHargaKredit("premium", 99_000, "admin");
  const item = db.prepare("SELECT harga_satuan_idr FROM pesanan_item WHERE payment_id = ?").get(bayar) as { harga_satuan_idr: number };
  assert.equal(item.harga_satuan_idr, 15_000, "invoice yang belum dibayar ikut naik di belakang pembeli");
  K.setHargaKredit("premium", 15_000, "admin");
});

test("satu pembayaran hanya menghasilkan satu langganan", () => {
  const u = pengguna();
  const p = paket({ kuotaUltra: 3 });
  const bayar = `order-${crypto.randomUUID().slice(0, 8)}`;
  assert.ok(K.mulaiLangganan(u.id, p, bayar));
  assert.equal(K.mulaiLangganan(u.id, p, bayar), null, "callback ulangan memberi dua periode langganan");
  assert.equal(K.sisaKredit(u.id).ultra.langganan, 3);
});

test("kuota DISALIN saat membeli — mengubah paket tidak mengubah langganan berjalan", () => {
  const u = pengguna();
  const p = paket({ kuotaUltra: 2, kuotaPremium: 0, kuotaStandard: 0 });
  K.mulaiLangganan(u.id, p, null);
  K.simpanPaket({ ...p, kuotaUltra: 99 });
  assert.equal(K.sisaKredit(u.id).ultra.langganan, 2, "isi paket yang diubah admin merembes ke langganan yang sudah berjalan");
});

// ── Pemeriksaan pesanan ─────────────────────────────────────────────────────

test("isi pesanan dibersihkan: digabung, ditolak, dibatasi", () => {
  assert.deepEqual(rapikanItem([{ jenis: "premium", qty: 2 }, { jenis: "premium", qty: 3 }]), [{ jenis: "premium", qty: 5 }]);
  assert.deepEqual(rapikanItem([{ jenis: "ultra", qty: 0 }, { jenis: "standard", qty: 1 }]), [{ jenis: "standard", qty: 1 }]);
  // Urutannya selalu standard -> premium -> ultra, apa pun urutan kiriman klien.
  assert.deepEqual(
    rapikanItem([{ jenis: "ultra", qty: 1 }, { jenis: "standard", qty: 1 }]).map((i) => i.jenis),
    ["standard", "ultra"],
  );
  assert.throws(() => rapikanItem([{ jenis: "gratis", qty: 1 }]), PesananTidakSah);
  assert.throws(() => rapikanItem([{ jenis: "premium", qty: -3 }]), PesananTidakSah);
  assert.throws(() => rapikanItem([{ jenis: "premium", qty: 1.5 }]), PesananTidakSah);
  assert.throws(() => rapikanItem([{ jenis: "premium", qty: MAKS_QTY_PER_JENIS + 1 }]), PesananTidakSah);
  assert.throws(() => rapikanItem([]), PesananTidakSah);
  assert.throws(() => rapikanItem("bukan daftar"), PesananTidakSah);
});

test("jenis yang harganya belum diatur DITOLAK, bukan dihitung nol", () => {
  assert.throws(() => totalTagihan([{ jenis: "ultra", qty: 2 }], { standard: 10_000 }), PesananTidakSah);
  assert.throws(() => totalTagihan([{ jenis: "ultra", qty: 2 }], { ultra: 0 }), PesananTidakSah);
  assert.equal(totalTagihan([{ jenis: "ultra", qty: 2 }], { ultra: 20_000 }), 40_000);
});

// ── Pemetaan tier ───────────────────────────────────────────────────────────

test("tier lama tetap MEMBAYAR, dari jatah yang setara", () => {
  assert.equal(jenisUntukTier("high_quality"), "premium");
  assert.equal(jenisUntukTier("super_hq"), "ultra");
  assert.equal(jenisUntukTier("silent_caption"), "premium");
  for (const j of ["standard", "premium", "ultra"] as const) assert.equal(jenisUntukTier(j), j);
});

// ── Aturan murni ────────────────────────────────────────────────────────────

test("sisa negatif tidak pernah ditampilkan, dan tidak menular ke jenis lain", () => {
  const s = susunSisa({ premium: -5 }, { premium: 2, ultra: 3 });
  assert.deepEqual(s.premium, { langganan: 0, topup: 2, total: 2 });
  assert.deepEqual(s.ultra, { langganan: 0, topup: 3, total: 3 });
  assert.deepEqual(s.standard, { langganan: 0, topup: 0, total: 0 });
});

test("ember dipilih sesuai aturan, dan null berarti benar-benar habis", () => {
  const s = (l: number, t: number) => susunSisa({ ultra: l }, { ultra: t });
  assert.equal(emberUntukPakai(s(1, 1), "ultra"), "langganan");
  assert.equal(emberUntukPakai(s(0, 1), "ultra"), "topup");
  assert.equal(emberUntukPakai(s(0, 0), "ultra"), null);
});

// ── Dua runtime, satu aturan ────────────────────────────────────────────────
//
// Produksi berjalan di PostgreSQL, tes ini di SQLite. Aturannya sendiri hidup
// di lib/kredit-video.ts dan dipanggil keduanya — tapi SQL-nya ditulis dua
// kali, dan dua salinan SQL yang harus sama selamanya akan hanyut. Yang
// dijaga di sini: bagian yang menentukan UANG tidak boleh berbeda.

test("kedua runtime memilih langganan dengan aturan yang sama", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");
  const pg = baca("lib/postgres/kredit-video.ts");
  const sq = baca("lib/kredit-video-sqlite.ts");

  for (const [nama, src] of [["postgres", pg], ["sqlite", sq]] as const) {
    // Masa berlaku diperiksa sebagai PERBANDINGAN STRING atas ISO UTC, bukan
    // aritmetika waktu SQL — kolomnya bertipe TEXT, dan `NOW() - INTERVAL` di
    // kolom TEXT pernah membuat /admin 500.
    assert.match(src, /l\.status = 'aktif' AND l\.berakhir_pada >/, `${nama}: masa berlaku tidak diperiksa`);
    assert.doesNotMatch(src, /berakhir_pada[^\n]*INTERVAL/, `${nama}: aritmetika waktu SQL di kolom TEXT`);
    // Yang paling cepat berakhir dihabiskan lebih dulu.
    assert.match(src, /ORDER BY l\.berakhir_pada ASC/, `${nama}: urutan pemakaian jatah tidak dijamin`);
    // Keputusan embernya diambil dari aturan bersama, bukan ditulis ulang.
    assert.match(src, /emberUntukPakai\(/, `${nama}: menulis ulang aturan pemilihan ember`);
    // Pengembalian selalu ke ember dan periode asal.
    assert.match(src, /tipe = 'pakai'/, `${nama}: asal pemotongan tidak dibaca saat mengembalikan`);
  }
});

// ── PESANAN CAMPURAN: paket + satuan dalam satu pembayaran ──────────────────
//
// Dilarang di versi pertama dengan alasan "callback harus menebak apa yang
// dibeli". Alasan itu keliru: ia tidak menebak apa pun — paket tercatat di
// payments.paket_id, satuan di pesanan_item. Biaya larangannya ditanggung
// pembeli, yang harus membayar dua kali ke dua nomor VA berbeda.

test("satu pembayaran boleh memberi langganan DAN kredit satuan sekaligus", () => {
  const u = pengguna();
  const bayar = `order-${crypto.randomUUID().slice(0, 8)}`;
  const p = paket({ kuotaPremium: 2, kuotaStandard: 0 });
  K.setHargaKredit("standard", 14_000, "admin");

  // Dua bagian, satu payment_id — persis bentuk pesanan campuran.
  K.catatPesananTopup(bayar, [{ jenis: "standard", qty: 3 }], K.hargaKredit());
  assert.ok(K.mulaiLangganan(u.id, p, bayar));
  assert.equal(K.kreditkanTopup(u.id, bayar), 3);

  const sisa = K.sisaKredit(u.id);
  assert.equal(sisa.premium.langganan, 2, "jatah paket tidak masuk");
  assert.equal(sisa.standard.topup, 3, "kredit satuan tidak masuk");
});

test("callback ulangan untuk pesanan campuran tidak memberi dua kali", () => {
  const u = pengguna();
  const bayar = `order-${crypto.randomUUID().slice(0, 8)}`;
  const p = paket({ kuotaUltra: 1, kuotaPremium: 0, kuotaStandard: 0 });
  K.setHargaKredit("premium", 44_000, "admin");
  K.catatPesananTopup(bayar, [{ jenis: "premium", qty: 2 }], K.hargaKredit());

  // Panggilan pertama.
  assert.ok(K.mulaiLangganan(u.id, p, bayar));
  assert.equal(K.kreditkanTopup(u.id, bayar), 2);
  // Callback datang lagi — dan memang pernah begitu di produksi.
  assert.equal(K.mulaiLangganan(u.id, p, bayar), null, "langganan kedua dari satu pembayaran");
  assert.equal(K.kreditkanTopup(u.id, bayar), 0, "kredit diberikan dua kali");

  const sisa = K.sisaKredit(u.id);
  assert.equal(sisa.ultra.langganan, 1);
  assert.equal(sisa.premium.topup, 2);
});

// ── SUDAH BERLANGGANAN, BERLANGGANAN LAGI ──────────────────────────────────
//
// Kasus yang ditanyakan Brian. Jawabannya: DITUMPUK, bukan ditolak dan bukan
// mengganti. Ia membayar dua kali, jadi ia menerima dua kali — dan tiap
// periode habis pada tanggalnya sendiri.

test("langganan kedua DITAMBAHKAN ke yang masih aktif, bukan menggantikannya", () => {
  const u = pengguna();
  const pertama = K.mulaiLangganan(u.id, paket({ kuotaPremium: 2, kuotaStandard: 0, masaHari: 30 }), `bayar-${crypto.randomUUID().slice(0, 6)}`)!;
  const kedua = K.mulaiLangganan(u.id, paket({ kuotaPremium: 3, kuotaStandard: 0, masaHari: 30 }), `bayar-${crypto.randomUUID().slice(0, 6)}`)!;
  assert.notEqual(pertama, kedua);

  // Jatahnya DIJUMLAH — yang lama tidak hilang, yang baru tidak menimpa.
  assert.equal(K.sisaKredit(u.id).premium.langganan, 5, "jatah salah satu periode hilang");
  assert.equal(K.langgananAktif(u.id).length, 2);
});

test("yang paling cepat berakhir dihabiskan lebih dulu di antara dua langganan", () => {
  const u = pengguna();
  const panjang = K.mulaiLangganan(u.id, paket({ kuotaPremium: 1, kuotaStandard: 0, masaHari: 60 }), null)!;
  const pendek = K.mulaiLangganan(u.id, paket({ kuotaPremium: 1, kuotaStandard: 0, masaHari: 5 }), null)!;
  const j = job(u.id);
  assert.equal(K.pakaiKredit(u.id, "premium", j), "langganan");
  const baris = db.prepare("SELECT langganan_id FROM kredit_video WHERE job_id = ?").get(j) as { langganan_id: string };
  assert.equal(baris.langganan_id, pendek, "jatah yang lebih dulu hangus justru dibiarkan mengendap");
  assert.notEqual(baris.langganan_id, panjang);
});

test("periode yang habis tidak menyeret periode lain yang masih hidup", () => {
  const u = pengguna();
  const lama = K.mulaiLangganan(u.id, paket({ kuotaUltra: 2, kuotaPremium: 0, kuotaStandard: 0 }), null)!;
  K.mulaiLangganan(u.id, paket({ kuotaUltra: 3, kuotaPremium: 0, kuotaStandard: 0 }), null);
  db.prepare("UPDATE langganan SET berakhir_pada = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", lama);
  assert.equal(K.sisaKredit(u.id).ultra.langganan, 3, "periode yang masih hidup ikut hilang");
});

// ── PERPANJANGAN: paket SAMA menambah masa, paket BEDA menumpuk ─────────────
//
// Sampai 3 Sep 2026 membeli paket yang sama melahirkan periode kedua yang
// berdampingan. Dijalankan sebagai skenario nyata: sisa 3 video dengan 5 hari
// lagi, beli Mulai lagi -> 9 video, TAPI 3 di antaranya tetap hangus dalam 5
// hari. Urutan "paling cepat hangus dulu" memperkecil kerugiannya, tidak
// menghilangkannya.

test("beli paket YANG SAMA memperpanjang periode yang ada, bukan membuat kedua", () => {
  const u = pengguna();
  const p = paket({ kuotaStandard: 6, kuotaPremium: 0, kuotaUltra: 0, masaHari: 30 });
  const id = K.mulaiLangganan(u.id, p, `bayar-${crypto.randomUUID().slice(0, 6)}`)!;

  // Dipakai 3, dan tinggal 5 hari lagi.
  for (let i = 0; i < 3; i++) K.pakaiKredit(u.id, "standard", job(u.id));
  const lima = new Date(Date.now() + 5 * 86_400_000).toISOString();
  db.prepare("UPDATE langganan SET berakhir_pada = ? WHERE id = ?").run(lima, id);
  assert.equal(K.sisaKredit(u.id).standard.langganan, 3);

  const idKedua = K.mulaiLangganan(u.id, p, `bayar-${crypto.randomUUID().slice(0, 6)}`);
  assert.equal(idKedua, id, "periode kedua dibuat — seharusnya periode yang ada diperpanjang");
  assert.equal(K.langgananAktif(u.id).length, 1, "ada dua periode aktif untuk paket yang sama");
  assert.equal(K.sisaKredit(u.id).standard.langganan, 9, "kuota tidak dijumlahkan");

  // Tanggalnya DIDORONG dari tanggal lama, bukan dihitung dari hari ini —
  // itulah bedanya "perpanjang" dari "mulai lagi".
  const baris = db.prepare("SELECT berakhir_pada FROM langganan WHERE id = ?").get(id) as { berakhir_pada: string };
  const seharusnya = new Date(Date.parse(lima) + 30 * 86_400_000).toISOString();
  assert.equal(baris.berakhir_pada, seharusnya, "tanggal berakhir tidak didorong dari tanggal lama");
});

test("perpanjangan meninggalkan jejak: tanggal sebelum dan sesudah", () => {
  const u = pengguna();
  const p = paket({ kuotaUltra: 2, kuotaStandard: 0, kuotaPremium: 0 });
  const id = K.mulaiLangganan(u.id, p, `bayar-${crypto.randomUUID().slice(0, 6)}`)!;
  const sebelum = (db.prepare("SELECT berakhir_pada FROM langganan WHERE id = ?").get(id) as { berakhir_pada: string }).berakhir_pada;
  const bayar = `bayar-${crypto.randomUUID().slice(0, 6)}`;
  K.mulaiLangganan(u.id, p, bayar);

  const jejak = db.prepare("SELECT * FROM langganan_perpanjangan WHERE payment_id = ?").get(bayar) as
    { langganan_id: string; hari: number; berakhir_sebelum: string; berakhir_sesudah: string; kuota_ultra: number };
  assert.equal(jejak.langganan_id, id);
  assert.equal(jejak.hari, p.masaHari);
  assert.equal(jejak.kuota_ultra, 2);
  assert.equal(jejak.berakhir_sebelum, sebelum, "jejak tidak mencatat tanggal sebelum diperpanjang");
  assert.notEqual(jejak.berakhir_sesudah, sebelum);
});

test("callback ulangan TIDAK memperpanjang dua kali", () => {
  // Idempotensinya pindah: perpanjangan tidak melahirkan baris langganan, jadi
  // uniq_langganan_payment tidak lagi menjaganya. Kunci primer payment_id di
  // langganan_perpanjangan yang memulihkannya.
  const u = pengguna();
  const p = paket({ kuotaPremium: 3, kuotaStandard: 0, kuotaUltra: 0 });
  const id = K.mulaiLangganan(u.id, p, `bayar-${crypto.randomUUID().slice(0, 6)}`)!;
  const bayar = `bayar-${crypto.randomUUID().slice(0, 6)}`;

  assert.equal(K.mulaiLangganan(u.id, p, bayar), id);
  const setelahSatu = (db.prepare("SELECT berakhir_pada, kuota_premium FROM langganan WHERE id = ?").get(id)) as
    { berakhir_pada: string; kuota_premium: number };

  assert.equal(K.mulaiLangganan(u.id, p, bayar), null, "pembayaran yang sama memperpanjang dua kali");
  const setelahDua = (db.prepare("SELECT berakhir_pada, kuota_premium FROM langganan WHERE id = ?").get(id)) as
    { berakhir_pada: string; kuota_premium: number };

  assert.equal(setelahDua.berakhir_pada, setelahSatu.berakhir_pada, "tanggal didorong dua kali");
  assert.equal(setelahDua.kuota_premium, setelahSatu.kuota_premium, "kuota ditambah dua kali");
});

test("paket BERBEDA tetap menumpuk — tidak ada kuota lama yang hilang", () => {
  const u = pengguna();
  const kecil = paket({ id: "uji-kecil", kuotaStandard: 6, kuotaPremium: 0, kuotaUltra: 0 });
  const besar = paket({ id: "uji-besar", kuotaStandard: 10, kuotaPremium: 2, kuotaUltra: 0 });
  K.mulaiLangganan(u.id, kecil, `bayar-${crypto.randomUUID().slice(0, 6)}`);
  K.mulaiLangganan(u.id, besar, `bayar-${crypto.randomUUID().slice(0, 6)}`);

  assert.equal(K.langgananAktif(u.id).length, 2, "naik paket menghapus periode lama");
  const sisa = K.sisaKredit(u.id);
  assert.equal(sisa.standard.langganan, 16, "kuota paket lama hilang saat naik paket");
  assert.equal(sisa.premium.langganan, 2);
});

test("langganan yang SUDAH kedaluwarsa tidak diperpanjang — ia mulai periode baru", () => {
  // Memperpanjang periode mati akan menghidupkan kembali kuota yang sudah
  // hangus, dan tanggalnya dihitung dari masa lalu.
  const u = pengguna();
  const p = paket({ kuotaStandard: 6, kuotaPremium: 0, kuotaUltra: 0 });
  const id = K.mulaiLangganan(u.id, p, `bayar-${crypto.randomUUID().slice(0, 6)}`)!;
  db.prepare("UPDATE langganan SET berakhir_pada = ? WHERE id = ?").run("2020-01-01T00:00:00.000Z", id);

  const baru = K.mulaiLangganan(u.id, p, `bayar-${crypto.randomUUID().slice(0, 6)}`);
  assert.notEqual(baru, id, "periode yang sudah mati justru diperpanjang");
  assert.equal(K.sisaKredit(u.id).standard.langganan, 6, "kuota periode mati ikut dihidupkan");
});
