/**
 * GERBANG OTOMATIS IKLAN — G1–G7 dari REFERENSI-IKLAN-SINEMATIK-v1.md §5.
 *
 * Yang bisa diukur, diukur. Yang tidak bisa (hook membuat penasaran? terasa
 * mahal?) TIDAK dinilai di sini — itu tugas reviewer yang melihat videonya
 * berdampingan dengan referensi. Gerbang ini hanya menjamin video yang sampai
 * ke reviewer tidak gagal di hal yang bisa dihitung.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
import { config } from "../config";
import { BATAS, periksaNaskah, type NaskahIklan, type ProdukIklan } from "./naskah";
import type { SlotShot } from "./susun";

const jalankan = promisify(execFile);

export interface HasilGerbang {
  id: string;
  lulus: boolean;
  nilai: string;
}

async function stderr(args: string[]): Promise<string> {
  try {
    const r = await jalankan(config.ffmpegPath, args, { maxBuffer: 32 * 1024 * 1024, timeout: 5 * 60_000 });
    return `${r.stdout}\n${r.stderr}`;
  } catch (err) {
    return (err as { stderr?: string }).stderr ?? "";
  }
}

async function volumeRata(berkas: string, mulai: number, detik: number): Promise<number> {
  const out = await stderr(["-v", "info", "-ss", String(mulai), "-t", String(detik), "-i", berkas, "-vn", "-af", "volumedetect", "-f", "null", "-"]);
  const m = out.match(/mean_volume:\s*(-?[\d.]+|-inf) dB/);
  return m ? (m[1] === "-inf" ? -120 : Number(m[1])) : -120;
}

/**
 * Pita blur: tepi kiri-kanan (atau atas-bawah) jauh lebih lembut daripada
 * tengah frame. Diukur dengan simpangan Laplacian dari sharp.
 */
export async function adaPitaBlur(gambar: Buffer): Promise<{ pita: boolean; rasio: number }> {
  const img = sharp(gambar).greyscale();
  const meta = await img.metadata();
  const w = meta.width ?? 0;
  const h = meta.height ?? 0;
  if (!w || !h) return { pita: false, rasio: 1 };
  const tajam = async (left: number, top: number, width: number, height: number) => {
    const buf = await sharp(gambar).greyscale()
      .extract({ left, top, width, height })
      .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0] })
      .raw().toBuffer();
    let jumlah = 0, kuadrat = 0;
    for (const v of buf) { jumlah += v; kuadrat += v * v; }
    const rata = jumlah / buf.length;
    return Math.sqrt(Math.max(0, kuadrat / buf.length - rata * rata));
  };
  const lebarTepi = Math.round(w * 0.08);
  const tinggiTepi = Math.round(h * 0.06);
  const tengah = await tajam(Math.round(w * 0.35), Math.round(h * 0.3), Math.round(w * 0.3), Math.round(h * 0.4));
  const kiri = await tajam(0, Math.round(h * 0.3), lebarTepi, Math.round(h * 0.4));
  const kanan = await tajam(w - lebarTepi, Math.round(h * 0.3), lebarTepi, Math.round(h * 0.4));
  const atas = await tajam(Math.round(w * 0.2), 0, Math.round(w * 0.6), tinggiTepi);
  const bawah = await tajam(Math.round(w * 0.2), h - tinggiTepi, Math.round(w * 0.6), tinggiTepi);
  const pasangan = Math.max(Math.min(kiri, kanan), Math.min(atas, bawah));
  // Kedua sisi SEPASANG sama-sama nyaris rata = pita. Satu sisi lembut saja
  // biasanya latar bokeh, dan itu disengaja.
  const rasioLR = Math.max(kiri, kanan) / Math.max(1, tengah);
  const rasioTB = Math.max(atas, bawah) / Math.max(1, tengah);
  const rasio = Math.min(rasioLR, rasioTB);
  void pasangan;
  return { pita: rasio < 0.08 && tengah > 6, rasio: Number(rasio.toFixed(3)) };
}

export async function periksaIklan(input: {
  video: string;
  naskah: NaskahIklan;
  produk: ProdukIklan;
  slot: SlotShot[];
  total: number;
  dir: string;
}): Promise<HasilGerbang[]> {
  const g: HasilGerbang[] = [];
  const probe = await stderr(["-v", "info", "-i", input.video, "-f", "null", "-t", "0.01", "-"]);
  const dur = probe.match(/Duration:\s*(\d+):(\d+):([\d.]+)/);
  const detik = dur ? Number(dur[1]) * 3600 + Number(dur[2]) * 60 + Number(dur[3]) : 0;
  g.push({ id: "G1 durasi 29–37 dtk", lulus: detik >= 29 && detik <= 37, nilai: `${detik.toFixed(2)} dtk` });

  g.push({ id: "G2 ≥ 9 shot", lulus: input.slot.length >= BATAS.shotMin, nilai: `${input.slot.length} shot` });
  const scene = await stderr(["-v", "info", "-i", input.video, "-filter:v", "select='gt(scene,0.2)',metadata=print", "-an", "-f", "null", "-"]);
  const potongan = (scene.match(/pts_time:/g) ?? []).length;
  g.push({ id: "G2b potongan terdeteksi ≥ 7", lulus: potongan >= 7, nilai: `${potongan} potongan (scene>0.2)` });

  const terpanjang = Math.max(...input.slot.map((s) => s.durasi));
  g.push({ id: "G3 tidak ada shot > 5,5 dtk", lulus: terpanjang <= 5.5, nilai: `terpanjang ${terpanjang.toFixed(2)} dtk` });

  // G4: satu frame di tengah tiap shot.
  const frameDir = path.join(input.dir, "gerbang");
  fs.mkdirSync(frameDir, { recursive: true });
  const pita: string[] = [];
  for (const s of input.slot) {
    const t = Math.min(input.total - 0.1, s.mulai + s.durasi / 2);
    const berkas = path.join(frameDir, `tengah-${String(s.index + 1).padStart(2, "0")}.jpg`);
    await stderr(["-y", "-v", "error", "-ss", t.toFixed(2), "-i", input.video, "-frames:v", "1", "-q:v", "3", berkas]);
    if (!fs.existsSync(berkas)) continue;
    const h = await adaPitaBlur(fs.readFileSync(berkas));
    if (h.pita) pita.push(`shot ${s.index + 1} (rasio ${h.rasio})`);
  }
  g.push({ id: "G4 tanpa pita blur", lulus: pita.length === 0, nilai: pita.length ? pita.join(", ") : "tidak ada" });

  const volSuara = await volumeRata(input.video, 0, input.total);
  // Celah: bagian dari timeline terpanjang tanpa VO (perkiraan dari slot).
  const celah = input.slot.find((s) => s.voMulai === undefined && s.durasi >= 2);
  const volCelah = celah ? await volumeRata(input.video, celah.mulai + 0.5, Math.min(1.5, celah.durasi - 0.7)) : volSuara;
  g.push({ id: "G5 suara + musik terdengar di celah", lulus: volSuara > -30 && volCelah > -45, nilai: `rata ${volSuara} dB, celah ${volCelah} dB` });

  g.push({ id: "G6 lockup 3–5,5 dtk + tagline", lulus: input.slot.at(-1)!.durasi >= 3 && Boolean(input.naskah.tagline.trim()), nilai: `${input.slot.at(-1)!.durasi.toFixed(2)} dtk, "${input.naskah.tagline}"` });

  const naskah = periksaNaskah(input.naskah, input.produk);
  g.push({ id: "G7 aturan naskah (hook, frasa, struktur)", lulus: naskah.length === 0, nilai: naskah.length ? naskah.join(" | ") : "bersih" });
  return g;
}
