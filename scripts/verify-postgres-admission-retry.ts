/**
 * Independent regression proof for the PostgreSQL job-admission retry loop.
 *
 * This intentionally uses a disposable local database supplied by its shell
 * wrapper.  It admits 20 distinct scripts for one funded user concurrently;
 * no queue, HTTP server, or media provider is involved.  The assertions prove
 * that a successful response maps to exactly one job and exactly one hold.
 */
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { Pool } from "pg";

const databaseUrl = process.env.DATABASE_URL;
assert.ok(databaseUrl, "DATABASE_URL database disposable wajib tersedia.");
const { smokeCreateJob } = await import("../lib/postgres/smoke-runtime");

const count = 20;
const userId = `admission-user-${crypto.randomUUID()}`;
const productId = `admission-product-${crypto.randomUUID()}`;
const personaId = `admission-persona-${crypto.randomUUID()}`;
const foreignUserId = `admission-foreign-${crypto.randomUUID()}`;
const foreignPersonaId = `admission-foreign-persona-${crypto.randomUUID()}`;
const missingPersonaScriptId = `admission-missing-persona-${crypto.randomUUID()}`;
const foreignPersonaScriptId = `admission-foreign-persona-script-${crypto.randomUUID()}`;
const reassignmentRaceScriptId = `admission-persona-race-${crypto.randomUUID()}`;
const scriptIds = Array.from({ length: count }, () => `admission-script-${crypto.randomUUID()}`);
const priceIdr = 5_000;
const now = new Date().toISOString();
const pool = new Pool({ connectionString: databaseUrl });

try {
  await pool.query(
    "INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)",
    [userId, `${userId}@local.test`, now]
  );
  await pool.query(
    "INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,'free','id-ID',$3)",
    [foreignUserId, `${foreignUserId}@local.test`, now]
  );
  await pool.query(
    "INSERT INTO products (id,user_id,name,price_idr,category,images,created_at) VALUES ($1,$2,'Produk admission',1000,'test','[]',$3)",
    [productId, userId, now]
  );
  await pool.query(
    "INSERT INTO personas (id,user_id,name,creator_category,voice_id,register,created_at) VALUES ($1,$2,'Persona admission','hijaber','mock-damayanti','bestie',$3)",
    [personaId, userId, now]
  );
  await pool.query(
    "INSERT INTO personas (id,user_id,name,creator_category,voice_id,register,created_at) VALUES ($1,$2,'Persona asing','hijaber','mock-damayanti','bestie',$3)",
    [foreignPersonaId, foreignUserId, now]
  );
  for (const scriptId of [...scriptIds, missingPersonaScriptId, foreignPersonaScriptId, reassignmentRaceScriptId]) {
    await pool.query(
      "INSERT INTO scripts (id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,created_at) VALUES ($1,$2,'hook','neutral','casual','[]','caption','[]','{}','silent_caption',$3)",
      [scriptId, productId, now]
    );
  }
  await pool.query(
    "INSERT INTO credit_ledger (id,user_id,delta,type,created_at) VALUES ($1,$2,$3,'topup',$4)",
    // Two extra holds fund the reassignment-race admission and the explicit
    // terminal re-admission assertion below.
    [`topup-${crypto.randomUUID()}`, userId, (count + 2) * priceIdr, now]
  );

  await assert.rejects(
    smokeCreateJob(userId, {
      productId, personaId: `missing-${crypto.randomUUID()}`, scriptId: missingPersonaScriptId,
      format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
    }),
    /PERSONA_NOT_FOUND/,
    "persona yang hilang wajib gagal tertutup"
  );
  await assert.rejects(
    smokeCreateJob(userId, {
      productId, personaId: foreignPersonaId, scriptId: foreignPersonaScriptId,
      format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
    }),
    /PERSONA_NOT_FOUND/,
    "persona milik user lain wajib gagal tertutup"
  );
  const rejectedWrites = await pool.query<{ jobs: string; holds: string }>(
    `SELECT
       (SELECT COUNT(*)::text FROM jobs WHERE script_id = ANY($1::text[])) AS jobs,
       (SELECT COUNT(*)::text FROM credit_ledger l JOIN jobs j ON j.id=l.job_id WHERE j.script_id = ANY($1::text[])) AS holds`,
    [[missingPersonaScriptId, foreignPersonaScriptId]]
  );
  assert.equal(Number(rejectedWrites.rows[0]?.jobs), 0, "persona invalid tidak boleh menulis job");
  assert.equal(Number(rejectedWrites.rows[0]?.holds), 0, "persona invalid tidak boleh menulis hold");

  // Hold admission immediately after its persona lock, then attempt to move
  // that persona to another user from a second connection. FOR UPDATE must
  // make the reassignment fail instead of letting a foreign-persona job/hold
  // commit. The advisory lock exists only in this disposable test database.
  const advisoryKey = 2_608_300_001;
  const blocker = await pool.connect();
  const reassigner = await pool.connect();
  try {
    await pool.query(`
      CREATE FUNCTION test_block_reassignment_race() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.script_id = '${reassignmentRaceScriptId}' THEN
          PERFORM pg_advisory_xact_lock(${advisoryKey});
        END IF;
        RETURN NEW;
      END $$;
      CREATE TRIGGER test_block_reassignment_race
        BEFORE INSERT ON jobs FOR EACH ROW EXECUTE FUNCTION test_block_reassignment_race();
    `);
    await blocker.query("SELECT pg_advisory_lock($1)", [advisoryKey]);
    const racedAdmission = smokeCreateJob(userId, {
      productId, personaId, scriptId: reassignmentRaceScriptId,
      format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
    });
    let admissionBlockedAfterPersonaLock = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      const waiting = await pool.query<{ blocked: boolean }>(
        `SELECT EXISTS (
           SELECT 1 FROM pg_stat_activity
           WHERE datname=current_database()
             AND query LIKE 'INSERT INTO jobs%'
             AND wait_event_type='Lock' AND lower(wait_event)='advisory'
         ) AS blocked`
      );
      if (waiting.rows[0]?.blocked) { admissionBlockedAfterPersonaLock = true; break; }
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
    assert.equal(admissionBlockedAfterPersonaLock, true, "admission harus tertahan sesudah mengunci persona");
    await reassigner.query("BEGIN");
    await reassigner.query("SET LOCAL lock_timeout = '250ms'");
    await assert.rejects(
      reassigner.query("UPDATE personas SET user_id=$1 WHERE id=$2", [foreignUserId, personaId]),
      (error: unknown) => (error as { code?: string }).code === "55P03",
      "reassignment harus diblokir oleh lock admission"
    );
    await reassigner.query("ROLLBACK");
    await blocker.query("SELECT pg_advisory_unlock($1)", [advisoryKey]);
    const raced = await racedAdmission;
    const foreignRaceWrites = await pool.query<{ foreign_jobs: string; holds: string }>(
      `SELECT
         COUNT(*) FILTER (WHERE p.user_id <> j.user_id)::text AS foreign_jobs,
         COUNT(l.id)::text AS holds
       FROM jobs j
       JOIN personas p ON p.id=j.persona_id
       LEFT JOIN credit_ledger l ON l.job_id=j.id AND l.type='hold'
       WHERE j.id=$1
       GROUP BY j.id`,
      [raced.jobId]
    );
    assert.equal(Number(foreignRaceWrites.rows[0]?.foreign_jobs), 0, "race tidak boleh menghasilkan foreign-persona job");
    assert.equal(Number(foreignRaceWrites.rows[0]?.holds), 1, "admission sah tetap punya tepat satu hold");
  } finally {
    await blocker.query("SELECT pg_advisory_unlock($1)", [advisoryKey]).catch(() => undefined);
    await reassigner.query("ROLLBACK").catch(() => undefined);
    blocker.release();
    reassigner.release();
    await pool.query("DROP TRIGGER IF EXISTS test_block_reassignment_race ON jobs");
    await pool.query("DROP FUNCTION IF EXISTS test_block_reassignment_race()");
  }

  const settled = await Promise.allSettled(scriptIds.map((scriptId) => smokeCreateJob(userId, {
    productId, personaId, scriptId, format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr,
  })));
  const rejected = settled.filter((entry): entry is PromiseRejectedResult => entry.status === "rejected");
  assert.equal(rejected.length, 0, `admission paralel menolak ${rejected.length}: ${rejected.map((entry) => String(entry.reason)).join(" | ")}`);
  const accepted = settled.map((entry) => (entry as PromiseFulfilledResult<{ jobId: string; duplicate: boolean }>).value);
  assert.equal(new Set(accepted.map((entry) => entry.jobId)).size, count, "setiap script harus mendapat job unik");
  assert.equal(accepted.filter((entry) => entry.duplicate).length, 0, "20 script berbeda tidak boleh dianggap duplikat");

  const jobs = await pool.query<{ script_id: string; n: string }>(
    "SELECT script_id,COUNT(*)::text n FROM jobs WHERE user_id=$1 AND script_id=ANY($2::text[]) GROUP BY script_id ORDER BY script_id", [userId, scriptIds]
  );
  assert.equal(jobs.rowCount, count, "harus ada tepat 20 job");
  assert.ok(jobs.rows.every((row) => Number(row.n) === 1), "setiap script harus memiliki tepat satu job");
  const personas = await pool.query<{ persona_id: string | null }>(
    "SELECT persona_id FROM jobs WHERE user_id=$1 AND script_id=ANY($2::text[])", [userId, scriptIds]
  );
  assert.ok(personas.rows.every((row) => row.persona_id === personaId), "persona tervalidasi wajib tersimpan pada setiap job");
  const holds = await pool.query<{ job_id: string; n: string; delta: string }>(
    `SELECT l.job_id,COUNT(*)::text n,SUM(l.delta)::text delta
     FROM credit_ledger l JOIN jobs j ON j.id=l.job_id
     WHERE l.user_id=$1 AND l.type='hold' AND j.script_id=ANY($2::text[])
     GROUP BY l.job_id ORDER BY l.job_id`, [userId, scriptIds]
  );
  assert.equal(holds.rowCount, count, "harus ada tepat 20 hold");
  assert.ok(holds.rows.every((row) => Number(row.n) === 1 && Number(row.delta) === -priceIdr), "setiap job harus memiliki satu hold sebesar harga");
  const first = accepted[0];
  const duplicate = await smokeCreateJob(userId, { productId, personaId, scriptId: scriptIds[0], format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr });
  assert.equal(duplicate.duplicate, true, "job aktif untuk script yang sama harus idempoten");
  assert.equal(duplicate.jobId, first.jobId, "duplikat aktif harus menunjuk job awal");
  const activeDuplicateHolds = await pool.query("SELECT id FROM credit_ledger WHERE job_id=$1 AND type='hold'", [first.jobId]);
  assert.equal(activeDuplicateHolds.rowCount, 1, "duplikat aktif tidak boleh membuat hold kedua");

  // This matches the historic rule: a terminal job does not block a deliberate
  // re-admission of the same approved script, and the script pointer advances.
  await pool.query("UPDATE jobs SET state='FAILED' WHERE id=$1", [first.jobId]);
  const reAdmitted = await smokeCreateJob(userId, { productId, personaId, scriptId: scriptIds[0], format: "hands_only", qualityTier: "silent_caption", durationS: 15, priceIdr });
  assert.equal(reAdmitted.duplicate, false, "job terminal harus mengizinkan re-admission");
  assert.notEqual(reAdmitted.jobId, first.jobId, "re-admission harus membuat job baru");
  const pointer = await pool.query<{ job_id: string }>("SELECT job_id FROM scripts WHERE id=$1", [scriptIds[0]]);
  assert.equal(pointer.rows[0]?.job_id, reAdmitted.jobId, "pointer script harus berpindah ke job re-admission");
  const finalHolds = await pool.query("SELECT id FROM credit_ledger WHERE job_id=$1 AND type='hold'", [reAdmitted.jobId]);
  assert.equal(finalHolds.rowCount, 1, "re-admission terminal harus membuat satu hold baru");
  const balance = await pool.query<{ balance: string }>("SELECT balance::text FROM v_credit_balance WHERE user_id=$1", [userId]);
  assert.equal(Number(balance.rows[0]?.balance), 0, "saldo harus habis persis tanpa hold ganda/terlewat");

  process.stdout.write(JSON.stringify({ admissions: count, jobs: jobs.rowCount, holds: holds.rowCount, persona_persisted: true, missing_persona_fail_closed: true, foreign_persona_fail_closed: true, reassignment_race_blocked: true, active_duplicate: true, terminal_readmission: true, balance: Number(balance.rows[0]?.balance) }) + "\n");
} finally {
  await pool.end();
}
