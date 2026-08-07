// Resumability minimal-risiko (r13, review QA 2026-08-07): "Job PostgreSQL
// belum resumable dari state ..." — retry BullMQ SELALU gagal instan begitu
// state lewat QUEUED, jadi kegagalan TRANSIEN di step manapun setelah video
// selesai (compositing, storage, TTS non-retryable lain) membakar biaya
// provider (~Rp8-37rb) TANPA percobaan ulang sungguhan — cuma refund.
//
// Fix bertahap yang aman: sebelum memanggil provider video (paling mahal),
// cek apakah klip shot dari upaya SEBELUMNYA (proses worker yang sama, belum
// crash — workDir lokal tidak hilang) sudah ada & valid di disk. Kalau ya,
// PAKAI ULANG — lewati panggilan provider sepenuhnya. Tidak menutupi SEMUA
// kasus (worker crash penuh di Render bisa menghapus disk lokal), tapi
// menutupi kasus yang lebih umum: error di step SETELAH video sukses tanpa
// crash proses (persis insiden Gemini TTS 503 hari ini).

import fs from "node:fs";
import path from "node:path";
import { probeDurationSec } from "./ffmpeg";
import type { VisualSpec, VideoAsset } from "../providers/types";

export interface ReusedClips {
  assets: VideoAsset[];
  providerName: string;
  costIdr: number; // 0 — biaya sudah tercatat di upaya sebelumnya, jangan dobel
}

/** Cek klip shot0.mp4, shot1.mp4, ... di workDir dari upaya sebelumnya —
 * valid bila ADA, non-kosong, dan durasinya masuk akal (toleransi 3 dtk). */
export async function findReusableClips(workDir: string, spec: VisualSpec): Promise<ReusedClips | null> {
  const assets: VideoAsset[] = [];
  for (let i = 0; i < spec.shots.length; i++) {
    const filePath = path.join(workDir, `shot${i}.mp4`);
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 1024) return null;
    let durationSec: number;
    try {
      durationSec = await probeDurationSec(filePath);
    } catch {
      return null; // file korup/tak terbaca — jangan dipakai, generate ulang lebih aman
    }
    if (Math.abs(durationSec - spec.shots[i].durationSec) > 3) return null; // bukan klip yang cocok
    assets.push({ filePath, durationSec, costIdr: 0, hasAudio: spec.generateAudio });
  }
  return { assets, providerName: "reused-from-disk", costIdr: 0 };
}
