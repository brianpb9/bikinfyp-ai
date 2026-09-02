/**
 * BUKTI bahwa aturan kredit video berlaku sama di PostgreSQL.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA INI PERLU ADA
 * ─────────────────────────────────────────────────────────────────────────────
 * tests/kredit-video.test.ts menjalankan seluruh aturannya di SQLite, karena
 * itu yang bisa dijalankan tanpa server. Tapi PRODUKSI berjalan di PostgreSQL,
 * dengan SQL yang ditulis terpisah — dan yang dijaga di sini bukan angka,
 * melainkan barang yang dibayar orang. Aturan yang benar di satu runtime dan
 * salah di runtime yang dipakai pelanggan bukan aturan.
 *
 * Skrip ini dijalankan DI SERVER, terhadap database sungguhan, lalu MEMBERSIHKAN
 * dirinya sendiri: akun uji dan seluruh barisnya dihapus di akhir, sukses
 * maupun gagal. Ia tidak pernah menyentuh baris milik orang lain.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { getPool } from "../lib/postgres/pool";
import { PgKreditVideo } from "../lib/postgres/kredit-video";
import { config } from "../lib/config";

const pool = getPool(config.databaseUrl);
const repo = new PgKreditVideo(config.databaseUrl);
const jejak = `uji-kredit-${crypto.randomUUID().slice(0, 8)}`;
const userId = crypto.randomUUID();
const at = () => new Date().toISOString();

const dibuat: { tabel: string; id: string }[] = [];

async function buatJob(): Promise<string> {
  const produk = crypto.randomUUID();
  const naskah = crypto.randomUUID();
  const job = crypto.randomUUID();
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Uji',1000,'default','[]',$3)",
    [produk, userId, at()],
  );
  await pool.query(
    `INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at)
     VALUES ($1,$2,'H1','senang','netral','[]','','[]','{}',$3)`,
    [naskah, produk, at()],
  );
  await pool.query(
    `INSERT INTO jobs (id,user_id,product_id,script_id,format,duration_s,state,created_at,state_changed_at)
     VALUES ($1,$2,$3,$4,'hands_only',15,'QUEUED',$5,$5)`,
    [job, userId, produk, naskah, at()],
  );
  dibuat.push({ tabel: "jobs", id: job }, { tabel: "scripts", id: naskah }, { tabel: "products", id: produk });
  return job;
}

const paket = {
  id: `${jejak}-paket`, nama: "Paket Uji", keterangan: "", hargaIdr: 1000,
  kuotaStandard: 0, kuotaPremium: 1, kuotaUltra: 0, masaHari: 30, urutan: 999, aktif: false,
};

async function bersihkan() {
  // Urutan anak -> induk, sama seperti skrip pembersihan data uji.
  await pool.query("DELETE FROM kredit_video WHERE user_id = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM langganan WHERE user_id = $1", [userId]).catch(() => {});
  for (const { tabel, id } of dibuat) await pool.query(`DELETE FROM ${tabel} WHERE id = $1`, [id]).catch(() => {});
  await pool.query("DELETE FROM audit_log WHERE actor = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM paket_langganan WHERE id = $1", [paket.id]).catch(() => {});
  await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
}

try {
  await pool.query("INSERT INTO users (id,phone,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)", [
    userId, `0899${Date.now().toString().slice(-8)}`, at(),
  ]);
  await repo.simpanPaket(paket);

  // 1. Jatah paket dihabiskan lebih dulu.
  await repo.mulaiLangganan(userId, paket, null);
  await repo.bonus(userId, "premium", 1, jejak);
  let sisa = await repo.sisa(userId);
  assert.deepEqual(sisa.premium, { langganan: 1, topup: 1, total: 2 }, "sisa awal salah");

  const job1 = await buatJob();
  assert.equal(await repo.pakai(userId, "premium", job1), "langganan", "jatah paket tidak didahulukan");
  sisa = await repo.sisa(userId);
  assert.equal(sisa.premium.langganan, 0);
  assert.equal(sisa.premium.topup, 1, "jatah abadi ikut terpakai");

  // 2. Idempoten: percobaan ulang bukan pembayaran kedua.
  assert.equal(await repo.pakai(userId, "premium", job1), "langganan");
  assert.equal((await repo.sisa(userId)).premium.total, 1, "job yang sama menagih dua kali");

  // 3. Pengembalian ke ember dan periode ASAL, hanya sekali.
  assert.equal(await repo.kembalikan(userId, job1), true);
  assert.equal(await repo.kembalikan(userId, job1), false, "dikembalikan dua kali");
  sisa = await repo.sisa(userId);
  assert.equal(sisa.premium.langganan, 1, "jatah paket tidak kembali ke paketnya");
  assert.equal(sisa.premium.topup, 1, "jatah paket berubah jadi jatah abadi");

  // 4. Job yang sudah READY tidak dikembalikan.
  const job2 = await buatJob();
  await repo.pakai(userId, "premium", job2);
  await pool.query("UPDATE jobs SET state = 'READY' WHERE id = $1", [job2]);
  assert.equal(await repo.kembalikan(userId, job2), false, "video sudah diserahkan tapi jatahnya dikembalikan");

  // 5. Masa berlaku benar-benar menghapus jatah paket.
  await pool.query("UPDATE langganan SET berakhir_pada = '2020-01-01T00:00:00.000Z' WHERE user_id = $1", [userId]);
  sisa = await repo.sisa(userId);
  assert.equal(sisa.premium.langganan, 0, "jatah paket kedaluwarsa masih dihitung");
  assert.equal(sisa.premium.topup, 1, "jatah satuan ikut hangus — padahal seumur hidup");

  // 6. Jatah habis dijawab null, bukan galat.
  const job3 = await buatJob();
  await repo.pakai(userId, "premium", job3);
  const job4 = await buatJob();
  assert.equal(await repo.pakai(userId, "premium", job4), null, "render diizinkan tanpa jatah");

  console.log(JSON.stringify({ status: "PASS", runtime: "postgres", user: userId.slice(0, 8) }));
} catch (err) {
  console.error(JSON.stringify({ status: "FAIL", error: err instanceof Error ? err.message : String(err) }));
  process.exitCode = 1;
} finally {
  await bersihkan();
}
