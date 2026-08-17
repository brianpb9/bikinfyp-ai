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

// Sebagian helper (mis. pgInsertEvent) membaca konfigurasi runtime, bukan URL
// yang dioper. Dipasang di sini supaya seluruh berkas ini berbicara ke
// database uji yang sama — bukan ke database produksi mana pun.
if (!lewati) {
  process.env.DATABASE_URL = URL_UJI;
  process.env.RACUN_DB_RUNTIME = "postgres";
}

let pool: Pool;
const at = () => new Date().toISOString();
const id = () => crypto.randomUUID();

before(async () => { if (!lewati) pool = new Pool({ connectionString: URL_UJI, max: 20 }); });
after(async () => {
  if (lewati) return;
  if (pool) await pool.end();
  // Pool BERSAMA lib/postgres/pool.ts sengaja tidak pernah ditutup di jalur
  // produksi (satu pool untuk seumur proses). Di sini itu berarti proses tes
  // menggantung dengan koneksi terbuka dan CI ikut timeout — hijau yang tidak
  // pernah tiba. Ditutup eksplisit hanya di akhir uji.
  const { closePool } = await import("../lib/postgres/pool");
  await closePool?.();
});

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

// Event funnel: DULU dibuang seluruhnya di runtime PostgreSQL karena syaratnya
// berbunyi "if (!postgresRuntimeEnabled())". Produksi berjalan di PostgreSQL,
// jadi funnel dan konversi kosong tanpa satu pun tanda ada yang hilang.
test("event funnel benar-benar mendarat di PostgreSQL", { skip: lewati }, async () => {
  const { pgInsertEvent } = await import("../lib/postgres/smoke-runtime");
  const anon = `uji-${id().slice(0, 8)}`;
  await pgInsertEvent({ userId: null, anonId: anon, name: "landing_view", meta: '{"dari":"uji"}' });
  const r = await pool.query("SELECT name, meta FROM events WHERE anon_id=$1", [anon]);
  assert.equal(r.rowCount, 1, "event harus tersimpan, bukan dibuang diam-diam");
  assert.equal(r.rows[0].name, "landing_view");
});

// ---- Biaya regenerate tidak boleh merebut slot terminal job induknya ----
//
// Regenerate dulu menulis type='capture' delta=-harga dengan job_id INDUK.
// Rantai kerusakannya panjang dan semuanya soal uang: capture final menyerah
// karena "terminal sudah ada", refund menolak mengembalikan uang saat render
// gagal, hold dasar tertahan selamanya, dan sesudah indeks unik terpasang
// regenerate KEDUA gagal 23505 padahal UI menjanjikan tiga kali.

async function biayaRegen(jobId: string, userId: string, harga: number) {
  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,$3,'regen',$4,$5)",
    [id(), userId, -harga, jobId, at()]
  );
}

test("regenerate berkali-kali tidak menabrak indeks terminal", { skip: lewati }, async () => {
  const uid = await penggunaUji();
  const jid = await jobReadyBerhold(uid);
  // Tiga kali, sebanyak yang dijanjikan UI.
  await biayaRegen(jid, uid, 3000);
  await biayaRegen(jid, uid, 3000);
  await biayaRegen(jid, uid, 3000);
  const n = await pool.query("SELECT COUNT(*)::int AS n FROM credit_ledger WHERE job_id=$1 AND type='regen'", [jid]);
  assert.equal(n.rows[0].n, 3, "tiga regenerate harus bisa tercatat semua");
});

test("capture final tetap bisa terjadi setelah regenerate", { skip: lewati }, async () => {
  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  const uid = await penggunaUji();
  const jid = await jobReadyBerhold(uid);
  await biayaRegen(jid, uid, 3000);

  const repo = new PgCreditPaymentRepository(URL_UJI);
  try {
    assert.equal(await repo.captureCredits(uid, jid), true,
      "biaya regenerate tidak boleh membuat capture final menyerah");
  } finally { await repo.close(); }

  const t = await pool.query("SELECT type FROM credit_ledger WHERE job_id=$1 AND type IN ('capture','release')", [jid]);
  assert.equal(t.rowCount, 1);
  assert.equal(t.rows[0].type, "capture");
});

test("job GAGAL setelah regenerate tetap direfund penuh", { skip: lewati }, async () => {
  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  const uid = await penggunaUji();
  const jid = await jobReadyBerhold(uid);
  // Job belum diserahkan — kembalikan ke keadaan aktif.
  await pool.query("UPDATE jobs SET state='GENERATING_VISUAL' WHERE id=$1", [jid]);
  await biayaRegen(jid, uid, 3000);

  const repo = new PgCreditPaymentRepository(URL_UJI);
  let dikembalikan = 0;
  try { dikembalikan = await repo.releaseCredits(uid, jid); } finally { await repo.close(); }

  // Hold dasarnya 12.000 dan HARUS kembali utuh. Biaya regenerate memang
  // hangus — scene-nya benar-benar dibuat — tapi ia tidak boleh ikut
  // memblokir pengembalian hold rendernya.
  assert.equal(dikembalikan, 12000, "biaya regenerate tidak boleh memblokir refund hold render");
});

test("capture berdelta bukan nol ditolak database", { skip: lewati }, async () => {
  const uid = await penggunaUji();
  const jid = await jobReadyBerhold(uid);
  await assert.rejects(
    () => pool.query(
      "INSERT INTO credit_ledger (id,user_id,delta,type,job_id,created_at) VALUES ($1,$2,-3000,'capture',$3,$4)",
      [id(), uid, jid, at()]
    ),
    (err: { code?: string }) => err.code === "23514",
    "capture yang menggerakkan saldo tidak boleh lahir lagi"
  );
});

test("grantBonus idempoten walau dijalankan berbarengan", { skip: lewati }, async () => {
  // Kompensasi hampir selalu dijalankan dari skrip operasional, dan skrip
  // operasional hampir selalu dijalankan dua kali. Yang diuji di sini bukan
  // "dua panggilan berurutan" — itu mudah — tapi delapan panggilan BERBARENGAN,
  // karena cacat uang cuma muncul saat dua proses membaca keadaan yang sama
  // sebelum salah satunya menulis.
  const uid = await penggunaUji();
  const oid = id();
  await pool.query("INSERT INTO organizations (id,name,slug,created_at) VALUES ($1,$2,$3,$4)", [oid, `Org uji ${oid}`, `uji-${oid}`, at()]);

  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  const repo = new PgCreditPaymentRepository(URL_UJI);
  const rujukan = `uji-kompensasi-${oid}`;
  try {
    const hasil = await Promise.all(
      Array.from({ length: 8 }, () =>
        repo.grantBonus({ userId: uid, orgId: oid }, 36000, { alasan: "uji", rujukan })
      )
    );
    const diberikan = hasil.filter((h) => h.granted);
    assert.equal(diberikan.length, 1, `hanya satu yang boleh memberi, dapat ${diberikan.length}`);

    const saldo = await pool.query<{ s: string }>(
      "SELECT COALESCE(SUM(delta),0)::text AS s FROM credit_ledger WHERE org_id=$1", [oid]
    );
    assert.equal(Number(saldo.rows[0].s), 36000, "saldo harus naik SEKALI, bukan delapan kali");

    const baris = await pool.query("SELECT id FROM credit_ledger WHERE org_id=$1 AND type='bonus'", [oid]);
    assert.equal(baris.rowCount, 1);
  } finally { await repo.close(); }
});

test("grantBonus menolak jumlah yang tidak masuk akal", { skip: lewati }, async () => {
  const { PgCreditPaymentRepository } = await import("../lib/postgres/credit-payment");
  const repo = new PgCreditPaymentRepository(URL_UJI);
  try {
    for (const jumlah of [0, -1000, 1.5, NaN]) {
      await assert.rejects(
        () => repo.grantBonus(id(), jumlah, { alasan: "uji", rujukan: `x-${jumlah}` }),
        /bilangan bulat positif/,
        `jumlah ${jumlah} harus ditolak`
      );
    }
  } finally { await repo.close(); }
});
