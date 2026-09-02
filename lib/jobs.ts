// State machine job (SRS §4.2):
// DRAFT -> QUEUED -> GENERATING_VISUAL -> GENERATING_VOICE -> COMPOSITING
//   -> QC_CHECK -> LABELING -> READY; FAILED -> REFUNDED.
// Retry QC -> COMPOSITING maks 1x. Semua transisi dicatat (timestamp + biaya).
//
// Batas waktu PER-STATE (konfigurasi config.stateTimeoutsMin): QUEUED tetap 30 mnt
// (antrian kita sendiri), tapi state render diberi allowance panjang karena render
// nyata bisa 4–45 menit saat antrean provider padat.

import { getDb, now, uuid, audit, type JobRow } from "./db";
import { releaseCredits } from "./credits";
import { kembalikanKredit } from "./kredit-video-sqlite";
import { config } from "./config";

export const JOB_STATES = [
  "DRAFT", "QUEUED", "GENERATING_VISUAL", "AWAITING_APPROVAL", "GENERATING_VOICE", "COMPOSITING",
  "QC_CHECK", "LABELING", "READY", "FAILED", "REFUNDED",
] as const;
export type JobState = (typeof JOB_STATES)[number];

const TERMINAL: JobState[] = ["READY", "FAILED", "REFUNDED"];

export function getJob(jobId: string): JobRow | undefined {
  return getDb().prepare("SELECT * FROM jobs WHERE id = ?").get(jobId) as JobRow | undefined;
}

export function transition(jobId: string, to: JobState, meta?: Record<string, unknown>): boolean {
  const db = getDb();
  const timestamp = now();
  // Terminal state bersifat final. Satu-satunya transisi khusus adalah FAILED
  // ke REFUNDED milik failJob; semua transisi lain ditolak setelah terminal.
  const result = to === "REFUNDED"
    ? db.prepare("UPDATE jobs SET state = ?, state_changed_at = ? WHERE id = ? AND state = 'FAILED'").run(to, timestamp, jobId)
    : db.prepare("UPDATE jobs SET state = ?, state_changed_at = ? WHERE id = ? AND state NOT IN ('READY','FAILED','REFUNDED')").run(to, timestamp, jobId);
  if (!result.changes) return false;
  audit("worker", "job.transition", "jobs", jobId, { to, at: timestamp, ...meta });
  console.log(`[job ${jobId.slice(0, 8)}] -> ${to}${meta ? " " + JSON.stringify(meta) : ""}`);
  return true;
}

export function addCost(jobId: string, idr: number): void {
  getDb().prepare("UPDATE jobs SET cost_actual_idr = cost_actual_idr + ? WHERE id = ?").run(idr, jobId);
}

export function setJobProviders(jobId: string, video?: string, voice?: string): void {
  const db = getDb();
  if (video) db.prepare("UPDATE jobs SET provider_video = ? WHERE id = ?").run(video, jobId);
  if (voice) db.prepare("UPDATE jobs SET provider_voice = ? WHERE id = ?").run(voice, jobId);
}

/** FAILED -> release kredit -> REFUNDED (langsung, jauh di bawah batas 60 detik). */
export function failJob(job: JobRow, reason: string): void {
  const db = getDb();
  // Worker dan timeout sweep dapat berpapasan. Hanya pemanggil pertama yang
  // boleh mengubah job aktif; hasil READY tidak pernah boleh direfund.
  const timestamp = now();
  const changed = db
    .prepare("UPDATE jobs SET state = 'FAILED', completed_at = ?, state_changed_at = ? WHERE id = ? AND state NOT IN ('READY','FAILED','REFUNDED')")
    .run(timestamp, timestamp, job.id).changes;
  if (!changed) return;
  audit("worker", "job.transition", "jobs", job.id, { to: "FAILED", at: timestamp, reason });
  const refunded = releaseCredits(job.org_id ? { userId: job.user_id, orgId: job.org_id } : job.user_id, job.id);
  // Jatah video dikembalikan juga. Dipanggil SESUDAH job menjadi FAILED: fungsi
  // itu menolak mengembalikan jatah job yang sudah READY, dan urutan ini yang
  // membuat pemeriksaannya melihat keadaan yang benar.
  kembalikanKredit(job.user_id, job.id);
  transition(job.id, "REFUNDED", { refunded_credits: refunded });
}

/**
 * Sapu job yang terlalu lama di satu state — batas per-state dari konfigurasi.
 * state_changed_at dipakai sebagai acuan (fallback created_at untuk baris lama).
 */
export function sweepStaleJobs(): number {
  const db = getDb();
  const active = db
    .prepare(`SELECT * FROM jobs WHERE state NOT IN ('READY','FAILED','REFUNDED')`)
    .all() as (JobRow & { state_changed_at: string | null })[];
  let swept = 0;
  for (const job of active) {
    // AWAITING_APPROVAL menunggu MANUSIA (brand bisa baru buka besok pagi) —
    // jangan pernah di-sweep sebagai "macet".
    if (job.state === "AWAITING_APPROVAL") continue;
    const limitMin = config.stateTimeoutsMin[job.state] ?? 90;
    const changedAt = new Date(job.state_changed_at ?? job.created_at).getTime();
    if (Date.now() - changedAt > limitMin * 60_000) {
      failJob(job, `Job di state ${job.state} lebih dari ${limitMin} menit`);
      swept++;
    }
  }
  return swept;
}
