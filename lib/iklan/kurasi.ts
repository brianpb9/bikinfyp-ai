/**
 * KURASI GAMBAR KUNCI — dinilai SEBELUM klip dirender.
 *
 * Gambar kunci berbiaya ±Rp700; klip yang dirender dari gambar yang salah
 * berbiaya ±Rp2.700 dan tetap harus diulang. Jadi setiap gambar diperiksa
 * dulu terhadap maksud shot-nya.
 *
 * Tiga cacat yang memicu modul ini, semuanya dari render uji pertama
 * (Faza, 14 Sep 2026):
 *   shot 4   Seedream menggambar KOLASE tiga panel, bukan satu foto
 *   shot 8   blok mesin terlepas dipegang tangan sambil disiram — fisika mustahil
 *   shot 11  "motor melaju saat matahari terbit" keluar sebagai pose jongkok di
 *            garasi, disalin dari gambar acuan pemeran
 * Tak satu pun terdeteksi oleh ukuran numerik apa pun; ketiganya jelas bagi mata.
 *
 * Putaran 2 menambahkan tiga hal yang review independen temukan lolos:
 * mesin berganti model antar shot, semprotan tidak mengenai kotoran, dan
 * pengendara tanpa helm. Aset berulang kini ikut dibandingkan dengan gambar
 * jangkarnya, dan shot BUKTI dinilai sebagai PASANGAN sebelum→sesudah.
 */

import fs from "node:fs";
import Anthropic from "@anthropic-ai/sdk";
import { betaZodOutputFormat } from "@anthropic-ai/sdk/helpers/beta/zod";
import sharp from "sharp";
import { z } from "zod";
import { config } from "../config";
import type { NaskahIklan } from "./naskah";

export const MODEL_KURASI = "claude-opus-5";

const SkemaNilai = z.object({
  hasil: z.array(z.object({
    shot: z.number().describe("1-based shot number"),
    bagian: z.enum(["utama", "sesudah"]).describe("'utama' = the shot's first frame; 'sesudah' = the AFTER image of the BUKTI shot"),
    lulus: z.boolean(),
    masalah: z.array(z.string()).describe("English. Concrete visible defects. Empty when lulus is true."),
  })),
});

export type NilaiKeyframe = z.infer<typeof SkemaNilai>["hasil"][number];

const KRITERIA = `You are the independent asset curator of a commercial film studio. Each image is the FIRST FRAME of one
shot in a 30-second vertical product film for Indonesian social media. Reject any image a demanding creative director would send back.

Reject (lulus=false) when ANY of these is visible:
- Not one single photograph: collage, grid, split screen, triptych, stacked panels, borders, letterboxing, blurred bars.
- Does not show what the shot intends (wrong action, location, time of day, subject, missing key element), or merely repeats
  the composition of another shot instead of the intended one.
- Physically impossible or absurd: detached parts held in hands, floating objects, liquid appearing from nowhere, spray
  missing its target, broken perspective.
- Anatomy defects: extra/missing/fused fingers, twisted limbs, melted faces, duplicated people.
- The product, when it should appear, looks different from the product photo (shape, colour, label design) or is cropped,
  blurred or covered; or it appears when the shot says it must not.
- A recurring element (person, vehicle, engine, room) that clearly differs from its ANCHOR image or description: different
  face, clothing, vehicle model, engine type, colour.
- Added text, captions, watermarks, fake logos or gibberish lettering (the product's own label is allowed).
- Unsafe acts: riding without a helmet, driving without a seatbelt.
- Too dark to read on a phone when the look calls for bright exposure.
For the LOCKUP background: reject if any product, bottle, packaging, person or text appears, or if the lower-middle is not an
empty clean surface.
For the BUKTI pair (utama = before, sesudah = after): judge the AFTER image — reject unless it keeps the same camera, framing,
objects and light as the before image AND the change is clearly visible AND it plausibly results from the product, not water,
a rag or someone else's action.

Do not reject for taste alone. Be specific in masalah so the image can be regenerated correctly.`;

async function b64(berkas: string | Buffer, tinggi = 900): Promise<string> {
  return (await sharp(berkas).resize({ height: tinggi }).jpeg({ quality: 80 }).toBuffer()).toString("base64");
}

export async function kurasiKeyframes(
  n: NaskahIklan, keyframes: string[], fotoProduk: Buffer,
  pilihan: { utama: number[]; sesudah: Map<number, string> },
): Promise<{ nilai: NilaiKeyframe[]; biayaIdr: number }> {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY belum diisi.");
  const client = new Anthropic({ apiKey: config.anthropicApiKey });

  const isi: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: "PRODUCT PHOTO (authority for how the product looks):" },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: await b64(fotoProduk, 700) } },
    { type: "text", text: `FILM LOOK: ${n.gaya_visual_en}\nRECURRING ELEMENTS: ${n.aset.map((a) => `${a.id} (${a.jenis}): ${a.deskripsi_en}`).join(" | ") || "none"}` },
  ];

  // Jangkar aset yang tidak sedang dinilai ikut dilampirkan sebagai pembanding.
  const jangkar = new Map<string, number>();
  n.shots.forEach((s, i) => { if (s.beat !== "LOCKUP") s.aset.forEach((id) => { if (!jangkar.has(id)) jangkar.set(id, i); }); });
  const jangkarLuar = [...new Set([...jangkar.values()])].filter((i) => !pilihan.utama.includes(i) && fs.existsSync(keyframes[i]));
  for (const i of jangkarLuar) {
    isi.push({ type: "text", text: `ANCHOR (already approved) shot ${i + 1} — reference for ${n.shots[i].aset.join(", ")}:` });
    isi.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await b64(keyframes[i], 600) } });
  }

  const daftar: string[] = [];
  for (const i of pilihan.utama) {
    const s = n.shots[i];
    isi.push({
      type: "text",
      text: `SHOT ${i + 1} utama (${s.beat}, ${s.ukuran}). Intended first frame: ${s.visual_en} Recurring: ${s.aset.join(", ") || "none"}. Product: ${s.beat === "LOCKUP" ? "NONE — end-card background only" : s.produk}.`,
    });
    isi.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await b64(keyframes[i]) } });
    daftar.push(`${i + 1} utama`);
  }
  for (const [i, p] of pilihan.sesudah) {
    const s = n.shots[i];
    if (!pilihan.utama.includes(i)) {
      isi.push({ type: "text", text: `SHOT ${i + 1} BEFORE image (for comparison only):` });
      isi.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await b64(keyframes[i]) } });
    }
    isi.push({ type: "text", text: `SHOT ${i + 1} sesudah — intended AFTER state of the same frame: ${s.transformasi_en}` });
    isi.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await b64(p) } });
    daftar.push(`${i + 1} sesudah`);
  }
  isi.push({ type: "text", text: `Judge exactly these items and return one entry each: ${daftar.join(", ")}.` });

  const stream = client.beta.messages.stream({
    model: MODEL_KURASI,
    max_tokens: 16000,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    thinking: { type: "adaptive" },
    output_config: { effort: "medium", format: betaZodOutputFormat(SkemaNilai) },
    system: KRITERIA,
    messages: [{ role: "user", content: isi }],
  });
  const jawaban = await stream.finalMessage();
  if (jawaban.stop_reason === "refusal") throw new Error("Kurasi ditolak model.");
  const teks = jawaban.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
  const hasil = SkemaNilai.parse(JSON.parse(teks)).hasil;
  const u = jawaban.usage;
  const masuk = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0);
  const biayaIdr = Math.round(((masuk * 5 + u.output_tokens * 25) / 1e6) * 16500);
  return { nilai: hasil, biayaIdr };
}

/** Catatan perbaikan untuk prompt gambar ulang. */
export function catatanUlang(nilai: NilaiKeyframe): string {
  return `PREVIOUS ATTEMPT WAS REJECTED FOR: ${nilai.masalah.join("; ")}. Fix every one of these.`;
}
