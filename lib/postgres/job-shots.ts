/**
 * Penyimpanan shot per-job untuk gerbang review scene brand (M11, F-ENT-01).
 *
 * regen_count sengaja TIDAK disentuh di sini: yang dihitung adalah berapa kali
 * BRAND meminta ganti (di-increment route regenerate), bukan berapa kali worker
 * kebetulan menyimpan ulang seluruh shot.
 *
 * Kenapa shot disalin ke storage DURABLE, bukan dibiarkan di workDir lokal
 * saja: gerbang approval menunggu MANUSIA. Brand bisa baru membuka dashboard
 * besok pagi, saat container worker yang menghasilkan klip itu sudah lama
 * mati dan disk lokalnya hilang. findReusableClips (resume-clips.ts) hanya
 * melihat disk lokal — cukup untuk retry transien beberapa detik kemudian,
 * TIDAK cukup untuk jeda berjam-jam. Jadi di sini klip di-upload, lalu
 * di-materialize lagi ke workDir saat job dilanjutkan.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { Pool } from "pg";
import { config } from "../config";
import { runFf } from "../media/ffmpeg";
import { mediaStorage } from "../storage";

export interface JobShotRow {
  id: string;
  job_id: string;
  idx: number;
  prompt: string;
  storage_key: string;
  thumb_key: string | null;
  duration_sec: number;
  regen_requested: boolean;
  regen_count: number;
  created_at: string;
}

export async function loadJobShots(pool: Pool, jobId: string): Promise<JobShotRow[]> {
  return (await pool.query<JobShotRow>("SELECT * FROM job_shots WHERE job_id=$1 ORDER BY idx ASC", [jobId])).rows;
}

/** Frame diam untuk kartu review — brand menilai GAMBAR dulu, bukan memutar
 * tiap klip satu per satu. Diambil di 0.5 dtk supaya tidak kena frame hitam
 * pembuka. Kegagalan thumbnail TIDAK menggagalkan job: gambar hilang jauh
 * lebih ringan daripada render yang di-refund. */
async function makeThumb(clipPath: string, outPath: string): Promise<boolean> {
  try {
    await runFf(config.ffmpegPath, ["-y", "-ss", "0.5", "-i", clipPath, "-frames:v", "1", "-q:v", "4", outPath]);
    return fs.existsSync(outPath) && fs.statSync(outPath).size > 0;
  } catch {
    return false;
  }
}

/** Upload klip (+ thumbnail) ke storage durable dan upsert barisnya. */
export async function persistJobShots(
  pool: Pool,
  jobId: string,
  shots: { idx: number; prompt: string; filePath: string; durationSec: number }[]
): Promise<void> {
  for (const shot of shots) {
    const storageKey = `jobs/${jobId}/shot${shot.idx}.mp4`;
    await mediaStorage().put(storageKey, fs.readFileSync(shot.filePath), "video/mp4");

    let thumbKey: string | null = `jobs/${jobId}/shot${shot.idx}.jpg`;
    const localThumb = path.join(path.dirname(shot.filePath), `shot${shot.idx}.jpg`);
    if (await makeThumb(shot.filePath, localThumb)) {
      await mediaStorage().put(thumbKey, fs.readFileSync(localThumb), "image/jpeg");
    } else {
      thumbKey = null;
    }

    await pool.query(
      `INSERT INTO job_shots (id, job_id, idx, prompt, storage_key, thumb_key, duration_sec, regen_requested, regen_count, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,FALSE,0,$8)
       ON CONFLICT (job_id, idx) DO UPDATE
         SET prompt=EXCLUDED.prompt, storage_key=EXCLUDED.storage_key, thumb_key=EXCLUDED.thumb_key,
             duration_sec=EXCLUDED.duration_sec, regen_requested=FALSE`,
      [crypto.randomUUID(), jobId, shot.idx, shot.prompt, storageKey, thumbKey, shot.durationSec, new Date().toISOString()]
    );
  }
}

/** Tarik klip yang tersimpan kembali ke workDir sebagai shot{i}.mp4, supaya
 * findReusableClips menemukannya dan provider TIDAK dipanggil ulang (klip
 * yang sudah disetujui brand harus dipakai apa adanya — dan tidak dibayar
 * dua kali). Return jumlah klip yang berhasil ditarik. */
export async function materializeJobShots(pool: Pool, jobId: string, workDir: string): Promise<number> {
  const rows = await loadJobShots(pool, jobId);
  fs.mkdirSync(workDir, { recursive: true });
  let restored = 0;
  for (const row of rows) {
    const target = path.join(workDir, `shot${row.idx}.mp4`);
    if (fs.existsSync(target) && fs.statSync(target).size > 1024) { restored++; continue; }
    const local = await mediaStorage().materialize(row.storage_key).catch(() => null);
    if (!local) continue;
    if (path.resolve(local) !== path.resolve(target)) fs.copyFileSync(local, target);
    restored++;
  }
  return restored;
}
