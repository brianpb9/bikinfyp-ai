import assert from "node:assert/strict";
import test from "node:test";

process.env.RACUN_NO_DOTENV = "1";
process.env.TIMEOUT_QUEUED_MIN = "30";
process.env.OPERATIONAL_ERROR_MIN_JOBS = "3";
process.env.OPERATIONAL_ERROR_RATE_PERCENT = "20";
// Alarm "tidak ada job" (20 Agu) hanya berlaku saat intake TERBUKA. Berkas ini
// menguji alarm satu per satu, jadi bawaannya ditutup dan tes yang memang
// menguji alarm itu membukanya sendiri.
process.env.JOB_INTAKE_MODE = "closed";
const { runOperationalMonitor } = await import("../lib/operational-monitor");

test("monitor mengirim satu alert stuck dan mencatat cooldown setelah pengiriman", async () => {
  const calls: { sql: string; values?: unknown[] }[] = [];
  const db = { query: async (sql: string, values?: unknown[]) => {
    calls.push({ sql, values });
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [{ id: "abcdefgh-1234", state: "QUEUED", state_changed_at: "2026-01-01T00:00:00.000Z" }] };
    if (sql.includes("GROUP BY state")) return { rows: [{ state: "READY", count: 1 }] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT id FROM audit_log")) return { rows: [] };
    return { rows: [] };
  }};
  const sent: string[] = [];
  const result = await runOperationalMonitor({ db, now: new Date("2026-01-01T00:30:00.000Z"), send: async (alert) => { sent.push(alert.fingerprint); } });
  assert.deepEqual(result, { checked: 1, sent: 1, suppressed: 0 });
  assert.deepEqual(sent, ["stuck-jobs"]);
  assert.ok(calls.some((call) => call.sql.startsWith("INSERT INTO audit_log")));
});

test("monitor tidak mengirim ulang alert yang masih dalam cooldown", async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [{ id: "abcdefgh-1234", state: "QUEUED", state_changed_at: "2026-01-01T00:00:00.000Z" }] };
    if (sql.includes("GROUP BY state")) return { rows: [] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT id FROM audit_log")) return { rows: [{ id: "already-sent" }] };
    return { rows: [] };
  }};
  const result = await runOperationalMonitor({ db, now: new Date("2026-01-01T00:30:00.000Z"), send: async () => assert.fail("email tidak boleh terkirim") });
  assert.deepEqual(result, { checked: 1, sent: 0, suppressed: 1 });
});

test("error rate menghitung REFUNDED sekali dan memenuhi ambang sampel", async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [] };
    if (sql.includes("GROUP BY state")) return { rows: [{ state: "READY", count: 3 }, { state: "REFUNDED", count: 2 }, { state: "FAILED", count: 9 }] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT id FROM audit_log")) return { rows: [] };
    return { rows: [] };
  }};
  const subjects: string[] = [];
  const result = await runOperationalMonitor({ db, now: new Date("2026-01-01T00:30:00.000Z"), send: async (alert) => { subjects.push(alert.subject); } });
  assert.deepEqual(result, { checked: 1, sent: 1, suppressed: 0 });
  assert.match(subjects[0], /40%/);
});

// ALARM PENULIS NASKAH MATI (20 Agu). Sejak template tidak lagi disajikan,
// penulis LLM yang gagal berarti pengguna berbayar tidak dapat naskah sama
// sekali — kegagalan yang sebelumnya cuma jadi 503 di layar satu orang.
test("alarm menyala saat permintaan naskah berulang kali ditolak 503", async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [] };
    if (sql.includes("GROUP BY state")) return { rows: [] };
    if (sql.includes("naskah.penulis_tidak_tersedia")) return { rows: [{ count: 5, sebab: "kunci API penulis LLM belum di-set di server" }] };
    if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
    if (sql.includes("SELECT id FROM audit_log")) return { rows: [] };
    return { rows: [] };
  }};
  const terkirim: { fingerprint: string; text: string }[] = [];
  const hasil = await runOperationalMonitor({
    db, now: new Date("2026-01-01T00:30:00.000Z"),
    send: async (alert) => { terkirim.push({ fingerprint: alert.fingerprint, text: alert.text }); },
  });
  assert.equal(hasil.sent, 1);
  assert.equal(terkirim[0]?.fingerprint, "penulis-naskah-mati");
  assert.match(terkirim[0]!.text, /kunci API penulis LLM/, "sebab teknis harus ikut di badan alarm");
});

test("satu-dua kegagalan naskah TIDAK membangunkan siapa pun", async () => {
  const db = { query: async (sql: string) => {
    if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [] };
    if (sql.includes("GROUP BY state")) return { rows: [] };
    if (sql.includes("naskah.penulis_tidak_tersedia")) return { rows: [{ count: 2, sebab: "x" }] };
    return { rows: [] };
  }};
  const hasil = await runOperationalMonitor({
    db, now: new Date("2026-01-01T00:30:00.000Z"),
    send: async () => assert.fail("alarm terlalu sensitif — kegagalan sesekali itu normal"),
  });
  assert.equal(hasil.sent, 0);
});

// KEGAGALAN SENYAP (20 Agu). Alarm lain semuanya menunggu sesuatu TERJADI;
// yang ini menyala saat tidak ada apa-apa — kegagalan paling mahal, karena ia
// terlihat persis seperti hari yang tenang.
test("alarm menyala saat intake TERBUKA tapi tidak ada job berjam-jam", async () => {
  const asli = process.env.JOB_INTAKE_MODE;
  process.env.JOB_INTAKE_MODE = "open";
  try {
    const db = { query: async (sql: string) => {
      if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [] };
      if (sql.includes("GROUP BY state")) return { rows: [] };
      if (sql.includes("naskah.penulis_tidak_tersedia")) return { rows: [{ count: 0 }] };
      if (sql.includes("max(created_at)")) return { rows: [{ t: "2026-01-01T00:00:00.000Z" }] };
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("SELECT id FROM audit_log")) return { rows: [] };
      return { rows: [] };
    }};
    const terkirim: string[] = [];
    const hasil = await runOperationalMonitor({
      db, now: new Date("2026-01-03T00:00:00.000Z"), intake: "open", // 48 jam sunyi
      send: async (a) => { terkirim.push(a.fingerprint); },
    });
    assert.equal(hasil.sent, 1);
    assert.deepEqual(terkirim, ["tidak-ada-job"]);
  } finally {
    if (asli === undefined) delete process.env.JOB_INTAKE_MODE; else process.env.JOB_INTAKE_MODE = asli;
  }
});

test("intake TERTUTUP: sunyi itu normal, jangan bangunkan siapa pun", async () => {
  const asli = process.env.JOB_INTAKE_MODE;
  process.env.JOB_INTAKE_MODE = "closed";
  try {
    const db = { query: async (sql: string) => {
      if (sql.includes("max(created_at)")) return { rows: [{ t: "2026-01-01T00:00:00.000Z" }] };
      if (sql.includes("naskah.penulis_tidak_tersedia")) return { rows: [{ count: 0 }] };
      return { rows: [] };
    }};
    const hasil = await runOperationalMonitor({
      db, now: new Date("2026-01-03T00:00:00.000Z"), intake: "closed",
      send: async () => assert.fail("intake ditutup sengaja — sunyi memang yang diharapkan"),
    });
    assert.equal(hasil.sent, 0);
  } finally {
    if (asli === undefined) delete process.env.JOB_INTAKE_MODE; else process.env.JOB_INTAKE_MODE = asli;
  }
});

// BLOCKER yang ditemukan board review 20 Agu: monitor MENOLAK berjalan saat
// lingkungan pembayaran production — jaring pengaman putus persis pada detik
// pertama uang sungguhan mengalir, dan kegagalannya cuma console.error di log
// worker. Tes ini menjaga agar penjaga itu tidak pernah kembali.
test("monitor TETAP berjalan saat pembayaran production — alarm justru paling dibutuhkan di sana", async () => {
  const asli = { prod: process.env.DUITKU_IS_PRODUCTION, gw: process.env.PAYMENT_GATEWAY };
  process.env.PAYMENT_GATEWAY = "duitku";
  process.env.DUITKU_IS_PRODUCTION = "true";
  try {
    const db = { query: async (sql: string) => {
      if (sql.includes("FROM jobs") && sql.includes("ANY")) return { rows: [{ id: "x", state: "QUEUED", state_changed_at: "2026-01-01T00:00:00.000Z" }] };
      if (sql.includes("GROUP BY state")) return { rows: [] };
      if (sql.includes("naskah.penulis_tidak_tersedia")) return { rows: [{ count: 0 }] };
      if (sql.includes("max(created_at)")) return { rows: [{ t: "2026-01-01T00:00:00.000Z" }] };
      if (sql.includes("pg_try_advisory_lock")) return { rows: [{ locked: true }] };
      if (sql.includes("SELECT id FROM audit_log")) return { rows: [] };
      return { rows: [] };
    }};
    const terkirim: string[] = [];
    const hasil = await runOperationalMonitor({
      db, now: new Date("2026-01-01T00:30:00.000Z"), intake: "closed",
      send: async (a) => { terkirim.push(a.fingerprint); },
    });
    assert.equal(hasil.sent, 1, "alarm harus tetap terkirim di lingkungan production");
    assert.deepEqual(terkirim, ["stuck-jobs"]);
  } finally {
    if (asli.prod === undefined) delete process.env.DUITKU_IS_PRODUCTION; else process.env.DUITKU_IS_PRODUCTION = asli.prod;
    if (asli.gw === undefined) delete process.env.PAYMENT_GATEWAY; else process.env.PAYMENT_GATEWAY = asli.gw;
  }
});

test("monitor menolak jalan HANYA saat alat kirimnya tidak ada", async () => {
  // Tanpa kunci Resend + alamat tujuan, monitor hanya membakar kueri tanpa
  // pernah bisa memberi tahu siapa pun — itu alasan berhenti yang sah.
  // db disuntikkan supaya lewat gerbang "monitoring dimatikan"; yang diuji di
  // sini adalah penjaga alat kirim, bukan saklar fiturnya.
  const db = { query: async () => ({ rows: [] }) };
  await assert.rejects(
    runOperationalMonitor({ db, intake: "closed" }),   // tanpa send, tanpa kunci Resend
    /RESEND_API_KEY|OPERATIONAL_ALERT_TO_EMAIL/,
  );
});
