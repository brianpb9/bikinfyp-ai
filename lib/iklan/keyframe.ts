/**
 * GAMBAR KUNCI PER SHOT — Seedream, 9:16 penuh, produk dan pemeran terkunci.
 *
 * Setiap shot iklan dimulai dari gambar yang digambar sebagai ADEGAN, bukan
 * dari foto produk yang ditambal. Foto yang ditambal pita blur adalah sumber
 * pita blur di dua dari tiga video produksi yang dibedah 14 Sep 2026 — model
 * video meniru komposisi berpitanya sepanjang klip.
 *
 * KONSISTENSI PEMERAN: shot pertama tempat seorang pemeran muncul digambar
 * lebih dulu, lalu gambarnya ikut dilampirkan sebagai acuan wajah dan pakaian
 * untuk setiap shot berikutnya yang memuat pemeran yang sama. Teks deskripsi
 * saja tidak cukup: dua gambar dari kalimat yang sama menghasilkan dua orang.
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import type { NaskahIklan, ShotIklan } from "./naskah";

const MODEL = "dola-seedream-5-0-pro-260628";
/** 9:16. Di atas batas minimum piksel Seedream, di bawah 2K supaya cepat. */
const UKURAN = "1080x1920";
export const BIAYA_GAMBAR_IDR = Number(process.env.SEEDREAM_BIAYA_GAMBAR_IDR ?? "700");

const UKURAN_EN: Record<ShotIklan["ukuran"], string> = {
  wide: "Wide establishing shot",
  medium: "Medium shot",
  close_up: "Close-up shot",
  macro: "Macro detail shot with shallow depth of field",
  insert: "Insert shot of hands and object",
};

const PRODUK_EN: Record<ShotIklan["produk"], string> = {
  tidak_tampil: "The product does NOT appear in this image.",
  dipakai:
    "The product appears naturally in use as part of the scene, recognisable and identical to the reference, but not the only focus.",
  jelas:
    "The product is clearly visible and in sharp focus, fully inside the frame, label facing the camera and legible, never covered by hands.",
  pahlawan:
    "Premium hero packshot: the product alone, centred in the lower-middle of the frame on a clean surface that fits the film's look, "
    + "soft controlled light and subtle reflection, the upper third of the frame is calm empty space (for a title). Label facing camera, perfectly legible.",
};

export function promptKeyframe(n: NaskahIklan, shot: ShotIklan, acuan: { produk: boolean; pemeran: string[] }): string {
  const bagian: string[] = [];
  let nomor = 1;
  if (acuan.produk) {
    bagian.push(
      `REFERENCE IMAGE ${nomor++} shows ONLY the product. It is the authority for the product's shape, colour, material, proportions and label. `
      + "Do NOT copy that photo's background, framing, text or graphics — build the new scene below.",
    );
  }
  for (const id of acuan.pemeran) {
    bagian.push(`REFERENCE IMAGE ${nomor++} shows the character "${id}". Keep exactly the same face, hair and clothing.`);
  }
  bagian.push(`LOOK (identical for the whole film): ${n.gaya_visual_en}`);
  bagian.push(`${UKURAN_EN[shot.ukuran]}. ${shot.visual_en}`);
  const orang = n.pemeran.filter((p) => shot.pemeran.includes(p.id));
  if (orang.length) bagian.push(`CHARACTERS: ${orang.map((p) => `${p.id}: ${p.deskripsi_en}`).join(" ")}`);
  else bagian.push("No recurring character in this shot.");
  bagian.push(PRODUK_EN[shot.produk]);
  bagian.push(
    "High-end Indonesian TV commercial still, photographic realism, natural skin texture, correct hands with five fingers, "
    + "believable physics. Absolutely no added text, captions, subtitles, watermarks, logos, signage lettering or user-interface elements.",
  );
  bagian.push("Vertical 9:16 full-bleed composition, no borders, no letterboxing.");
  return bagian.join("\n");
}

function dataUri(b: Buffer): string {
  const mime = b.subarray(0, 4).toString("hex") === "89504e47"
    ? "image/png"
    : b.length > 12 && b.subarray(8, 12).toString("ascii") === "WEBP" ? "image/webp" : "image/jpeg";
  return `data:${mime};base64,${b.toString("base64")}`;
}

async function panggilSeedream(prompt: string, acuan: Buffer[]): Promise<Buffer> {
  if (!config.byteplusApiKey) throw new Error("BYTEPLUS_ARK_API_KEY belum diisi.");
  const kirim = async (gambar: Buffer[]) => fetch(`${config.byteplusBaseUrl}/images/generations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${config.byteplusApiKey}` },
    body: JSON.stringify({
      model: MODEL,
      prompt,
      ...(gambar.length === 1 ? { image: dataUri(gambar[0]) } : gambar.length > 1 ? { image: gambar.map(dataUri) } : {}),
      response_format: "url",
      size: UKURAN,
      stream: false,
      watermark: false,
      sequential_image_generation: "disabled",
    }),
    signal: AbortSignal.timeout(180_000),
  });

  for (let coba = 1; coba <= 3; coba++) {
    const res = await kirim(acuan);
    const teks = await res.text();
    let data: { data?: { url?: string }[]; error?: { message?: string } } = {};
    try { data = JSON.parse(teks); } catch { /* teks mentah di pesan galat */ }
    if (res.ok && data.data?.[0]?.url) {
      const unduh = await fetch(data.data[0].url, { signal: AbortSignal.timeout(60_000) });
      if (!unduh.ok) throw new Error(`Seedream: unduh gambar HTTP ${unduh.status}`);
      return Buffer.from(await unduh.arrayBuffer());
    }
    const pesan = `Seedream HTTP ${res.status}: ${data.error?.message ?? teks.slice(0, 300)}`;
    if (res.status === 429 || res.status >= 500) {
      console.warn(`[iklan/keyframe] ${pesan} — ulang ${coba}/3`);
      await new Promise((r) => setTimeout(r, 4000 * coba));
      continue;
    }
    throw new Error(pesan);
  }
  throw new Error("Seedream gagal setelah 3 percobaan.");
}

export interface HasilKeyframe {
  paths: string[];
  jumlahDibuat: number;
  biayaIdr: number;
}

/**
 * Gambar semua keyframe ke `dir/kf-XX.jpg`. Berkas yang sudah ada TIDAK
 * digambar ulang — render uji bisa dilanjutkan tanpa membayar dua kali.
 */
export async function buatKeyframes(n: NaskahIklan, fotoProduk: Buffer, dir: string, opts: { paralel?: number } = {}): Promise<HasilKeyframe> {
  fs.mkdirSync(dir, { recursive: true });
  const paths = n.shots.map((_, i) => path.join(dir, `kf-${String(i + 1).padStart(2, "0")}.jpg`));
  let jumlahDibuat = 0;

  // Jangkar pemeran: indeks shot pertama tempat tiap pemeran muncul.
  const jangkar = new Map<string, number>();
  n.shots.forEach((s, i) => s.pemeran.forEach((id) => { if (!jangkar.has(id)) jangkar.set(id, i); }));
  const shotJangkar = new Set(jangkar.values());

  const gambar = async (i: number) => {
    if (fs.existsSync(paths[i]) && fs.statSync(paths[i]).size > 1024) return;
    const shot = n.shots[i];
    const pakaiProduk = shot.produk !== "tidak_tampil";
    // Acuan pemeran hanya dari jangkar yang BUKAN shot ini sendiri, dan hanya
    // bila gambar jangkarnya sudah jadi.
    const pemeranAcuan = shot.pemeran.filter((id) => jangkar.get(id) !== i && fs.existsSync(paths[jangkar.get(id)!]));
    const acuan: Buffer[] = [];
    if (pakaiProduk) acuan.push(fotoProduk);
    for (const id of pemeranAcuan) acuan.push(fs.readFileSync(paths[jangkar.get(id)!]));
    const prompt = promptKeyframe(n, shot, { produk: pakaiProduk, pemeran: pemeranAcuan });
    fs.writeFileSync(paths[i].replace(/\.jpg$/, ".prompt.txt"), prompt);
    const t0 = Date.now();
    const bytes = await panggilSeedream(prompt, acuan);
    fs.writeFileSync(paths[i], bytes);
    jumlahDibuat++;
    console.log(`[iklan/keyframe] shot ${i + 1}/${n.shots.length} (${shot.beat}, acuan=${acuan.length}) ${Math.round((Date.now() - t0) / 1000)}s`);
  };

  const paralel = opts.paralel ?? 4;
  const jalankan = async (indeks: number[]) => {
    const antre = [...indeks];
    await Promise.all(Array.from({ length: Math.min(paralel, antre.length) }, async () => {
      for (let i = antre.shift(); i !== undefined; i = antre.shift()) await gambar(i);
    }));
  };
  // Jangkar dulu, sisanya sesudah — supaya acuan wajahnya sudah ada.
  await jalankan([...shotJangkar]);
  await jalankan(n.shots.map((_, i) => i).filter((i) => !shotJangkar.has(i)));

  return { paths, jumlahDibuat, biayaIdr: jumlahDibuat * BIAYA_GAMBAR_IDR };
}
