/**
 * Uji CONCURRENCY sungguhan terhadap PostgreSQL — bukan simulasi serial.
 *
 * Ini ada karena tes serial SQLite MELEWATKAN cacat yang paling mahal. Putaran
 * audit ketiga membuktikannya dengan angka: reconcileReadyHolds() versi pertama
 * lulus seluruh 395 tes yang ada, lalu tetap menghasilkan capture ganda pada 14
 * dari 30 job ketika 8 reconciler berjalan bersamaan — sebagian sampai enam
 * capture untuk satu job. Cacat uang tidak muncul pada eksekusi berurutan;
 * ia hanya muncul saat dua proses membaca keadaan yang sama sebelum salah
 * satunya menulis.
 *
 * Dilewati (bukan gagal) kalau UJI_PG_URL tidak diisi, supaya `npm test` di
 * mesin tanpa PostgreSQL tetap jalan. Jalankan dengan:
 *
 *   UJI_PG_URL=postgres://... npx tsx --test tests/pg-konkurensi-kredit.test.ts
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool } from "pg";

const URL_UJI = process.env.UJI_PG_URL ?? "";
const lewati = !URL_UJI;

let pool: Pool;
const at = () => new Date().toISOString();
const id = () => crypto.randomUUID();

before(async () => { if (!lewati) pool = new Pool({ connectionString: URL_UJI, max: 20 }); });
after(async () => { if (!lewati && pool) await pool.end(); });

/** Bikin satu job READY yang hold-nya belum pernah di-capture. */
async function jobReadyBerhold(userId: string): Promise<string> {
  const pid = id(), sid = id(), jid = id(), t = at();
  await pool.query("INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Uji',12000,'beauty','[]',$3)", [pid, userId, t]);
  await pool.query(
    "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,created_at) VALUES ($1,$2,'H1','senang','netral','[]','c','[]','{}',$3)",
    [sid, pid, t]
  );
  await pool.query(
    "INSERT INTO jobs (id,user_id,product_id,script_id,format,quality_tier,duration_s,state,created_at,state_changed_at) VALUES ($1,$2,$3,$4,'hands_only','high_quality',15,'READY',$5,$5)",
    [jid, userId, pid, sid, t]
  );
  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-12000,'hold',$3,$4)",
    [id(), userId, jid, t]
  );
  return jid;
}

async function penggunaUji(): Promise<string> {
  const uid = id();
  await pool.query("INSERT INTO users (id,email,created_at) VALUES ($1,$2,$3)", [uid, `uji-${uid}@contoh.test`, at()]);
  return uid;
}

test("indeks unik menolak catatan terminal kedua untuk satu job", { skip: lewati }, async () => {
  const uid = await penggunaUji();
  const jid = await jobReadyBerhold(uid);
  await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,0,'capture',$3,$4)", [id(), uid, jid, at()]);

  // Capture kedua HARUS ditolak database, bukan bergantung pada kode pemanggil.
  await assert.rejects(
    () => pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,0,'capture',$3,$4)", [id(), uid, jid, at()]),
    (err: { code?: string }) => err.code === "23505",
    "capture kedua harus melanggar uniq_ledger_terminal_per_job"
  );
  // Release setelah capture juga terminal kedua — sama-sama ditolak. Inilah
  // yang menutup balapan capture-versus-release tanpa bergantung pada lock.
  await assert.rejects(
    () => pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,12000,'release',$3,$4)", [id(), uid, jid, at()]),
    (err: { code?: string }) => err.code === "23505",
    "release setelah capture harus ditolak"
  );
});

test("8 reconciler paralel atas 30 job READY: tepat satu capture per job", { skip: lewati }, async () => {
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  const uid = await penggunaUji();
  const jobIds: string[] = [];
  for (let i = 0; i < 30; i++) jobIds.push(await jobReadyBerhold(uid));

  // Persis bentuk serangan yang dipakai audit: banyak sweeper berebut baris
  // yang sama, bukan satu sweeper dipanggil berulang.
  const repos = Array.from({ length: 8 }, () => new PgJobsRepository(URL_UJI));
  try {
    await Promise.all(repos.map((r) => r.reconcileReadyHolds()));
  } finally {
    await Promise.all(repos.map((r) => r.close()));
  }

  const hasil = await pool.query<{ job_id: string; n: string }>(
    `SELECT job_id, COUNT(*) AS n FROM credit_ledger
     WHERE job_id = ANY($1) AND type IN ('capture','release') GROUP BY job_id`, [jobIds]
  );
  const ganda = hasil.rows.filter((r) => Number(r.n) !== 1);
  assert.deepEqual(ganda, [], `job ini punya catatan terminal ganda: ${JSON.stringify(ganda)}`);
  assert.equal(hasil.rows.length, 30, "setiap job READY yang hold-nya menggantung harus ter-capture tepat sekali");
});

test("promo READY yang hold-nya menggantung ikut dirapikan", { skip: lewati }, async () => {
  const { PgJobsRepository } = await import("../lib/postgres/jobs");
  const uid = await penggunaUji();
  const pjid = id(), t = at();
  await pool.query(
    "INSERT INTO promo_jobs (id,user_id,state,uploaded_clip_urls,created_at,output_url,completed_at) VALUES ($1,$2,'READY','[]',$3,'out.mp4',$3)",
    [pjid, uid, t]
  );
  await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-12000,'hold',$3,$4)", [id(), uid, pjid, t]);

  const repo = new PgJobsRepository(URL_UJI);
  try { await repo.reconcileReadyPromoHolds(); } finally { await repo.close(); }

  const n = await pool.query("SELECT type FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')", [pjid]);
  assert.equal(n.rowCount, 1, "promo READY harus ter-capture — reconciler lama hanya membaca tabel jobs");
  assert.equal(n.rows[0].type, "capture");
});

test("promo READY tidak bisa ditimpa jadi FAILED, jadi tidak bisa direfund", { skip: lewati }, async () => {
  const { PgPromoJobsRepository } = await import("../lib/postgres/promo-jobs");
  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  const uid = await penggunaUji();
  const pjid = id(), t = at();
  await pool.query("INSERT INTO promo_jobs (id,user_id,state,uploaded_clip_urls,created_at) VALUES ($1,$2,'STITCHING','[]',$3)", [pjid, uid, t]);
  await pool.query("INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-12000,'hold',$3,$4)", [id(), uid, pjid, t]);

  const promo = new PgPromoJobsRepository(URL_UJI);
  const kredit = new PgCreditPaymentRepository(URL_UJI);
  try {
    assert.equal(await promo.markReady(pjid, "out.mp4"), true, "job aktif harus bisa jadi READY");
    // Inilah urutan yang membuat video gratis: capture gagal -> catch memanggil
    // markFailed -> dulu READY tertimpa FAILED -> penjaga refund tidak lagi
    // melihat READY -> refund jalan.
    assert.equal(await promo.markFailed(pjid, "captureCredits gagal"), false, "READY harus final");
    const dikembalikan = await kredit.releaseCredits(uid, pjid);
    assert.equal(dikembalikan, 0, "video yang sudah diserahkan tidak boleh direfund");
  } finally {
    await promo.close(); await kredit.close();
  }
  const st = await pool.query<{ state: string }>("SELECT state FROM promo_jobs WHERE id=$1", [pjid]);
  assert.equal(st.rows[0].state, "READY", "state tidak boleh mundur dari READY");
});
