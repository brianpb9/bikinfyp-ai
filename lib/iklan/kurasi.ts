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
    lulus: z.boolean(),
    masalah: z.array(z.string()).describe("English. Concrete visible defects. Empty when lulus is true."),
  })),
});

export type NilaiKeyframe = z.infer<typeof SkemaNilai>["hasil"][number];

const KRITERIA = `You are the independent asset curator of a commercial film studio. Each image is the FIRST FRAME of one
shot in a 30-second vertical product film. Reject any image a demanding creative director would send back.

Reject (lulus=false) when ANY of these is visible:
- Not one single photograph: collage, grid, split screen, triptych, stacked panels, borders, letterboxing, blurred bars.
- Does not show what the shot intends (wrong action, wrong location, wrong time of day, wrong subject, missing key element),
  or merely repeats the composition of another shot instead of the intended one.
- Physically impossible or absurd: detached parts held in hands, floating objects, liquids behaving wrongly, broken perspective.
- Anatomy defects: extra/missing/fused fingers, twisted limbs, melted faces, duplicated people.
- The product, when it should appear, looks different from the product photo (shape, colour, label design) or is cropped,
  blurred or covered; or the product appears when the shot says it must not.
- Added text, captions, watermarks, fake logos or gibberish lettering (the product's own label is allowed).
- A recurring character whose face, hair or clothing clearly differs from their description.

Do not reject for taste alone. Be specific in masalah so the image can be regenerated correctly.`;

async function kecilkan(berkas: string): Promise<string> {
  return (await sharp(berkas).resize({ height: 900 }).jpeg({ quality: 80 }).toBuffer()).toString("base64");
}

export async function kurasiKeyframes(n: NaskahIklan, keyframes: string[], fotoProduk: Buffer, indeks?: number[]): Promise<{ nilai: NilaiKeyframe[]; biayaIdr: number }> {
  if (!config.anthropicApiKey) throw new Error("ANTHROPIC_API_KEY belum diisi.");
  const client = new Anthropic({ apiKey: config.anthropicApiKey });
  const dinilai = indeks ?? n.shots.map((_, i) => i);

  const isi: Anthropic.Beta.BetaContentBlockParam[] = [
    { type: "text", text: "PRODUCT PHOTO (authority for how the product looks):" },
    { type: "image", source: { type: "base64", media_type: "image/jpeg", data: (await sharp(fotoProduk).resize({ height: 700 }).jpeg({ quality: 80 }).toBuffer()).toString("base64") } },
    { type: "text", text: `FILM LOOK: ${n.gaya_visual_en}\nRECURRING CHARACTERS: ${n.pemeran.map((p) => `${p.id}: ${p.deskripsi_en}`).join(" | ") || "none"}` },
  ];
  for (const i of dinilai) {
    const s = n.shots[i];
    isi.push({
      type: "text",
      text: `SHOT ${i + 1} (${s.beat}, ${s.ukuran}). Intended first frame: ${s.visual_en} Characters: ${s.pemeran.join(", ") || "none"}. Product: ${s.produk}.`,
    });
    isi.push({ type: "image", source: { type: "base64", media_type: "image/jpeg", data: await kecilkan(keyframes[i]) } });
  }
  isi.push({ type: "text", text: `Judge every shot listed above (${dinilai.map((i) => i + 1).join(", ")}). Return one entry per shot.` });

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

export function simpanNilai(berkas: string, nilai: NilaiKeyframe[]): void {
  fs.writeFileSync(berkas, JSON.stringify(nilai, null, 2));
}
