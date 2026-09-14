/**
 * KURASI KLIP — frame di sepanjang klip, bukan hanya gambar kuncinya.
 *
 * Kurasi gambar kunci hanya menilai detik ke-0. Model video menambah hal
 * sesudahnya: pada Faza v5 (Standard) sebuah kaleng semprot merek lain muncul
 * di lantai pada shot "deteksi kerusakan", dan pada v3 pengendara "berangkat"
 * lalu tiba di dalam garasi. Gambar kuncinya lolos; klipnya tidak.
 *
 * Setiap klip diambil beberapa frame (dengan cap waktunya), dan model yang
 * tidak membuat klip itu menentukan sampai detik berapa klip masih benar.
 * Perakitan tidak pernah memakai bagian sesudahnya.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import sharp from "sharp";
import { z } from "zod";
import { config } from "../config";
import type { NaskahIklan } from "./naskah";
import { faktaUntuk, type KategoriRealitas } from "./realitas";

const jalankan = promisify(execFile);
export const MODEL_KURASI_KLIP = "claude-opus-5";

const SkemaNilaiKlip = z.object({
  hasil: z.array(z.object({
    klip: z.string().describe("The clip id exactly as given, e.g. 'klip-06' or 'klip-05-sesudah'"),
    lulus: z.boolean().describe("true if every sampled frame is acceptable"),
    aman_sampai_detik: z.number().nullable().describe("The timestamp of the LAST sampled frame before the first defect appears; null if the defect is already in the first sampled frame; the last timestamp if no defect."),
    masalah: z.array(z.string()).describe("English. Concrete defects with the timestamp where they appear. Empty when lulus."),
  })),
});
export type NilaiKlip = z.infer<typeof SkemaNilaiKlip>["hasil"][number];

async function durasi(berkas: string): Promise<number> {
  const { stdout } = await jalankan(config.ffprobePath, ["-v", "error", "-show_entries", "format=duration", "-of", "csv=p=0", berkas]);
  return Number(stdout.trim()) || 0;
}

async function frame(berkas: string, t: number): Promise<string> {
  const { stdout } = await jalankan(config.ffmpegPath, [
    "-v", "error", "-ss", t.toFixed(2), "-i", berkas, "-frames:v", "1", "-vf", "scale=-2:560", "-f", "image2pipe", "-vcodec", "mjpeg", "-",
  ], { encoding: "buffer", maxBuffer: 16 * 1024 * 1024 }) as unknown as { stdout: Buffer };
  return (await sharp(stdout).jpeg({ quality: 78 }).toBuffer()).toString("base64");
}

export interface KlipDinilai {
  id: string;
  path: string;
  shot: number;
  sesudah: boolean;
}

export async function kurasiKlip(
  n: NaskahIklan, klip: KlipDinilai[], kategori: KategoriRealitas[],
): Promise<{ nilai: NilaiKlip[]; biayaIdr: number }> {
  if (!klip.length) return { nilai: [], biayaIdr: 0 };
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const isi: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: `FILM LOOK: ${n.gaya_visual_en}\nRECURRING ELEMENTS: ${n.aset.map((a) => `${a.id} (${a.jenis}): ${a.deskripsi_en}`).join(" | ") || "none"}` },
    { type: "text", text: `REAL-WORLD FACTS:\n${faktaUntuk(kategori)}` },
  ];
  for (const k of klip) {
    const s = n.shots[k.shot];
    const d = await durasi(k.path);
    const titik = [0.3, d * 0.35, d * 0.65, Math.max(0.3, d - 0.25)].map((x) => Number(x.toFixed(2)));
    isi.push({
      type: "text",
      text: `CLIP ${k.id} — shot ${k.shot + 1} (${s.beat}, ${s.ukuran}), ${d.toFixed(1)}s. Intended: ${k.sesudah ? s.transformasi_en : s.visual_en} `
        + `Motion: ${s.gerak_en} Product: ${s.produk}. Must NOT show: ${(s.hindari_en ?? []).join("; ") || "-"}.`,
    });
    for (const t of titik) {
      isi.push({ type: "text", text: `${k.id} @ ${t}s` });
      isi.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await frame(k.path, t) } });
    }
  }
  isi.push({ type: "text", text: `Judge every clip: ${klip.map((k) => k.id).join(", ")}.` });

  const stream = client.beta.messages.stream({
    model: MODEL_KURASI_KLIP,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(SkemaNilaiKlip) },
    system: "You are the independent QC editor of a commercial film. Each clip is shown as timestamped frames. A frame is DEFECTIVE if it shows: "
      + "a new object or product that was not in the first frame (especially other brands' bottles, cans or packaging); objects appearing, vanishing or "
      + "morphing; people, vehicles or parts changing identity, shape or placement; anatomy defects; motion that contradicts real-world physics or the "
      + "REAL-WORLD FACTS (e.g. a vehicle moving sideways, an engine where the vehicle has none); the scene turning into a different place or time of day; "
      + "smoke/steam/fire from an engine; readable garbled lettering; unsafe riding. Normal camera movement, natural motion blur and small lighting shifts "
      + "are fine. Report the earliest defective timestamp through aman_sampai_detik.",
    messages: [{ role: "user", content: isi }],
  });
  const jawaban = await stream.finalMessage();
  const teks = jawaban.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const nilai = SkemaNilaiKlip.parse(JSON.parse(teks)).hasil;
  const u = jawaban.usage;
  const biayaIdr = Math.round((((u.input_tokens + (u.cache_read_input_tokens ?? 0)) * 5 + u.output_tokens * 25) / 1e6) * 16500);
  return { nilai, biayaIdr };
}

/** Id klip dari nama berkasnya. */
export const idKlip = (p: string) => path.basename(p).replace(/\.mp4$/, "");

export function bacaBatasAman(berkas: string): Record<string, number | null> {
  return fs.existsSync(berkas) ? JSON.parse(fs.readFileSync(berkas, "utf8")) : {};
}
