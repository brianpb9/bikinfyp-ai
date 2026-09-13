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
  // Versi pertama membandingkan ketajaman tepi dengan tengah, dan menuduh dua
  // shot makro Faza yang latarnya gelap-bokeh. Pita yang sungguhan punya tiga
  // ciri yang bokeh tidak punya sekaligus:
  //   1. SIMETRIS — kiri dan kanan (atau atas dan bawah) sama lebar
  //   2. TEPI TEGAS — ketajaman melompat di satu garis lurus
  //   3. SEPANJANG FRAME — lompatannya ada di setiap baris, bukan sebagian
  const LW = 180, LH = 320;
  const lap = await sharp(gambar).greyscale().resize(LW, LH, { fit: "fill" })
    .convolve({ width: 3, height: 3, kernel: [0, 1, 0, 1, -4, 1, 0, 1, 0], offset: 128 })
    .raw().toBuffer();
  const energi = (x: number, y: number) => Math.abs(lap[y * LW + x] - 128);

  /** Profil energi per kolom (atau baris), dan untuk tiap kolom: sebagian baris yang ikut "tajam". */
  const profil = (sumbu: "x" | "y") => {
    const n = sumbu === "x" ? LW : LH;
    const m = sumbu === "x" ? LH : LW;
    return Array.from({ length: n }, (_, a) => {
      let t = 0;
      for (let b = 0; b < m; b++) t += sumbu === "x" ? energi(a, b) : energi(b, a);
      return t / m;
    });
  };
  const rata = (arr: number[], a: number, b: number) => arr.slice(a, b).reduce((t, v) => t + v, 0) / Math.max(1, b - a);

  /**
   * Sebagian garis melintang (baris untuk sumbu x, kolom untuk sumbu y) yang
   * ketajamannya melompat tepat di posisi batas `k` — di kedua sisi.
   * Pita: batasnya lurus sepanjang frame. Bokeh: lembutnya bergelombang.
   */
  const garisLurus = (sumbu: "x" | "y", k: number) => {
    const n = sumbu === "x" ? LW : LH;
    const m = sumbu === "x" ? LH : LW;
    const w = Math.max(3, Math.round(n * 0.03));
    const e = (a: number, b: number) => (sumbu === "x" ? energi(a, b) : energi(b, a));
    const rataPotong = (b: number, a0: number, a1: number) => {
      let t = 0;
      for (let a = a0; a < a1; a++) t += e(a, b);
      return t / Math.max(1, a1 - a0);
    };
    let ikut = 0;
    for (let b = 0; b < m; b++) {
      const kiri = rataPotong(b, k - w, k) * 2 + 1 < rataPotong(b, k, k + w);
      const kanan = rataPotong(b, n - k, n - k + w) * 2 + 1 < rataPotong(b, n - k - w, n - k);
      if (kiri && kanan) ikut++;
    }
    return ikut / m;
  };

  const periksaSumbu = (sumbu: "x" | "y") => {
    const arr = profil(sumbu);
    const n = arr.length;
    const tengah = rata(arr, Math.round(n * 0.3), Math.round(n * 0.7));
    let terbaik = { rasio: 1, pita: false };
    // Coba lebar pita 6%–30% di KEDUA sisi sekaligus.
    for (let k = Math.round(n * 0.06); k <= Math.round(n * 0.3); k++) {
      const luarA = rata(arr, 0, k), luarB = rata(arr, n - k, n);
      const dalamA = rata(arr, k, k + Math.round(n * 0.06)), dalamB = rata(arr, n - k - Math.round(n * 0.06), n - k);
      const rasioLuar = Math.max(luarA, luarB) / Math.max(0.5, tengah);
      const lompat = Math.min(dalamA / Math.max(0.3, luarA), dalamB / Math.max(0.3, luarB));
      if (rasioLuar < 0.3 && lompat > 3 && tengah > 3 && garisLurus(sumbu, k) >= 0.35) {
        return { rasio: Number(rasioLuar.toFixed(3)), pita: true };
      }
      if (rasioLuar < terbaik.rasio) terbaik = { rasio: Number(rasioLuar.toFixed(3)), pita: false };
    }
    return terbaik;
  };
  const lr = periksaSumbu("x");
  const tb = periksaSumbu("y");
  return { pita: lr.pita || tb.pita, rasio: Math.min(lr.rasio, tb.rasio) };
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
