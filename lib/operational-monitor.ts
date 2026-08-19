/**
 * Lightweight, database-backed operational monitoring.
 *
 * It is deliberately run by the existing Redis worker: no new monitoring
 * vendor, webhook endpoint, or public surface is introduced.  Alerts are
 * recorded in audit_log only after Resend accepts the message, which gives a
 * durable cooldown across worker restarts.
 */
import crypto from "node:crypto";
import { Pool } from "pg";
import { config, paymentsEnv } from "./config";
import { getPool } from "./postgres/pool";

type Queryable = { query: (sql: string, values?: unknown[]) => Promise<{ rows: Record<string, unknown>[] }> };
type Alert = { fingerprint: string; subject: string; text: string; meta: Record<string, unknown> };

const activeStates = ["QUEUED", "GENERATING_VISUAL", "GENERATING_VOICE", "COMPOSITING", "QC_CHECK", "LABELING"];

function positive(value: number, fallback: number) { return Number.isFinite(value) && value > 0 ? value : fallback; }

export function monitoringSettings() {
  return {
    intervalMs: positive(config.operationalMonitoringIntervalMin, 5) * 60_000,
    cooldownMin: positive(config.operationalAlertCooldownMin, 60),
    errorWindowMin: positive(config.operationalErrorWindowMin, 60),
    errorMinJobs: positive(config.operationalErrorMinJobs, 3),
    errorRatePercent: positive(config.operationalErrorRatePercent, 20),
  };
}

function stuckThresholds() {
  // Alert five minutes before the established timeout/refund sweep.  This
  // preserves the worker's recovery behavior while making a stuck state visible
  // early enough to investigate.
  return Object.fromEntries(Object.entries(config.stateTimeoutsMin)
    .filter(([state]) => activeStates.includes(state))
    .map(([state, timeout]) => [state, Math.max(1, timeout - 5)]));
}

export async function collectOperationalAlerts(db: Queryable, now = new Date()): Promise<Alert[]> {
  const settings = monitoringSettings();
  const thresholds = stuckThresholds();
  const states = Object.keys(thresholds);
  const stale = await db.query(
    `SELECT id, state, state_changed_at, created_at
       FROM jobs
      WHERE state = ANY($1::text[])
        AND (state_changed_at IS NOT NULL OR created_at IS NOT NULL)`,
    [states]
  );
  const stuck = stale.rows.filter((row) => {
    const changedAt = String(row.state_changed_at ?? row.created_at);
    const ageMin = (now.getTime() - new Date(changedAt).getTime()) / 60_000;
    return Number.isFinite(ageMin) && ageMin >= (thresholds[String(row.state)] ?? Infinity);
  }).map((row) => ({ state: String(row.state), changed_at: row.state_changed_at ?? row.created_at }));

  const windowStart = new Date(now.getTime() - settings.errorWindowMin * 60_000).toISOString();
  const terminal = await db.query(
    `SELECT state, count(*)::int AS count
       FROM jobs
      WHERE state IN ('READY', 'FAILED', 'REFUNDED')
        AND COALESCE(completed_at, state_changed_at, created_at) >= $1
      GROUP BY state`, [windowStart]
  );
  const counts = Object.fromEntries(terminal.rows.map((row) => [String(row.state), Number(row.count)]));
  // Only settled terminal outcomes participate. FAILED is transient on the
  // established failure path, then becomes REFUNDED in the same workflow.
  const total = (counts.READY ?? 0) + (counts.REFUNDED ?? 0);
  // FAILED is intentionally omitted: it is only the short internal transition
  // before REFUNDED. Counting it would double-count one failed job.
  const failed = counts.REFUNDED ?? 0;
  const errorRate = total === 0 ? 0 : Math.round((failed / total) * 100);
  const alerts: Alert[] = [];
  const stuckStateCounts = stuck.reduce<Record<string, number>>((counts, job) => {
    counts[job.state] = (counts[job.state] ?? 0) + 1;
    return counts;
  }, {});
  if (stuck.length) alerts.push({
    fingerprint: "stuck-jobs",
    subject: `[BikinFYP] ALERT: ${stuck.length} job melewati ambang state`,
    text: `Ada ${stuck.length} job aktif melewati ambang per-state. Rincian state: ${JSON.stringify(stuckStateCounts)}. Worker tetap menjalankan timeout/refund normal.`,
    meta: { kind: "stuck_jobs", count: stuck.length, state_counts: stuckStateCounts, thresholds_min: thresholds },
  });
  if (total >= settings.errorMinJobs && errorRate >= settings.errorRatePercent) alerts.push({
    fingerprint: "error-rate",
    subject: `[BikinFYP] ALERT: error rate job ${errorRate}%`,
    text: `Dalam ${settings.errorWindowMin} menit terakhir, ${failed}/${total} job terminal berakhir REFUNDED (${errorRate}%). Periksa worker dan provider sebelum membuka intake.`,
    meta: { kind: "error_rate", window_min: settings.errorWindowMin, total, failed, error_rate_percent: errorRate },
  });
  // PENULIS NASKAH MATI (alarm baru 20 Agu). Sejak template tidak lagi
  // disajikan (keputusan Brian), penulis LLM yang gagal berarti pengguna
  // BERBAYAR tidak dapat naskah sama sekali — 503 di layarnya, senyap di
  // sisi kami. Ambangnya rendah dan sengaja: satu jam tanpa naskah adalah
  // jam ketika tidak ada yang bisa membeli video.
  const penulisMati = await db.query(
    `SELECT count(*)::int AS count, max(meta::jsonb->>'sebab') AS sebab
       FROM audit_log
      WHERE action = 'naskah.penulis_tidak_tersedia' AND created_at >= $1`,
    [windowStart]
  );
  const gagalNaskah = Number(penulisMati.rows[0]?.count ?? 0);
  if (gagalNaskah >= 3) alerts.push({
    fingerprint: "penulis-naskah-mati",
    subject: `[BikinFYP] ALERT: ${gagalNaskah} permintaan naskah ditolak (penulis LLM tidak tersedia)`,
    text:
      `Dalam ${settings.errorWindowMin} menit terakhir, ${gagalNaskah} permintaan naskah dijawab 503 karena penulis LLM gagal ` +
      `dan naskah template SENGAJA tidak disajikan. Sebab terakhir: ${penulisMati.rows[0]?.sebab ?? "tidak tercatat"}. ` +
      `Periksa saldo/kunci Anthropic — selama ini berlangsung, pengguna berbayar tidak bisa membuat video.`,
    meta: { kind: "penulis_naskah_mati", window_min: settings.errorWindowMin, count: gagalNaskah, sebab: penulisMati.rows[0]?.sebab ?? null },
  });

  return alerts;
}

export async function runOperationalMonitor(options: {
  databaseUrl?: string; now?: Date; db?: Queryable;
  send?: (alert: Alert) => Promise<void>;
} = {}): Promise<{ checked: number; sent: number; suppressed: number }> {
  if (!config.operationalMonitoringEnabled && !options.db) return { checked: 0, sent: 0, suppressed: 0 };
  // Penjaga lama menyebut MIDTRANS_IS_PRODUCTION; sejak pindah ke Duitku yang
  // relevan adalah LINGKUNGAN pembayaran yang benar-benar aktif (20 Agu).
  if (paymentsEnv() === "production") throw new Error("Monitoring operasional menolak berjalan saat lingkungan pembayaran production.");
  if (!options.db && !/^postgres(?:ql)?:\/\//i.test(options.databaseUrl ?? config.databaseUrl)) throw new Error("Monitoring operasional memerlukan DATABASE_URL PostgreSQL.");
  if (!options.send && (!config.resendApiKey || !config.operationalAlertToEmail)) throw new Error("Monitoring aktif memerlukan RESEND_API_KEY dan OPERATIONAL_ALERT_TO_EMAIL.");
  const pool = options.db ? undefined : getPool(options.databaseUrl ?? config.databaseUrl);
  const db = options.db ?? pool!;
  const now = options.now ?? new Date();
  const settings = monitoringSettings();
  let sent = 0, suppressed = 0;
  try {
    const alerts = await collectOperationalAlerts(db, now);
    for (const alert of alerts) {
      const since = new Date(now.getTime() - settings.cooldownMin * 60_000).toISOString();
      // One PostgreSQL session owns the advisory lock while it sends and
      // records an alert. This prevents a rolling worker or a slow interval
      // from double-mailing the same incident.
      const claim = await db.query("SELECT pg_try_advisory_lock(hashtext($1)) AS locked", ["operational-monitor:" + alert.fingerprint]);
      if (claim.rows[0]?.locked !== true) { suppressed++; continue; }
      try {
      const recent = await db.query("SELECT id FROM audit_log WHERE action='monitoring.alert' AND entity='operational_monitor' AND entity_id=$1 AND created_at >= $2 LIMIT 1", [alert.fingerprint, since]);
      if (recent.rows.length) { suppressed++; continue; }
      if (options.send) await options.send(alert);
      else await sendResendAlert(alert);
      await db.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,'operational-monitor','monitoring.alert','operational_monitor',$2,$3,$4)", [crypto.randomUUID(), alert.fingerprint, JSON.stringify(alert.meta), now.toISOString()]);
      sent++;
      } finally {
        await db.query("SELECT pg_advisory_unlock(hashtext($1))", ["operational-monitor:" + alert.fingerprint]);
      }
    }
    return { checked: alerts.length, sent, suppressed };
  } finally { await pool?.end(); }
}

async function sendResendAlert(alert: Alert) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  let response: Response;
  try {
    response = await fetch("https://api.resend.com/emails", {
      method: "POST", headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.resendFromEmail, to: [config.operationalAlertToEmail], subject: alert.subject, text: alert.text }), signal: controller.signal,
    });
  } finally { clearTimeout(timeout); }
  if (!response.ok) throw new Error(`Resend monitoring alert gagal: HTTP ${response.status}`);
}
