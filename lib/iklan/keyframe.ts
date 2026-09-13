/**
 * GAMBAR KUNCI PER SHOT — Seedream, 9:16 penuh, produk dan aset terkunci.
 *
 * Setiap shot iklan dimulai dari gambar yang digambar sebagai ADEGAN, bukan
 * dari foto produk yang ditambal. Foto yang ditambal pita blur adalah sumber
 * pita blur di dua dari tiga video produksi yang dibedah 14 Sep 2026 — model
 * video meniru komposisi berpitanya sepanjang klip.
 *
 * KONSISTENSI ASET: shot pertama tempat sebuah aset (orang ATAU properti —
 * motor, mesin, ruangan) muncul digambar lebih dulu, lalu gambarnya dilampirkan
 * sebagai acuan identitas untuk setiap shot berikutnya yang memuat aset itu.
 * Render uji Faza memakai acuan hanya untuk orang, dan mesinnya berganti model
 * tiga kali dalam satu iklan (creative director: "twin-cylinder engine in the
 * hook, single-cylinder in the rinse").
 *
 * BUKTI SEBELUM→SESUDAH: shot BUKTI mendapat gambar kedua, digambar dari gambar
 * pertamanya sebagai acuan, dengan bingkai yang sama dan hanya keadaan yang
 * berubah. Perakitan menyapu dari satu ke yang lain.
 *
 * LOCKUP: latarnya digambar TANPA produk. Foto produk asli penjual ditempel di
 * atasnya saat perakitan — label kecil yang digambar model selalu jadi huruf
 * acak ("Besvio Karet, Melajo" pada render uji Faza).
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

/**
 * Render uji Faza v3, dua reviewer: label botol yang digambar model selalu
 * jadi huruf acak ("PAEA AUTO CARE", "IHGINE DEOREASER") dan ukurannya
 * membesar. Maka produk AI tidak pernah diminta menampilkan label terbaca;
 * label yang terbaca hanya milik foto asli (shot "asli" dan LOCKUP).
 */
const PRODUK_EN: Record<"tidak_tampil" | "dipakai", string> = {
  tidak_tampil: "The product does NOT appear in this image.",
  dipakai:
    "The product appears in the hand or in use, recognisable by its exact shape and colours from the reference, at its true real-world size relative to "
    + "the hands. Its label is turned away from the camera, small or softly out of focus, so NO lettering on it is readable.",
};

export const pathSesudah = (p: string) => p.replace(/\.jpg$/, "-sesudah.jpg");

export function promptKeyframe(
  n: NaskahIklan, shot: ShotIklan,
  acuan: { produk: boolean; aset: string[] },
  catatan?: string,
): string {
  const bagian: string[] = [];
  // Render uji pertama (Faza, shot 4): dua gambar acuan membuat Seedream
  // menggambar kolase tiga panel. Dinyatakan di awal, sebelum apa pun.
  bagian.push("Create ONE single continuous photograph that fills the whole frame — never a collage, grid, split screen, triptych or multiple panels.");
  let nomor = 1;
  if (acuan.produk) {
    bagian.push(
      `REFERENCE IMAGE ${nomor++} shows ONLY the product. It is the authority for the product's shape, colour, material, proportions and label. `
      + "Do NOT copy that photo's background, framing, text or graphics — build the new scene below.",
    );
  }
  for (const id of acuan.aset) {
    // Render uji pertama (Faza, shot 11): tanpa kalimat kedua, adegan "motor
    // melaju saat matahari terbit" keluar sebagai pose jongkok dari acuan.
    bagian.push(
      `REFERENCE IMAGE ${nomor++} shows "${id}" for IDENTITY ONLY: keep exactly the same face/hair/clothing (person) or the same model, `
      + "shape, colour and details (object). Do NOT copy that image's pose, framing, location, lighting or action — this is a different moment.",
    );
  }
  if (catatan) bagian.push(catatan);
  bagian.push(`LOOK (identical for the whole film): ${n.gaya_visual_en} Bright, clean exposure that reads well on a phone screen.`);
  if (shot.beat === "LOCKUP" || shot.produk === "asli") {
    bagian.push(
      `${UKURAN_EN[shot.ukuran]}. ${shot.visual_en}`,
      shot.beat === "LOCKUP"
        ? "END-CARD BACKGROUND from the same place, light and time of day as the film: an uncluttered surface and softly blurred background. The lower-middle of the frame is an EMPTY "
          + "clean surface where a product will be placed later; the upper third is calm negative space for a title."
        : "PRODUCT-REVEAL BACKGROUND from the film's world: an uncluttered surface with soft directional light suited to a product hero shot, the CENTRE of the frame is an "
          + "EMPTY clean surface where a product will be placed later, background softly out of focus.",
      "NO product, NO bottle, NO packaging, NO people, NO hands, NO text, NO logos.",
    );
    return bagian.join("\n");
  }
  bagian.push(`${UKURAN_EN[shot.ukuran]}. ${shot.visual_en}`);
  if (shot.ukuran === "insert" || shot.ukuran === "macro") {
    bagian.push("FRAMING IS TIGHT: fill the frame with the object and at most hands/forearms. No full body, no face, no wide background.");
  }
  const muncul = n.aset.filter((a) => shot.aset.includes(a.id));
  if (muncul.length) bagian.push(`RECURRING ELEMENTS: ${muncul.map((a) => `${a.id} (${a.jenis}): ${a.deskripsi_en}`).join(" ")}`);
  bagian.push(PRODUK_EN[shot.produk === "dipakai" ? "dipakai" : "tidak_tampil"]);
  bagian.push(
    "High-end Indonesian TV commercial still, photographic realism, natural skin texture, correct hands with five fingers, "
    + "believable physics, liquids coming from their real source, actions aimed at the right part. Riders wear helmets. No logos or badges of any other brand on vehicles, clothes or objects. "
    + "Absolutely no added text, captions, subtitles, watermarks, logos, signage lettering or user-interface elements.",
  );
  bagian.push("Vertical 9:16 full-bleed composition, no borders, no letterboxing.");
  return bagian.join("\n");
}

export function promptSesudah(n: NaskahIklan, shot: ShotIklan, catatan?: string): string {
  return [
    "REFERENCE IMAGE 1 is the BEFORE frame of this shot. Recreate the EXACT same photograph — identical camera position, lens, framing, "
    + "lighting, objects, people, hands and product placement — with ONLY this change:",
    shot.transformasi_en,
    catatan ?? "",
    `LOOK: ${n.gaya_visual_en}`,
    "One single photograph, no split screen, no text, no added objects. Vertical 9:16 full-bleed.",
  ].filter(Boolean).join("\n");
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
  /** Gambar SESUDAH untuk shot BUKTI, bila ada (indeks shot -> path). */
  sesudah: Map<number, string>;
  jumlahDibuat: number;
  biayaIdr: number;
}

/**
 * Gambar semua keyframe ke `dir/kf-XX.jpg` (+ `kf-XX-sesudah.jpg` untuk BUKTI).
 * Berkas yang sudah ada TIDAK digambar ulang — render uji bisa dilanjutkan
 * tanpa membayar dua kali.
 */
export async function buatKeyframes(
  n: NaskahIklan, fotoProduk: Buffer, dir: string,
  opts: { paralel?: number; catatan?: Map<number, string>; catatanSesudah?: Map<number, string> } = {},
): Promise<HasilKeyframe> {
  fs.mkdirSync(dir, { recursive: true });
  const paths = n.shots.map((_, i) => path.join(dir, `kf-${String(i + 1).padStart(2, "0")}.jpg`));
  let jumlahDibuat = 0;
  const ada = (p: string) => fs.existsSync(p) && fs.statSync(p).size > 1024;

  // Jangkar aset: indeks shot pertama tempat tiap aset muncul (LOCKUP tidak dihitung).
  const jangkar = new Map<string, number>();
  n.shots.forEach((s, i) => { if (s.beat !== "LOCKUP" && s.produk !== "asli") s.aset.forEach((id) => { if (!jangkar.has(id)) jangkar.set(id, i); }); });
  const shotJangkar = new Set(jangkar.values());

  const gambar = async (i: number) => {
    if (ada(paths[i])) return;
    const shot = n.shots[i];
    const pakaiProduk = shot.produk === "dipakai";
    // SHOT DEKAT HANYA MEMBAWA ACUAN PROPERTI, maksimal satu.
    //
    // Render uji Faza v3: insert "nozel masuk ke celah mesin" ditolak kurasi
    // tiga kali berturut-turut karena keluar sebagai medium shot seluruh badan.
    // Acuannya orang + motor + carport — gambar acuan berbingkai lebar menarik
    // komposisi ke lebar, apa pun bunyi prompt-nya. Di insert/makro yang
    // terlihat hanya tangan dan benda; wajah tidak perlu dikunci di sana.
    const dekat = shot.ukuran === "insert" || shot.ukuran === "macro";
    const asetAcuan = shot.beat === "LOCKUP" || shot.produk === "asli"
      ? []
      : shot.aset
        .filter((id) => jangkar.get(id) !== i && ada(paths[jangkar.get(id)!]))
        .filter((id) => !dekat || n.aset.find((a) => a.id === id)?.jenis === "properti")
        .slice(0, dekat ? 1 : 3);
    const acuan: Buffer[] = [];
    if (pakaiProduk) acuan.push(fotoProduk);
    for (const id of asetAcuan) acuan.push(fs.readFileSync(paths[jangkar.get(id)!]));
    const prompt = promptKeyframe(n, shot, { produk: pakaiProduk, aset: asetAcuan }, opts.catatan?.get(i));
    fs.writeFileSync(paths[i].replace(/\.jpg$/, ".prompt.txt"), prompt);
    const t0 = Date.now();
    fs.writeFileSync(paths[i], await panggilSeedream(prompt, acuan));
    jumlahDibuat++;
    console.log(`[iklan/keyframe] shot ${i + 1}/${n.shots.length} (${shot.beat}, acuan=${acuan.length}) ${Math.round((Date.now() - t0) / 1000)}s`);
  };

  const paralel = opts.paralel ?? 4;
  const jalankan = async (indeks: number[], kerja: (i: number) => Promise<void>) => {
    const antre = [...indeks];
    await Promise.all(Array.from({ length: Math.min(paralel, antre.length) }, async () => {
      for (let i = antre.shift(); i !== undefined; i = antre.shift()) await kerja(i);
    }));
  };
  // Jangkar dulu, BERURUTAN — jangkar aset kedua sering memuat aset pertama
  // (shot 10 Faza: ayah + anak). Sisanya paralel sesudahnya.
  for (const i of [...shotJangkar].sort((a, b) => a - b)) await gambar(i);
  await jalankan(n.shots.map((_, i) => i).filter((i) => !shotJangkar.has(i)), gambar);

  // Gambar SESUDAH, dari gambar sebelumnya.
  const sesudah = new Map<number, string>();
  await jalankan(n.shots.map((s, i) => (s.transformasi_en.trim() ? i : -1)).filter((i) => i >= 0), async (i) => {
    const p = pathSesudah(paths[i]);
    if (!ada(p)) {
      const prompt = promptSesudah(n, n.shots[i], opts.catatanSesudah?.get(i));
      fs.writeFileSync(p.replace(/\.jpg$/, ".prompt.txt"), prompt);
      fs.writeFileSync(p, await panggilSeedream(prompt, [fs.readFileSync(paths[i])]));
      jumlahDibuat++;
      console.log(`[iklan/keyframe] shot ${i + 1} SESUDAH`);
    }
    sesudah.set(i, p);
  });

  return { paths, sesudah, jumlahDibuat, biayaIdr: jumlahDibuat * BIAYA_GAMBAR_IDR };
}
