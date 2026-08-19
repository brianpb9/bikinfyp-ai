// Slice 4 (audit A5, 20 Agu 2026): anti-repeat mekanik per merek dari DB.
//
// Sebelum ini `mekanikBaruDipakai` tidak pernah diisi satu pun pemanggil, jadi
// jendela 30 hari selalu dinilai terhadap array kosong — mekanismenya lengkap
// dan mati. Kegagalannya senyap: mesin tetap menjawab, cuma variasinya tidak
// pernah terjadi.
//
// Mekanik dibaca dari kolom JSON yang SUDAH ada (scripts.validation_result ->
// admisi.mechanic), bukan kolom baru: migrasi terkunci sampai rekonsiliasi
// ledger selesai (keputusan Brian 20 Agu).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-riwayat-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-riwayat-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone } = await import("../lib/auth");
const { riwayatMekanikMerek, riwayatMekanikSqlite, bersihkanRiwayat, sejakKapan } = await import("../lib/script-engine/riwayat-mekanik");
const { urutkanMekanik } = await import("../lib/script-engine/idea-mechanics");

const db = getDb();
const user = findOrCreateUserByPhone("085555444333");

function buatProduk(nama: string, brand: string | null): string {
  const id = uuid();
  db.prepare(
    "INSERT INTO products (id, user_id, name, price_idr, category, images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?)"
  ).run(id, user.id, nama, 89000, "beauty", "[]", brand ? JSON.stringify({ brand }) : null, now());
  return id;
}

function buatSkrip(productId: string, mechanic: string | null, umurHari = 0) {
  const dibuat = new Date(Date.now() - umurHari * 86_400_000).toISOString();
  db.prepare(
    "INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, approved_by_user_at, edited_by_user, created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?)"
  ).run(uuid(), null, productId, "H1", "senang", "netral", "[]", "", "[]",
    JSON.stringify({ passed: true, errors: [], warnings: [], admisi: mechanic ? { contentType: "affiliate", mechanic } : { contentType: "affiliate" } }),
    "super_hq", null, 0, dibuat);
}

test("riwayat kosong untuk merek yang belum pernah dibuatkan naskah", async () => {
  const p = buatProduk("Serum Baru", "MerekBaru");
  assert.deepEqual(await riwayatMekanikMerek(p), []);
});

test("mekanik terbaca dari naskah merek yang SAMA, walau SKU berbeda", async () => {
  const a = buatProduk("Scarlett Serum", "Scarlett");
  const b = buatProduk("Scarlett Sabun", "Scarlett"); // SKU lain, merek sama
  buatSkrip(a, "secret");
  buatSkrip(b, "absence");
  const riwayat = await riwayatMekanikMerek(b);
  assert.deepEqual(riwayat.sort(), ["absence", "secret"], "dua SKU satu merek harus dihitung bersama");
});

test("merek LAIN tidak ikut terbawa", async () => {
  const lain = buatProduk("Somethinc Serum", "Somethinc");
  buatSkrip(lain, "confession");
  const scarlett = buatProduk("Scarlett Toner", "Scarlett");
  const riwayat = await riwayatMekanikMerek(scarlett);
  assert.ok(!riwayat.includes("confession" as never), `mekanik merek lain bocor: ${riwayat.join(",")}`);
});

test("naskah di luar jendela 30 hari TIDAK dihitung", async () => {
  const p = buatProduk("Wardah Lipstik", "Wardah");
  buatSkrip(p, "stakes", 45); // 45 hari lalu
  buatSkrip(p, "scale", 3);   // 3 hari lalu
  const riwayat = await riwayatMekanikMerek(p);
  assert.deepEqual(riwayat, ["scale"], `jendela 30 hari tidak dihormati: ${riwayat.join(",")}`);
});

test("produk TANPA merek jatuh ke riwayat produknya sendiri, bukan semua produk tanpa merek", async () => {
  const x = buatProduk("Produk Tanpa Merek A", null);
  const y = buatProduk("Produk Tanpa Merek B", null);
  buatSkrip(x, "forbidden");
  buatSkrip(y, "transformation");
  assert.deepEqual(await riwayatMekanikMerek(x), ["forbidden"]);
  assert.deepEqual(await riwayatMekanikMerek(y), ["transformation"]);
});

test("mekanik yang tidak dikenal bank diabaikan, bukan diteruskan", () => {
  assert.deepEqual(bersihkanRiwayat([{ mechanic: "mekanik_karangan" }, { mechanic: "secret" }, { mechanic: null }]), ["secret"]);
  // duplikat dibuang, urutan pertama dipertahankan
  assert.deepEqual(bersihkanRiwayat([{ mechanic: "scale" }, { mechanic: "scale" }, { mechanic: "absence" }]), ["scale", "absence"]);
});

test("riwayat BENAR-BENAR menggeser urutan bank mekanik", () => {
  const tanpa = urutkanMekanik([]).map((m) => m.id);
  const dengan = urutkanMekanik(["contrast", "anomaly_pov"] as never).map((m) => m.id);
  assert.notDeepEqual(tanpa, dengan, "riwayat harus mengubah prioritas — kalau tidak, seluruh rantai ini sia-sia");
  assert.ok(dengan.indexOf("contrast") > tanpa.indexOf("contrast"), "mekanik yang baru dipakai harus turun prioritas");
});

test("SQL PostgreSQL memakai kolom JSON yang ADA, bukan kolom baru", async () => {
  const { SQL_RIWAYAT_PG } = await import("../lib/script-engine/riwayat-mekanik");
  assert.match(SQL_RIWAYAT_PG, /validation_result::jsonb->'admisi'->>'mechanic'/, "harus membaca snapshot admisi");
  assert.match(SQL_RIWAYAT_PG, /raw_meta::jsonb->>'brand'/, "merek dibaca dari raw_meta, pola yang sama dengan slice C9");
  assert.ok(!/ALTER TABLE|s\.mechanic\b/.test(SQL_RIWAYAT_PG), "tidak boleh mengandaikan kolom mechanic — migrasi terkunci");
});

test("jendela dihitung dari sekarang, bukan tanggal keras", () => {
  const sejak = new Date(sejakKapan(30, new Date("2026-08-20T00:00:00.000Z")));
  assert.equal(sejak.toISOString(), "2026-07-21T00:00:00.000Z");
});

test("kegagalan riwayat TIDAK mematikan pembuatan naskah", () => {
  const rusak = { prepare: () => { throw new Error("tabel hilang"); } };
  assert.throws(() => riwayatMekanikSqlite(rusak as never, "x", "2026-01-01"), /tabel hilang/);
  // generateScripts menangkapnya (lihat lib/script-engine/index.ts) — anti-repeat
  // lapisan mutu, bukan syarat hidup.
});
