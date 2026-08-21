// P0-B3 — SUMBER AUDIT: alat ukur tidak boleh mengubah yang diukurnya.
//
// Versi pertama jalur SQLite memanggil `getDb()`. Itu bukan pembuka koneksi:
// ia meng-exec seluruh schema lalu menjalankan migrasi — DROP TABLE, sederet
// ALTER TABLE, sebuah UPDATE, dan pembangunan ulang tabel `users` lewat rename.
// Menjalankan audit terhadap database SQLite akan MENGUBAHNYA, dan angka yang
// dilaporkan jadi angka dari database yang berbeda dari yang dilaporkannya.
//
// Test ini mengunci tiga hal:
//   1. Byte database IDENTIK sesudah audit — dibandingkan lewat sha256 berkas.
//   2. Tidak ada berkas turunan baru (-wal/-shm): menyalakan WAL saja sudah
//      perubahan, dan pada database produksi itu perubahan yang tidak diminta.
//   3. Database yang TIDAK ADA menghasilkan galat, bukan database kosong baru.
//      Laporan bersih dari database yang baru saja kita ciptakan sendiri adalah
//      kebohongan yang paling meyakinkan.

import { test, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import Database from "better-sqlite3";

process.env.RACUN_NO_DOTENV = "1";

const { dariSqlite } = await import("../lib/audit-sumber-produk");
const { KOLOM_RUSAK, auditBuktiProduk } = await import("../lib/audit-bukti-produk");

const dir = fs.mkdtempSync(path.join(os.tmpdir(), "audit-sumber-"));
after(() => fs.rmSync(dir, { recursive: true, force: true }));

const sha = (f: string) => crypto.createHash("sha256").update(fs.readFileSync(f)).digest("hex");

/** Database sintetis: hanya tabel `products`, ditutup rapat sebelum diaudit. */
function bikinDb(nama: string): string {
  const p = path.join(dir, nama);
  const db = new Database(p);
  db.exec(
    "CREATE TABLE products (id TEXT PRIMARY KEY, org_id TEXT, name TEXT, images TEXT NOT NULL DEFAULT '[]', created_at TEXT NOT NULL)"
  );
  const ins = db.prepare("INSERT INTO products (id, org_id, name, images, created_at) VALUES (?,?,?,?,?)");
  ins.run("p1", null, "retail", JSON.stringify(["p1/0.webp"]), "2026-08-01");
  ins.run("p2", "org-7", "enterprise", JSON.stringify(["p2/0.webp", "p2/1.webp"]), "2026-08-02");
  ins.run("p3", "org-7", "kolom korup", "{bukan json", "2026-08-03");
  ins.run("p4", null, "kosong", "[]", "2026-08-04");
  // `images TEXT NOT NULL DEFAULT '[]'`: string kosong memenuhi NOT NULL tapi
  // BUKAN daftar kosong yang sah — tidak satu pun jalur ingestion menulisnya.
  ins.run("p5", "org-7", "string kosong", "", "2026-08-05");
  ins.run("p6", null, "whitespace", "   ", "2026-08-06");
  ins.run("p7", "org-2", "path traversal", JSON.stringify(["../rahasia.webp"]), "2026-08-07");
  // WAL dimatikan lagi dan koneksi ditutup supaya sidik jari berkas stabil.
  db.pragma("journal_mode = DELETE");
  db.close();
  return p;
}

async function kumpulkan(p: string) {
  const out = [];
  for await (const r of dariSqlite(p)) out.push(r);
  return out;
}

test("SUMBER SQLITE: audit tidak mengubah satu byte pun database yang diukurnya", async () => {
  const p = bikinDb("utuh.db");
  const sebelum = sha(p);
  const skemaSebelum = new Database(p, { readonly: true }).prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name").all();
  const isiDirSebelum = fs.readdirSync(dir).sort();

  await kumpulkan(p);

  assert.equal(
    sha(p),
    sebelum,
    "byte database berubah sesudah audit — alat ukur mengubah yang diukurnya, jadi angkanya tidak bisa direproduksi"
  );
  assert.deepEqual(
    new Database(p, { readonly: true }).prepare("SELECT type,name,sql FROM sqlite_master ORDER BY name").all(),
    skemaSebelum,
    "skema berubah sesudah audit — migrasi ikut jalan"
  );
  assert.deepEqual(
    fs.readdirSync(dir).sort(),
    isiDirSebelum,
    "audit membuat berkas turunan baru (-wal/-shm); menyalakan WAL pada database produksi adalah perubahan yang tidak diminta"
  );
});

test("SUMBER SQLITE: org_id ikut terbawa — laporan Enterprise tanpa organisasi tidak bisa ditindaklanjuti", async () => {
  const baris = await kumpulkan(bikinDb("org.db"));
  assert.deepEqual(
    baris.map((b) => [b.id, b.orgId]),
    [
      ["p1", null],
      ["p2", "org-7"],
      ["p3", "org-7"],
      ["p4", null],
      ["p5", "org-7"],
      ["p6", null],
      ["p7", "org-2"],
    ],
    "orgId hilang: seluruh entri Enterprise dilaporkan tanpa pemilik"
  );
  assert.deepEqual(
    baris.map((b) => b.nama),
    ["retail", "enterprise", "kolom korup", "kosong", "string kosong", "whitespace", "path traversal"]
  );
});

test("SUMBER SQLITE: kolom rusak sampai ke audit sebagai RUSAK, bukan sebagai kosong", async () => {
  const baris = await kumpulkan(bikinDb("rusak.db"));
  const p3 = baris.find((b) => b.id === "p3")!;
  assert.deepEqual(p3.images, { ok: false, sebab: KOLOM_RUSAK.JSON_KORUP, contoh: "{bukan json" });
  const p4 = baris.find((b) => b.id === "p4")!;
  assert.deepEqual(p4.images, { ok: true, images: [] }, "kolom kosong yang SAH tidak boleh dilaporkan rusak");
  const p2 = baris.find((b) => b.id === "p2")!;
  assert.deepEqual(p2.images, { ok: true, images: ["p2/0.webp", "p2/1.webp"] });
});

test("SUMBER SQLITE: images='' dari database NYATA masuk ember kolom rusak, bukan tanpa-foto", async () => {
  // Fixture end-to-end: baris ini datang dari SQLite sungguhan, bukan dari
  // pemanggilan parser langsung, karena di sinilah nilai seperti itu benar-benar
  // muncul pada data legacy.
  const baris = await kumpulkan(bikinDb("kosong.db"));
  const ambil = (id: string) => baris.find((b) => b.id === id)!.images;

  assert.deepEqual(ambil("p5"), { ok: false, sebab: KOLOM_RUSAK.KOSONG, contoh: '""' }, "images='' dilaporkan sebagai tanpa foto");
  assert.deepEqual(ambil("p6"), { ok: false, sebab: KOLOM_RUSAK.KOSONG, contoh: '"   "' });
  assert.deepEqual(ambil("p7"), {
    ok: false,
    sebab: KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI,
    contoh: '["../rahasia.webp"]',
  });

  const h = await auditBuktiProduk(baris);
  assert.equal(h.produkKolomRusak, 4, "p3, p5, p6, p7");
  assert.equal(h.produkTanpaFoto, 1, "hanya p4 (images='[]') yang benar-benar tanpa foto");
  assert.equal(h.produkGagalDiperiksa, 0, "tidak ada baris yang boleh meledak setelah validasi kunci");
  assert.deepEqual(
    h.kolomRusak.map((k) => [k.id, k.sebab, k.orgId]),
    [
      ["p3", KOLOM_RUSAK.JSON_KORUP, "org-7"],
      ["p5", KOLOM_RUSAK.KOSONG, "org-7"],
      ["p6", KOLOM_RUSAK.KOSONG, null],
      ["p7", KOLOM_RUSAK.ELEMEN_BUKAN_KUNCI, "org-2"],
    ]
  );
});

test("SUMBER SQLITE: database yang tidak ada = galat, BUKAN database kosong baru", async () => {
  const hilang = path.join(dir, "tidak-ada.db");
  await assert.rejects(
    () => kumpulkan(hilang),
    /unable to open|does not exist|SQLITE_CANTOPEN/i,
    "audit menerima database yang tidak ada"
  );
  assert.equal(
    fs.existsSync(hilang),
    false,
    "audit MEMBUAT database yang tidak ada lalu mengauditnya; laporan bersih dari database ciptaan sendiri adalah kebohongan yang paling meyakinkan"
  );
});
