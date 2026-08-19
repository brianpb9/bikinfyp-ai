#!/usr/bin/env node
/**
 * LAPORAN KESEHATAN — satu perintah, seluruh mesin.
 *
 * Ada karena observabilitas kita tersebar: job di satu kueri, naskah di kueri
 * lain, gate di berkas JSONL, pembayaran di health, ledger di skrip audit.
 * Siapa pun yang ingin tahu "sistemnya sehat atau tidak" harus menjalankan
 * lima hal dan menyatukannya sendiri — dan yang butuh lima langkah tidak
 * pernah dilakukan saat paling dibutuhkan.
 *
 * HANYA MEMBACA. Aman dijalankan kapan saja, termasuk di produksi.
 *
 * Pakai:
 *   DATABASE_URL='postgres://...' node scripts/laporan-kesehatan.mjs
 *   DATABASE_URL='...' node scripts/laporan-kesehatan.mjs 7   # jendela 7 hari
 */
import fs from "node:fs";
import path from "node:path";
import pg from "pg";

const hari = Math.max(1, Number(process.argv[2] ?? 7));
const url = process.env.DATABASE_URL;
const BASE = process.env.BASE_URL ?? "https://bikinfyp.com";
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error("DATABASE_URL PostgreSQL wajib diisi (read-only).");
  process.exit(2);
}

const sejak = new Date(Date.now() - hari * 86_400_000).toISOString();
const pool = new pg.Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });
const temuan = [];   // hal yang perlu perhatian manusia
const baris = (label, isi) => console.log(`  ${label.padEnd(34)} ${isi}`);

try {
  console.log(`\nKESEHATAN BIKINFYP — ${hari} hari terakhir (sejak ${sejak.slice(0, 10)})\n`);

  // ---- 1. Pembayaran (dari health, bukan dari tebakan env lokal) ----
  console.log("PEMBAYARAN");
  try {
    const r = await fetch(`${BASE}/api/health`);
    const d = await r.json();
    baris("provider / lingkungan", `${d.payments_provider} / ${d.payments_env}`);
    baris("payments_live", String(d.payments_live));
    baris("intake", d.intake);
    baris("build", String(d.build_sha ?? "-").slice(0, 7));
    if (d.payments_env === "sandbox" && d.payments_live === true) {
      temuan.push("KRITIS: sandbox mengaku live — uang mainan diiklankan sebagai checkout sungguhan");
    }
  } catch (e) {
    baris("health", `TIDAK TERJANGKAU (${String(e.message).slice(0, 40)})`);
    temuan.push("health produksi tidak terjangkau");
  }

  // ---- 2. Job ----
  console.log("\nJOB");
  const job = await pool.query(
    `SELECT state, count(*)::int n FROM jobs WHERE created_at >= $1 GROUP BY state ORDER BY 2 DESC`, [sejak]
  );
  const total = job.rows.reduce((a, r) => a + r.n, 0);
  baris("total dibuat", String(total));
  for (const r of job.rows) baris(`  ${r.state}`, String(r.n));
  const siap = job.rows.find((r) => r.state === "READY")?.n ?? 0;
  const refund = job.rows.find((r) => r.state === "REFUNDED")?.n ?? 0;
  if (siap + refund > 0) {
    const persen = Math.round((siap / (siap + refund)) * 100);
    baris("tingkat berhasil", `${persen}% (${siap}/${siap + refund} terminal)`);
    if (persen < 70 && siap + refund >= 5) temuan.push(`tingkat keberhasilan job ${persen}% — di bawah 70%`);
  }
  const terakhir = await pool.query("SELECT max(created_at) t FROM jobs");
  const umurJam = terakhir.rows[0]?.t ? (Date.now() - new Date(terakhir.rows[0].t).getTime()) / 3_600_000 : null;
  baris("job terakhir", umurJam === null ? "belum pernah" : `${Math.round(umurJam)} jam lalu`);

  // ---- 3. Naskah & gerbang mutu ----
  console.log("\nNASKAH");
  const skrip = await pool.query(
    `SELECT count(*)::int n,
            count(*) FILTER (WHERE validation_result::jsonb->'admisi' ? 'mechanic')::int dgn_ide
     FROM scripts WHERE created_at >= $1`, [sejak]
  );
  baris("naskah dibuat", String(skrip.rows[0].n));
  baris("  dengan ide lolos gate", `${skrip.rows[0].dgn_ide}`);
  const tolak = await pool.query(
    `SELECT count(*)::int n, max(meta::jsonb->>'sebab') sebab FROM audit_log
      WHERE action='naskah.penulis_tidak_tersedia' AND created_at >= $1`, [sejak]
  );
  baris("permintaan ditolak (503)", String(tolak.rows[0].n));
  if (tolak.rows[0].n > 0) {
    baris("  sebab terakhir", String(tolak.rows[0].sebab ?? "-").slice(0, 60));
    temuan.push(`${tolak.rows[0].n} permintaan naskah dijawab 503 — penulis LLM gagal, template sengaja tidak disajikan`);
  }

  // FYP Gate dari JSONL (catatan riset, bukan tabel — lihat ide.ts).
  try {
    const file = path.resolve(process.env.STORAGE_DIR ?? "./storage", "fyp-gate-log.jsonl");
    const isi = fs.readFileSync(file, "utf8").split("\n").filter(Boolean).map((b) => JSON.parse(b));
    const dalam = isi.filter((d) => !d.waktu || d.waktu >= sejak);
    if (dalam.length) {
      const lulus = dalam.filter((d) => d.lulus === true).length;
      baris("FYP Gate", `${lulus}/${dalam.length} lulus (${Math.round((lulus / dalam.length) * 100)}%)`);
      if (lulus === 0 && dalam.length >= 3) temuan.push("FYP Gate 0% lulus — ide tidak pernah dipakai, biaya Idea Stage terbuang");
    }
  } catch { baris("FYP Gate", "(log tidak ada di mesin ini)"); }

  // ---- 4. Arsip prompt: yang benar-benar dikirim ke penyedia ----
  console.log("\nARSIP PROMPT (job_prompts)");
  const arsip = await pool.query(
    `SELECT count(*)::int n,
            count(*) FILTER (WHERE ide_skor IS NOT NULL)::int dgn_skor
     FROM job_prompts WHERE created_at >= $1`, [sejak]
  );
  baris("prompt terarsip", String(arsip.rows[0].n));
  baris("  membawa skor ide", String(arsip.rows[0].dgn_skor));
  if (total > 0 && arsip.rows[0].n === 0) {
    temuan.push("ada job tapi NOL prompt terarsip — jalur arsip putus, prompt yang dikirim tidak bisa dibedah");
  }

  // ---- 5. Uang ----
  console.log("\nUANG");
  const led = await pool.query(
    `SELECT type, count(*)::int n, COALESCE(SUM(delta),0)::bigint jumlah
       FROM credit_ledger WHERE created_at >= $1 GROUP BY type ORDER BY 2 DESC`, [sejak]
  );
  if (!led.rows.length) baris("ledger", "(tidak ada pergerakan)");
  for (const r of led.rows) baris(`  ${r.type}`, `${r.n}x, total ${Number(r.jumlah).toLocaleString("id-ID")}`);
  const sandbox = await pool.query(
    `SELECT count(*)::int n FROM audit_log WHERE action='webhook.sandbox_ditolak' AND created_at >= $1`, [sejak]
  );
  if (sandbox.rows[0].n > 0) baris("callback sandbox ditolak", `${sandbox.rows[0].n}x (benar: dompet nyata dilindungi)`);

  // ---- Kesimpulan ----
  console.log("\n" + "─".repeat(60));
  if (!temuan.length) {
    console.log("Tidak ada temuan yang perlu perhatian pada jendela ini.");
  } else {
    console.log("PERLU PERHATIAN:");
    for (const t of temuan) console.log(`  - ${t}`);
  }
  console.log("");
  process.exit(temuan.some((t) => t.startsWith("KRITIS")) ? 1 : 0);
} finally {
  await pool.end();
}
