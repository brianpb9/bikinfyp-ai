/**
 * PERAKITAN IKLAN — timeline, teks kinetik, lockup, musik, mastering.
 *
 * Tiga keputusan yang diambil dari referensi, bukan dari selera:
 *
 * 1. POTONGAN KERAS antar shot, larut singkat hanya ke LOCKUP. Ketiga
 *    referensi memotong keras di tengah film; transisi di setiap potongan
 *    membuat iklan terasa seperti slideshow.
 * 2. TEKS KINETIK muncul per kata dan naik pelan (Blueprint), subtitle VO kecil
 *    di bawah (Eiger), lockup: merek di sepertiga atas, tagline di bawahnya,
 *    kontak di dasar (Blueprint/HDN).
 * 3. PANJANG SHOT MENGIKUTI SUARA. Kalimat VO tidak boleh terpotong oleh shot
 *    berikutnya yang juga bersuara; shot di antaranya diperpanjang, dan bila
 *    tetap kurang, kalimatnya dipercepat sedikit (maks 1,12x).
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { config } from "../config";
import { audioEncoderArgs, loudnormFilter, masterAudioFile } from "../media/audio-master";
import { BATAS, type NaskahIklan } from "./naskah";
import type { KalimatVo } from "./suara";
import { DETIK_KLIP } from "./klip";

const jalankan = promisify(execFile);

export const W = 720;
export const H = 1280;
const FPS = 30;
/** Detik awal klip yang dibuang: frame pertama Grok sering masih diam. */
const BUANG_AWAL = 0.25;
const LARUT_LOCKUP = 0.4;

export interface SlotShot {
  index: number;
  mulai: number;
  durasi: number;
  voMulai?: number;
  voTempo?: number;
}

/** Susun timeline yang menghormati panjang suara. Murni — bisa diuji. */
export function susunTimeline(n: NaskahIklan, kalimat: KalimatVo[]): { slot: SlotShot[]; total: number } {
  const dur = n.shots.map((s) => s.durasi);
  const maksShot = (i: number) => Math.min(
    n.shots[i].beat === "LOCKUP" ? BATAS.lockupMaks : BATAS.shotDetikMaks + 0.5,
    DETIK_KLIP - BUANG_AWAL,
  );
  const voPerShot = new Map(kalimat.map((k) => [k.shot, k]));
  const tempo = new Map<number, number>();
  const JEDA = 0.3;
  const AWAL_VO = (i: number) => (i === 0 ? 0.3 : 0.15);

  const shotBersuara = [...voPerShot.keys()].sort((a, b) => a - b);
  shotBersuara.forEach((i, urutan) => {
    const k = voPerShot.get(i)!;
    const batasAkhir = urutan + 1 < shotBersuara.length ? shotBersuara[urutan + 1] : n.shots.length;
    const akhirPenuh = batasAkhir === n.shots.length;
    const ekor = akhirPenuh ? 0.6 : JEDA;
    const rentang = () => dur.slice(i, batasAkhir).reduce((t, d) => t + d, 0);
    let t = 1;
    const kurang = () => AWAL_VO(i) + k.detik / t + ekor - rentang();
    // Urutan penyelesaian, dari yang paling tidak terasa:
    //   1. percepat kalimat sampai 1,08x (tidak terdengar)
    //   2. perpanjang shot, maksimal +0,8 dtk dari rencana penulis
    //   3. percepat lagi sampai 1,15x
    //   4. baru perpanjang shot sampai batas klip
    // Render uji pertama memperpanjang lebih dulu, dan shot hook 3 detik jadi
    // 5 detik — shot yang paling tidak boleh lambat.
    const percepat = (maks: number) => {
      if (kurang() <= 0.01) return;
      const ruang = rentang() - AWAL_VO(i) - ekor;
      t = Math.min(maks, Math.max(t, k.detik / Math.max(0.5, ruang)));
    };
    const perpanjang = (batas: (j: number) => number) => {
      while (kurang() > 0.01) {
        const bisa = Array.from({ length: batasAkhir - i }, (_, j) => i + j).filter((j) => dur[j] < batas(j) - 0.01);
        if (!bisa.length) break;
        const j = bisa.sort((a, b) => dur[a] - dur[b])[0];
        dur[j] += Math.min(kurang(), batas(j) - dur[j], 0.25);
      }
    };
    percepat(1.08);
    perpanjang((j) => Math.min(maksShot(j), n.shots[j].durasi + 0.8));
    percepat(1.15);
    perpanjang(maksShot);
    if (t > 1.001) tempo.set(i, t);
  });

  const slot: SlotShot[] = [];
  let t = 0;
  n.shots.forEach((_, i) => {
    const s: SlotShot = { index: i, mulai: t, durasi: Number(dur[i].toFixed(3)) };
    if (voPerShot.has(i)) {
      s.voMulai = Number((t + AWAL_VO(i)).toFixed(3));
      s.voTempo = tempo.get(i) ?? 1;
    }
    slot.push(s);
    t += dur[i];
  });
  // Larut ke lockup memakan LARUT_LOCKUP detik dari total.
  return { slot, total: Number((t - LARUT_LOCKUP).toFixed(3)) };
}

/* ── teks: ASS ──────────────────────────────────────────────────────────── */

function waktuAss(detik: number): string {
  const d = Math.max(0, detik);
  const j = Math.floor(d / 3600);
  const m = Math.floor((d % 3600) / 60);
  const s = d % 60;
  return `${j}:${String(m).padStart(2, "0")}:${s.toFixed(2).padStart(5, "0")}`;
}

function escAss(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/\{/g, "(").replace(/\}/g, ")").replace(/\n/g, " ");
}

/** Kata demi kata: tiap kata memudar masuk 110 ms setelah kata sebelumnya. */
function perKata(teks: string, jedaMs = 110, fadeMs = 220): string {
  return teks.split(/\s+/).filter(Boolean).map((w, i) => {
    const a = i * jedaMs;
    return `{\\alpha&HFF&\\t(${a},${a + fadeMs},\\alpha&H00&)}${escAss(w)}`;
  }).join(" ");
}

export function buatAss(n: NaskahIklan, slot: SlotShot[], kalimat: KalimatVo[], total: number, kontak?: string | null): string {
  const kepala = [
    "[Script Info]",
    "ScriptType: v4.00+",
    `PlayResX: ${W}`,
    `PlayResY: ${H}`,
    "WrapStyle: 0",
    "ScaledBorderAndShadow: yes",
    "",
    "[V4+ Styles]",
    "Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding",
    // Teks kinetik: kapital, tebal-sedang, bayangan lembut agar terbaca di atas gambar apa pun.
    "Style: Kinetik,Poppins SemiBold,58,&H00FFFFFF,&H00FFFFFF,&H64000000,&H00000000,0,0,0,0,100,100,2,0,1,0,3,5,60,60,0",
    "Style: Sub,Poppins Medium,30,&H00FFFFFF,&H00FFFFFF,&H78000000,&H00000000,0,0,0,0,100,100,0,0,1,1.2,1.5,2,70,70,70",
    "Style: Merek,Poppins ExtraBold,74,&H00FFFFFF,&H00FFFFFF,&H50000000,&H00000000,0,0,0,0,100,100,3,0,1,0,4,8,60,60,0",
    "Style: Tagline,Poppins Light,40,&H00FFFFFF,&H00FFFFFF,&H50000000,&H00000000,0,0,0,0,100,100,1,0,1,0,3,8,60,60,0",
    "Style: Kontak,Poppins Medium,26,&H00FFFFFF,&H00FFFFFF,&H64000000,&H00000000,0,0,0,0,100,100,1,0,1,0,2,2,60,60,56",
    "",
    "[Events]",
    "Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text",
  ];
  const ev: string[] = [];
  const lockupIdx = n.shots.length - 1;
  const mulaiLockup = slot[lockupIdx].mulai - LARUT_LOCKUP;

  n.shots.forEach((shot, i) => {
    if (i === lockupIdx) return;
    const s = slot[i];
    const teks = shot.teks_layar.trim();
    if (teks) {
      const a = s.mulai + 0.2;
      const b = Math.min(s.mulai + s.durasi - 0.05, mulaiLockup);
      // Naik 24 px selama 450 ms, lalu diam. Posisi di tengah-bawah, di atas subtitle.
      ev.push(`Dialogue: 1,${waktuAss(a)},${waktuAss(b)},Kinetik,,0,0,0,,{\\an5\\move(${W / 2},${Math.round(H * 0.7) + 24},${W / 2},${Math.round(H * 0.7)},0,450)\\fad(0,160)}${perKata(teks.toUpperCase())}`);
    }
  });

  for (const k of kalimat) {
    const s = slot[k.shot];
    if (k.shot === lockupIdx || s.voMulai === undefined) continue;
    const a = s.voMulai;
    const b = Math.min(a + k.detik / (s.voTempo ?? 1) + 0.25, mulaiLockup);
    ev.push(`Dialogue: 0,${waktuAss(a)},${waktuAss(b)},Sub,,0,0,0,,{\\fad(120,120)}${escAss(n.shots[k.shot].vo.trim())}`);
  }

  // LOCKUP: merek, tagline, kontak.
  const aL = slot[lockupIdx].mulai + 0.25;
  const bL = total;
  ev.push(`Dialogue: 2,${waktuAss(aL)},${waktuAss(bL)},Merek,,0,0,0,,{\\an8\\pos(${W / 2},${Math.round(H * 0.12)})\\fad(450,0)}${escAss(n.merek.toUpperCase())}`);
  ev.push(`Dialogue: 2,${waktuAss(aL + 0.45)},${waktuAss(bL)},Tagline,,0,0,0,,{\\an8\\pos(${W / 2},${Math.round(H * 0.12) + 96})\\fad(450,0)}${escAss(n.tagline)}`);
  if (kontak?.trim()) {
    ev.push(`Dialogue: 2,${waktuAss(aL + 0.8)},${waktuAss(bL)},Kontak,,0,0,0,,{\\an2\\fad(400,0)}${escAss(kontak.trim())}`);
  }
  return [...kepala, ...ev, ""].join("\n");
}

/* ── ffmpeg ─────────────────────────────────────────────────────────────── */

async function ffmpeg(args: string[]): Promise<void> {
  try {
    await jalankan(config.ffmpegPath, args, { maxBuffer: 32 * 1024 * 1024, timeout: 15 * 60_000 });
  } catch (err) {
    const e = err as { stderr?: string; message: string };
    throw new Error(`ffmpeg gagal: ${(e.stderr ?? e.message).slice(-1500)}`);
  }
}

export interface MasukanSusun {
  naskah: NaskahIklan;
  klip: string[];
  kalimat: KalimatVo[];
  musik: string;
  dir: string;
  kontak?: string | null;
}

export async function susunIklan(m: MasukanSusun): Promise<{ path: string; total: number; slot: SlotShot[] }> {
  const { slot, total } = susunTimeline(m.naskah, m.kalimat);
  fs.mkdirSync(m.dir, { recursive: true });
  const berkasAss = path.join(m.dir, "teks.ass");
  fs.writeFileSync(berkasAss, buatAss(m.naskah, slot, m.kalimat, total, m.kontak));
  fs.writeFileSync(path.join(m.dir, "timeline.json"), JSON.stringify({ total, slot }, null, 2));

  const args: string[] = ["-y", "-v", "error"];
  for (const k of m.klip) args.push("-i", k);
  const idxVo0 = m.klip.length;
  for (const k of m.kalimat) args.push("-i", k.path);
  const idxMusik = idxVo0 + m.kalimat.length;
  args.push("-stream_loop", "-1", "-i", m.musik);

  const f: string[] = [];
  const nShot = m.klip.length;
  slot.forEach((s, i) => {
    f.push(
      `[${i}:v]trim=start=${BUANG_AWAL}:duration=${s.durasi},setpts=PTS-STARTPTS,fps=${FPS},`
      + `scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,format=yuv420p,settb=AVTB[v${i}]`,
    );
  });
  const kepala = Array.from({ length: nShot - 1 }, (_, i) => `[v${i}]`).join("");
  f.push(`${kepala}concat=n=${nShot - 1}:v=1:a=0,fps=${FPS},settb=AVTB[badan]`);
  const offset = slot[nShot - 1].mulai - LARUT_LOCKUP;
  f.push(`[badan][v${nShot - 1}]xfade=transition=fade:duration=${LARUT_LOCKUP}:offset=${offset.toFixed(3)}[vgab]`);
  const fontsDir = path.join(process.cwd(), "assets", "fonts");
  f.push(`[vgab]ass=filename='${berkasAss.replace(/'/g, "\\'")}':fontsdir='${fontsDir}',fade=t=in:st=0:d=0.25[vout]`);

  // Suara: tiap kalimat ditunda ke posisinya (dan dipercepat bila perlu).
  const labelVo: string[] = [];
  m.kalimat.forEach((k, j) => {
    const s = slot[k.shot];
    const mulai = (s.voMulai ?? s.mulai) - (k.shot === nShot - 1 ? LARUT_LOCKUP : 0);
    const tempo = s.voTempo && s.voTempo > 1.001 ? `atempo=${s.voTempo.toFixed(3)},` : "";
    f.push(`[${idxVo0 + j}:a]aresample=48000,${tempo}adelay=${Math.round(mulai * 1000)}:all=1,apad[vo${j}]`);
    labelVo.push(`[vo${j}]`);
  });
  f.push(`${labelVo.join("")}amix=inputs=${labelVo.length}:duration=longest:normalize=0,atrim=0:${total},asplit=2[suara][picu]`);
  f.push(`[${idxMusik}:a]aresample=48000,atrim=0:${total},volume=0.55,afade=t=in:st=0:d=0.6,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[mus]`);
  f.push(`[mus][picu]sidechaincompress=threshold=0.03:ratio=5:attack=20:release=400:makeup=1[musd]`);
  f.push(`[suara][musd]amix=inputs=2:duration=first:normalize=0,${loudnormFilter(null)}[aout]`);

  const keluar = path.join(m.dir, "iklan.mp4");
  args.push(
    "-filter_complex", f.join(";"),
    "-map", "[vout]", "-map", "[aout]",
    "-t", String(total),
    "-c:v", "libx264", "-preset", "medium", "-crf", "20", "-pix_fmt", "yuv420p", "-r", String(FPS),
    ...audioEncoderArgs(),
    "-movflags", "faststart",
    "-metadata", "comment=AIUGC.ID iklan sinematik (AIGC)",
    "-metadata", "racun_aigc=true",
    keluar,
  );
  await ffmpeg(args);

  const master = keluar.replace(/\.mp4$/, ".master.mp4");
  try {
    await masterAudioFile({ filePath: keluar, outPath: master });
    if (fs.existsSync(master) && fs.statSync(master).size > 0) fs.renameSync(master, keluar);
  } catch (err) {
    console.error("[iklan/susun] mastering audio gagal, dipakai apa adanya:", (err as Error).message);
  }
  return { path: keluar, total, slot };
}
