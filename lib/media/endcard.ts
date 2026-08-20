import fs from "node:fs";
import path from "node:path";
import { runFf, runFfmpeg, runFfprobe } from "./ffmpeg";
import { METADATA_IKUT } from "./metadata-aigc";

// Endcard ber-brand: layar penutup berisi logo + tagline di atas warna brand.
//
// Dari analisis referensi TVC yang Brian kirim (Logitech, Charlotte Tilbury):
// keduanya ditutup layar brand, dan itulah yang membedakan "klip" dari
// "iklan". Ini bagian termurah dengan dampak paling terasa dari daftar itu.
//
// DIJALANKAN SETELAH COMPOSITING, BUKAN DI DALAMNYA. Graf filter di
// lib/media/compositor.ts sudah panjang dan sudah terbukti; menyisipkan
// endcard ke dalamnya berarti mempertaruhkan seluruh jalur render yang
// berjalan hari ini demi satu tambahan. Sebagai langkah terpisah, kegagalan
// endcard paling buruk hanya membuat video keluar tanpa endcard — video
// utamanya tetap utuh.

export interface EndcardInput {
  /** Video hasil compositing. */
  videoPath: string;
  workDir: string;
  /** Logo brand (PNG/JPG lokal). Tidak ada = endcard teks saja. */
  logoPath?: string | null;
  /** Warna latar hex, mis. "#0F0F10". */
  colorHex: string;
  /** Satu baris tagline. Kosong = logo saja. */
  tagline?: string | null;
  durationSec?: number;
}

/** Durasi endcard. Diekspor karena QC perlu tahu berapa detik ekor yang
 *  SENGAJA ditambahkan sesudah konten — tanpa itu QC-05 menilai video lengkap
 *  sebagai kelebihan durasi. */
export const ENDCARD_DURASI_DTK = 2;
const DEFAULT_DURATION = ENDCARD_DURASI_DTK;

/** Hex -> "0xRRGGBB" untuk lavfi color. Nilai tak sah jatuh ke hitam pekat,
 * BUKAN melempar: brand bisa saja menyimpan warna aneh, dan itu tidak layak
 * menggagalkan render yang sudah dibayar. */
function toFfColor(hex: string): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? "");
  return m ? `0x${m[1].toUpperCase()}` : "0x0F0F10";
}

/** Probe dimensi + fps video utama. Endcard HARUS sama persis, kalau tidak
 * concat menolak atau hasilnya meregang. */
async function probeVideo(p: string): Promise<{ w: number; h: number; fps: number }> {
  const { stdout } = await runFfprobe([
    "-v", "error", "-select_streams", "v:0",
    "-show_entries", "stream=width,height,r_frame_rate",
    "-of", "csv=p=0", p,
  ]);
  const [w, h, rate] = stdout.trim().split(",");
  const [num, den] = (rate ?? "30/1").split("/").map(Number);
  return { w: Number(w) || 1080, h: Number(h) || 1920, fps: den ? num / den : 30 };
}

/** Render tagline jadi PNG transparan lewat renderer PIL yang sudah dipakai
 * caption — bukan drawtext, karena ketersediaan font drawtext berbeda-beda
 * antar container dan sudah pernah jadi masalah di sini. */
async function renderTaglinePng(text: string, workDir: string, widthHint: number): Promise<string | null> {
  const out = path.join(workDir, "endcard-tagline.png");
  const specPath = path.join(workDir, "endcard-tagline-spec.json");
  fs.writeFileSync(specPath, JSON.stringify([{
    type: "badge",
    out,
    text: text.slice(0, 60),
    size: Math.max(28, Math.round(widthHint / 22)),
    fill: [255, 255, 255],
    bg: [0, 0, 0, 0], // transparan: warnanya sudah dari latar endcard
    stroke_width: 0,
    radius: 0,
    pad_x: 0,
    pad_y: 8,
  }]));
  try {
    await runFf("python3", [path.join(process.cwd(), "lib", "media", "render_caption.py"), specPath]);
    return fs.existsSync(out) ? out : null;
  } catch {
    // Tagline gagal dirender bukan alasan menggagalkan video. Endcard tetap
    // dibuat dengan logo saja.
    return null;
  }
}

/** Tambahkan endcard di akhir video. Mengembalikan path video BARU, atau path
 * asli kalau endcard tidak bisa dibuat. */
export async function appendEndcard(input: EndcardInput): Promise<string> {
  const { videoPath, workDir } = input;
  const dur = input.durationSec ?? DEFAULT_DURATION;
  const { w, h, fps } = await probeVideo(videoPath);
  const color = toFfColor(input.colorHex);

  const taglinePng = input.tagline?.trim()
    ? await renderTaglinePng(input.tagline.trim(), workDir, w)
    : null;
  const logo = input.logoPath && fs.existsSync(input.logoPath) ? input.logoPath : null;
  if (!logo && !taglinePng) return videoPath; // tidak ada yang bisa ditampilkan

  const endcardPath = path.join(workDir, "endcard.mp4");
  const args: string[] = ["-y",
    "-f", "lavfi", "-t", String(dur), "-i", `color=c=${color}:s=${w}x${h}:r=${fps}`,
    // Audio senyap WAJIB: video utama punya audio, dan concat menolak kalau
    // jumlah stream tiap input tidak sama.
    "-f", "lavfi", "-t", String(dur), "-i", "anullsrc=channel_layout=stereo:sample_rate=44100",
  ];
  if (logo) args.push("-i", logo);
  if (taglinePng) args.push("-i", taglinePng);

  const logoIdx = logo ? 2 : -1;
  const tagIdx = taglinePng ? (logo ? 3 : 2) : -1;
  const filters: string[] = [];
  let cur = "[0:v]";

  if (logo) {
    // Logo dibatasi 45% lebar frame dan proporsinya dijaga — logo yang
    // ditarik gepeng terbaca sebagai kualitas rendah, bukan hemat tempat.
    filters.push(`[${logoIdx}:v]scale=${Math.round(w * 0.45)}:-1:force_original_aspect_ratio=decrease[logo]`);
    filters.push(`${cur}[logo]overlay=(W-w)/2:(H-h)/2-${Math.round(h * 0.04)}[vlogo]`);
    cur = "[vlogo]";
  }
  if (taglinePng) {
    const y = logo ? `(H-h)/2+${Math.round(h * 0.14)}` : "(H-h)/2";
    filters.push(`${cur}[${tagIdx}:v]overlay=(W-w)/2:${y}[vend]`);
    cur = "[vend]";
  }

  args.push("-filter_complex", filters.join(";"), "-map", cur, "-map", "1:a",
    "-c:v", "libx264", "-pix_fmt", "yuv420p", "-r", String(fps),
    "-c:a", "aac", "-ar", "44100", "-ac", "2", "-shortest", endcardPath);

  try {
    await runFfmpeg(args);
  } catch (err) {
    console.warn(`[endcard] gagal membuat endcard: ${(err as Error).message}`);
    return videoPath;
  }

  // Concat lewat FILTER (re-encode), bukan demuxer. Demuxer butuh parameter
  // encoding identik sampai ke timebase; satu ketidakcocokan kecil menghasilkan
  // video rusak yang baru ketahuan saat brand membukanya.
  const merged = path.join(workDir, "output-endcard.mp4");
  try {
    await runFfmpeg(["-y", "-i", videoPath, "-i", endcardPath,
      "-filter_complex",
      `[0:v]scale=${w}:${h},setsar=1[v0];[1:v]scale=${w}:${h},setsar=1[v1];` +
      `[v0][0:a][v1][1:a]concat=n=2:v=1:a=1[v][a]`,
      "-map", "[v]", "-map", "[a]",
      // Penanda AIGC ikut menyeberang — lihat metadata-aigc.ts. Bug ini sudah
      // lama ada di sini, hanya tidak terlihat karena endcard cuma dipasang
      // untuk job Enterprise ber-brand-kit.
      ...METADATA_IKUT,
      "-c:v", "libx264", "-pix_fmt", "yuv420p", "-c:a", "aac", merged]);
    return merged;
  } catch (err) {
    console.warn(`[endcard] gagal menggabung endcard: ${(err as Error).message}`);
    return videoPath;
  }
}

/** Warna bawaan kalau brand belum menyetel apa pun. */
export const ENDCARD_DEFAULT_COLOR = "#0F0F10";
