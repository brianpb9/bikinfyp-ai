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
