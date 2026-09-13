/**
 * VOICE-OVER IKLAN — satu berkas per kalimat, durasinya diukur.
 *
 * Satu TTS untuk seluruh naskah (jalur afiliasi) tidak bisa dipakai di sini:
 * setiap kalimat harus mulai tepat di shot-nya, dan panjang shot disesuaikan
 * dengan panjang kalimat yang BENAR-BENAR diucapkan, bukan perkiraan kata.
 * Suara terkunci per video (satu voiceName), jadi kalimat terpisah tetap
 * terdengar sebagai satu narator.
 */

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { config } from "../config";
import { synthesizeGeminiVoiceover } from "../media/gemini-tts";
import type { NaskahIklan } from "./naskah";

export function pilihSuara(n: NaskahIklan): string {
  return /\b(female|woman|she|perempuan|wanita)\b/i.test(n.suara_en) ? "Kore" : "Charon";
}

export function durasiAudio(berkas: string): number {
  const out = execFileSync(config.ffprobePath, [
    "-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", berkas,
  ]).toString().trim();
  return Number(out) || 0;
}

export interface KalimatVo {
  shot: number;
  path: string;
  detik: number;
}

export async function buatVo(n: NaskahIklan, dir: string): Promise<{ kalimat: KalimatVo[]; biayaIdr: number }> {
  fs.mkdirSync(dir, { recursive: true });
  const suara = pilihSuara(n);
  // TEMPO DIUKUR, BUKAN DIKIRA. Render uji pertama (Faza, 14 Sep 2026) memakai
  // "unhurried" dan keluar 1,7 kata/detik; narator Blueprint 2,3–2,5
  // kata/detik. Selisih itu memanjangkan iklan 33 detik jadi 43 detik dan
  // membuat shot hook bertahan 5 detik.
  const gaya = [
    `Indonesian television commercial narrator. ${n.suara_en}`,
    "Confident, warm and brisk: a polished TV-commercial read at about 150 words per minute.",
    "Clear articulation, only very short pauses at commas, no dragging vowels, no exaggerated sales tone.",
    "Speak Bahasa Indonesia with standard pronunciation.",
  ].join(" ");
  const kalimat: KalimatVo[] = [];
  let biayaIdr = 0;
  for (const [i, shot] of n.shots.entries()) {
    // Lafal hanya untuk TTS: subtitle tetap menampilkan ejaan aslinya.
    // Render uji Faza v3: "Degreaser" diucapkan "di Grisar".
    const teks = n.lafal.reduce(
      (t, l) => (l.tulisan.trim() ? t.replace(new RegExp(l.tulisan.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi"), l.ucapan) : t),
      shot.vo.trim(),
    );
    if (!teks) continue;
    const berkas = path.join(dir, `vo-${String(i + 1).padStart(2, "0")}.wav`);
    if (!fs.existsSync(berkas)) {
      const hasil = await synthesizeGeminiVoiceover(teks, suara, gaya, berkas);
      biayaIdr += hasil.costIdr;
      // Buang hening di awal/akhir: penempatan kalimat diatur timeline, bukan
      // oleh jeda yang kebetulan dihasilkan TTS.
      const rapi = berkas.replace(/\.wav$/, ".rapi.wav");
      execFileSync(config.ffmpegPath, [
        "-y", "-v", "error", "-i", berkas,
        "-af", "silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.05,areverse,silenceremove=start_periods=1:start_threshold=-45dB:start_silence=0.08,areverse",
        rapi,
      ]);
      fs.renameSync(rapi, berkas);
    }
    kalimat.push({ shot: i, path: berkas, detik: durasiAudio(berkas) });
  }
  return { kalimat, biayaIdr };
}
