/**
 * PERAKITAN IKLAN — timeline, bukti sebelum→sesudah, teks, lockup, musik, mastering.
 *
 * Keputusan yang diambil dari referensi dan dari review independen render uji
 * Faza (creative director + product director, keduanya 4/10):
 *
 * 1. POTONGAN KERAS antar shot; larut singkat hanya ke LOCKUP.
 * 2. BUKTI: satu shot menyapu dari keadaan SEBELUM ke SESUDAH pada bingkai
 *    yang sama. "The key before/after moment is missing" — ini jawabannya.
 * 3. TEKS UNTUK PENONTON TANPA SUARA: frasa kunci besar dua ketebalan di zona
 *    atas (18–32% tinggi, pindah ke atas bila produk sedang tampil), subtitle
 *    VO lebih besar dengan latar, di atas 20% bawah dan menjauhi 15% kanan —
 *    wilayah tombol TikTok/Reels.
 * 4. LOCKUP dari FOTO PRODUK ASLI yang dipotong latarnya, di atas latar lockup
 *    yang digambar kosong: merek, nama produk, tagline, ajakan, kontak.
 * 5. PANJANG SHOT MENGIKUTI SUARA dan DIBATASI STABILITAS KLIP: bagian klip
 *    sesudah adegannya melenceng (shot "berangkat" Faza berakhir di garasi)
 *    tidak pernah dipakai.
 */

import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import sharp from "sharp";
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
export const BUANG_AWAL = 0.25;
const LARUT_LOCKUP = 0.4;
const SAPU_BUKTI = 0.6;

export interface SlotShot {
  index: number;
  mulai: number;
  durasi: number;
  voMulai?: number;
  voTempo?: number;
}

/**
 * Susun timeline yang menghormati panjang suara. Murni — bisa diuji.
 *
 * `maksKlip[i]` = detik klip i yang masih stabil (lihat detikStabil). Tanpa
 * nilai, batasnya panjang klip.
 */
export function susunTimeline(n: NaskahIklan, kalimat: KalimatVo[], maksKlip: (number | undefined)[] = []): { slot: SlotShot[]; total: number } {
  const dur = n.shots.map((s, i) => Math.min(s.durasi, maksKlip[i] ?? Infinity));
  const maksShot = (i: number) => Math.min(
    n.shots[i].beat === "LOCKUP" ? BATAS.lockupMaks + 0.5 : BATAS.shotDetikMaks + 0.5,
    n.shots[i].beat === "LOCKUP" ? Infinity : DETIK_KLIP - BUANG_AWAL,
    maksKlip[i] ?? Infinity,
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

/* ── stabilitas klip ─────────────────────────────────────────────────────── */

/** Jarak rata-rata grid warna 8x14 dari awal klip yang dianggap "adegan lain". Diukur pada 12 klip Faza: gerak kamera biasa ≤ 35, adegan melenceng 86. */
export const AMBANG_MELENCENG = 45;

/** Profil jarak per frame (6 fps) terhadap awal klip — dipisah supaya bisa diuji. */
export function titikMelenceng(jarak: number[], fps = 6): number | null {
  for (let f = 3; f + 1 < jarak.length; f++) {
    if (jarak[f] > AMBANG_MELENCENG && jarak[f + 1] > AMBANG_MELENCENG) return f / fps;
  }
  return null;
}

/** Detik klip (sesudah BUANG_AWAL) yang masih berada di adegan yang sama. */
export async function detikStabil(klip: string): Promise<number> {
  const GW = 8, GH = 14, F = 6;
  const { stdout } = await jalankan(config.ffmpegPath, [
    "-v", "error", "-i", klip, "-vf", `fps=${F},scale=${GW}:${GH}:flags=area`, "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
  ], { encoding: "buffer", maxBuffer: 64 * 1024 * 1024 }) as unknown as { stdout: Buffer };
  const ukuran = GW * GH * 3;
  const jumlah = Math.floor(stdout.length / ukuran);
  if (jumlah < 6) return DETIK_KLIP - BUANG_AWAL;
  const frame = (k: number) => stdout.subarray(k * ukuran, (k + 1) * ukuran);
  const dasar = new Float64Array(ukuran);
  for (let k = 2; k < 5; k++) frame(k).forEach((v, j) => { dasar[j] += v / 3; });
  const jarak = Array.from({ length: jumlah }, (_, k) => {
    let t = 0;
    frame(k).forEach((v, j) => { t += Math.abs(v - dasar[j]); });
    return t / ukuran;
  });
  const titik = titikMelenceng(jarak, F);
  const panjang = jumlah / F;
  return Math.max(0, (titik ?? panjang) - BUANG_AWAL - 0.1);
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

/** Kata demi kata: tiap kata memudar masuk `jedaMs` setelah kata sebelumnya. */
function perKata(teks: string, mulaiMs = 0, jedaMs = 110, fadeMs = 220): string {
  return teks.split(/\s+/).filter(Boolean).map((w, i) => {
    const a = mulaiMs + i * jedaMs;
    return `{\\alpha&HFF&\\t(${a},${a + fadeMs},\\alpha&H00&)}${escAss(w)}`;
  }).join(" ");
}

/** Zona aman bawah: teks tidak boleh lebih rendah dari ini (TikTok/Reels menaruh caption dan tombol di 20% bawah). */
export const BATAS_BAWAH = Math.round(H * 0.78);

export interface MasukanAss {
  naskah: NaskahIklan;
  slot: SlotShot[];
  kalimat: KalimatVo[];
  total: number;
  kontak?: string | null;
}

export function buatAss(m: MasukanAss): string {
  const { naskah: n, slot, kalimat, total } = m;
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
    "Style: Kunci,Poppins ExtraBold,70,&H00FFFFFF,&H00FFFFFF,&H64000000,&H78000000,0,0,0,0,100,100,1,0,1,2.5,3,5,50,50,0",
    "Style: Dukung,Poppins SemiBold,36,&H00FFFFFF,&H00FFFFFF,&H50000000,&H78000000,0,0,0,0,100,100,1,0,1,2,2,5,60,60,0",
    "Style: Sub,Poppins Medium,34,&H00FFFFFF,&H00FFFFFF,&H00000000,&H8C000000,0,0,0,0,100,100,0,0,4,10,0,2,70,140,0",
    "Style: Merek,Poppins ExtraBold,66,&H00FFFFFF,&H00FFFFFF,&H50000000,&H00000000,0,0,0,0,100,100,3,0,1,0,4,8,50,50,0",
    "Style: NamaProduk,Poppins SemiBold,38,&H00FFFFFF,&H00FFFFFF,&H50000000,&H00000000,0,0,0,0,100,100,1,0,1,0,3,8,50,50,0",
    "Style: Tagline,Poppins Medium,36,&H00FFFFFF,&H00FFFFFF,&H50000000,&H78000000,0,0,0,0,100,100,1,0,1,1.5,2,8,50,50,0",
    "Style: Ajakan,Poppins SemiBold,34,&H00111111,&H00111111,&H00FFFFFF,&H00FFFFFF,0,0,0,0,100,100,1,0,3,14,0,5,50,50,0",
    "Style: Kontak,Poppins Medium,26,&H00FFFFFF,&H00FFFFFF,&H64000000,&H00000000,0,0,0,0,100,100,1,0,1,0,2,5,50,50,0",
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
    const [utama = "", dukung = ""] = shot.teks_layar.split("|").map((x) => x.trim());
    if (!utama && !dukung) return;
    // Hook: muncul segera (0,15 dtk). Shot lain: 0,2 dtk sesudah potongan.
    const a = s.mulai + (i === 0 ? 0.15 : 0.2);
    const b = Math.min(s.mulai + s.durasi - 0.05, mulaiLockup);
    // Zona atas bila produk sedang tampil (tidak menutupi label), selain itu sepertiga atas.
    const y = shot.produk === "tidak_tampil" ? Math.round(H * 0.3) : Math.round(H * 0.17);
    if (utama) {
      ev.push(`Dialogue: 2,${waktuAss(a)},${waktuAss(b)},Kunci,,0,0,0,,{\\an5\\blur3\\move(${W / 2},${y + 22},${W / 2},${y},0,420)\\fad(0,140)}${perKata(utama.toUpperCase())}`);
    }
    if (dukung) {
      const jeda = utama ? utama.split(/\s+/).length * 110 + 120 : 0;
      ev.push(`Dialogue: 2,${waktuAss(a)},${waktuAss(b)},Dukung,,0,0,0,,{\\an5\\blur2\\move(${W / 2},${y + 84},${W / 2},${y + 68},${jeda},${jeda + 420})\\fad(0,140)}${perKata(dukung, jeda, 90)}`);
    }
  });

  for (const k of kalimat) {
    const s = slot[k.shot];
    if (k.shot === lockupIdx || s.voMulai === undefined) continue;
    const a = s.voMulai;
    const b = Math.min(a + k.detik / (s.voTempo ?? 1) + 0.25, mulaiLockup);
    // MarginV dihitung dari bawah: garis dasar subtitle tepat di BATAS_BAWAH.
    ev.push(`Dialogue: 1,${waktuAss(a)},${waktuAss(b)},Sub,,0,0,${H - BATAS_BAWAH},,{\\fad(100,100)}${escAss(n.shots[k.shot].vo.trim())}`);
  }

  // LOCKUP — tata letak tetap: merek, nama produk, tagline di atas; produk di
  // tengah (ditempel di rantai video); ajakan dan kontak di atas zona aman bawah.
  const aL = slot[lockupIdx].mulai - LARUT_LOCKUP + 0.35;
  const bL = total;
  ev.push(`Dialogue: 3,${waktuAss(aL)},${waktuAss(bL)},Merek,,0,0,0,,{\\an8\\pos(${W / 2},${Math.round(H * 0.075)})\\fad(400,0)}${escAss(n.merek.toUpperCase())}`);
  ev.push(`Dialogue: 3,${waktuAss(aL + 0.25)},${waktuAss(bL)},NamaProduk,,0,0,0,,{\\an8\\pos(${W / 2},${Math.round(H * 0.075) + 82})\\fad(400,0)}${escAss(n.nama_produk_pendek)}`);
  ev.push(`Dialogue: 3,${waktuAss(aL + 0.5)},${waktuAss(bL)},Tagline,,0,0,0,,{\\an8\\pos(${W / 2},${Math.round(H * 0.075) + 132})\\fad(400,0)}${escAss(n.tagline)}`);
  ev.push(`Dialogue: 3,${waktuAss(aL + 0.9)},${waktuAss(bL)},Ajakan,,0,0,0,,{\\an5\\pos(${W / 2},${BATAS_BAWAH - 70})\\fad(350,0)}${escAss(n.ajakan)}`);
  if (m.kontak?.trim()) {
    ev.push(`Dialogue: 3,${waktuAss(aL + 1.1)},${waktuAss(bL)},Kontak,,0,0,0,,{\\an5\\pos(${W / 2},${BATAS_BAWAH - 10})\\fad(350,0)}${escAss(m.kontak.trim())}`);
  }
  return [...kepala, ...ev, ""].join("\n");
}

/* ── produk untuk lockup ────────────────────────────────────────────────── */

/**
 * PNG produk untuk end card: potongan latar GrabCut bila berhasil, bila tidak
 * kartu foto berujung bulat. Keduanya dari foto ASLI penjual.
 */
export async function siapkanProdukLockup(kandidat: Buffer[], dir: string): Promise<{ path: string; jenis: "potongan" | "kartu"; alasan: string }> {
  fs.mkdirSync(dir, { recursive: true });
  // Kandidat dicoba BERURUTAN — pemanggil menaruh foto asli yang utuh di depan.
  // Render uji Faza v3 memakai potongan "poster" (535x963) yang memangkas kepala
  // semprotnya: di end card botolnya jadi terlihat seperti kaleng.
  for (const [k, foto] of kandidat.entries()) {
    const masuk = path.join(dir, `produk-asli-${k}.png`);
    const keluar = path.join(dir, `produk-potong-${k}.png`);
    await sharp(foto).png().toFile(masuk);
    try {
      const skrip = path.join(process.cwd(), "lib", "iklan", "potong_latar.py");
      const { stdout } = await jalankan("python3", [skrip, masuk, keluar], { timeout: 120_000 });
      const hasil = JSON.parse(stdout.trim().split("\n").pop() ?? "{}") as { ok?: boolean; alasan?: string; cakupan?: number };
      if (hasil.ok && fs.existsSync(keluar)) {
        return { path: await denganBayangan(keluar, path.join(dir, "produk-lockup.png")), jenis: "potongan", alasan: `kandidat ${k}, cakupan ${hasil.cakupan?.toFixed(2)}` };
      }
      console.warn(`[iklan/susun] potong latar kandidat ${k} gagal (${hasil.alasan})`);
    } catch (err) {
      console.warn(`[iklan/susun] potong latar kandidat ${k} galat:`, (err as Error).message.slice(0, 200));
    }
  }
  const foto = kandidat.at(-1)!;
  const kartu = path.join(dir, "produk-kartu.png");
  const lebar = Math.round(W * 0.56);
  const img = await sharp(foto).resize({ width: lebar, height: Math.round(H * 0.46), fit: "inside" }).toBuffer();
  const meta = await sharp(img).metadata();
  const w = meta.width ?? lebar, h = meta.height ?? lebar;
  const topeng = Buffer.from(`<svg width="${w}" height="${h}"><rect x="0" y="0" width="${w}" height="${h}" rx="28" ry="28"/></svg>`);
  await sharp(img).composite([{ input: topeng, blend: "dest-in" }]).png().toFile(kartu);
  return { path: kartu, jenis: "kartu", alasan: "potong latar tidak tersedia" };
}

/**
 * Produk + bayangan lembut dalam SATU PNG.
 *
 * Versi pertama membuat bayangan di ffmpeg (colorchannelmixer + gblur pada
 * RGBA) dan meninggalkan kotak samar seukuran PNG di sekitar botol pada render
 * uji Faza v3. Di sharp, bayangan dibentuk dari alpha produk sendiri, jadi
 * tidak ada piksel di luar bentuknya yang bisa ikut terlihat.
 */
async function denganBayangan(potongan: string, keluar: string): Promise<string> {
  const meta = await sharp(potongan).metadata();
  const w = meta.width ?? 0, h = meta.height ?? 0;
  const pad = Math.round(Math.max(w, h) * 0.12);
  const alpha = await sharp(potongan).extractChannel("alpha").toBuffer();
  const bayangBentuk = await sharp({ create: { width: w, height: h, channels: 3, background: "#000" } })
    .joinChannel(await sharp(alpha).linear(0.45, 0).toBuffer())
    .png().toBuffer();
  const elips = Buffer.from(
    `<svg width="${w + pad * 2}" height="${h + pad * 2}"><ellipse cx="${(w + pad * 2) / 2}" cy="${pad + h - h * 0.01}" rx="${w * 0.52}" ry="${Math.max(8, h * 0.035)}" fill="#000" fill-opacity="0.55"/></svg>`,
  );
  await sharp({ create: { width: w + pad * 2, height: h + pad * 2, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: await sharp(elips).blur(Math.max(4, h * 0.012)).png().toBuffer(), left: 0, top: 0 },
      { input: await sharp(bayangBentuk).blur(Math.max(6, h * 0.02)).png().toBuffer(), left: pad + Math.round(w * 0.03), top: pad + Math.round(h * 0.015) },
      { input: potongan, left: pad, top: pad },
    ])
    .png().toFile(keluar);
  return keluar;
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
  /** Klip per shot ("" untuk LOCKUP). */
  klip: string[];
  /** Klip SESUDAH shot BUKTI. */
  klipSesudah: Map<number, string>;
  /** Gambar kunci per shot — LOCKUP memakai miliknya sebagai latar. */
  keyframes: string[];
  /** Foto produk untuk end card, urut prioritas (foto asli utuh lebih dulu). */
  fotoProduk: Buffer[];
  kalimat: KalimatVo[];
  musik: string;
  dir: string;
  kontak?: string | null;
}

export async function susunIklan(m: MasukanSusun): Promise<{ path: string; total: number; slot: SlotShot[]; produkLockup: string }> {
  fs.mkdirSync(m.dir, { recursive: true });
  const n = m.naskah;
  const lockupIdx = n.shots.length - 1;

  // Batas stabil per shot (BUKTI: yang terpendek dari kedua klipnya).
  const maksKlip: (number | undefined)[] = [];
  const catatanStabil: Record<string, number> = {};
  for (const [i, k] of m.klip.entries()) {
    if (!k) continue;
    let s = await detikStabil(k);
    const kSesudah = m.klipSesudah.get(i);
    if (kSesudah) s = Math.min(s, await detikStabil(kSesudah));
    catatanStabil[path.basename(k)] = Number(s.toFixed(2));
    if (s < DETIK_KLIP - BUANG_AWAL - 0.2) maksKlip[i] = Math.max(BATAS.shotDetikMin, s);
  }

  const { slot, total } = susunTimeline(n, m.kalimat, maksKlip);
  const berkasAss = path.join(m.dir, "teks.ass");
  fs.writeFileSync(berkasAss, buatAss({ naskah: n, slot, kalimat: m.kalimat, total, kontak: m.kontak }));
  const produk = await siapkanProdukLockup(m.fotoProduk, path.join(m.dir, "lockup"));
  fs.writeFileSync(path.join(m.dir, "timeline.json"), JSON.stringify({ total, slot, stabil: catatanStabil, produkLockup: produk }, null, 2));

  const args: string[] = ["-y", "-v", "error"];
  const masukan: string[] = [];
  const tambah = (...a: string[]) => { args.push(...a); return masukan.push(a.at(-1)!) - 1; };
  const idxKlip = m.klip.map((k) => (k ? tambah("-i", k) : -1));
  const idxSesudah = new Map([...m.klipSesudah].map(([i, k]) => [i, tambah("-i", k)] as const));
  const idxLatar = tambah("-loop", "1", "-framerate", String(FPS), "-t", String(slot[lockupIdx].durasi + 0.5), "-i", m.keyframes[lockupIdx]);
  const idxProduk = tambah("-loop", "1", "-framerate", String(FPS), "-t", String(slot[lockupIdx].durasi + 0.5), "-i", produk.path);
  // Gradasi gelap atas (merek, nama, tagline) dan bawah (ajakan): teks lockup
  // tipis di atas latar ramai tidak terbaca pada render uji Faza v3.
  const berkasScrim = path.join(m.dir, "lockup", "scrim.png");
  await sharp(Buffer.from(
    `<svg width="${W}" height="${H}"><defs>`
    + `<linearGradient id="a" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0.62"/><stop offset="0.3" stop-color="#000" stop-opacity="0.25"/><stop offset="0.42" stop-color="#000" stop-opacity="0"/>`
    + `<stop offset="0.66" stop-color="#000" stop-opacity="0"/><stop offset="0.86" stop-color="#000" stop-opacity="0.45"/><stop offset="1" stop-color="#000" stop-opacity="0.55"/></linearGradient>`
    + `</defs><rect width="${W}" height="${H}" fill="url(#a)"/></svg>`,
  )).png().toFile(berkasScrim);
  const idxScrim = tambah("-loop", "1", "-framerate", String(FPS), "-t", String(slot[lockupIdx].durasi + 0.5), "-i", berkasScrim);
  const idxVo0 = masukan.length;
  for (const k of m.kalimat) tambah("-i", k.path);
  const idxMusik = tambah("-stream_loop", "-1", "-i", m.musik);

  const normal = `fps=${FPS},scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H},setsar=1,format=yuv420p`;
  const f: string[] = [];
  slot.forEach((s, i) => {
    if (i === lockupIdx) return;
    const potong = `trim=start=${BUANG_AWAL}:duration=${s.durasi},setpts=PTS-STARTPTS,${normal},settb=AVTB`;
    const iSesudah = idxSesudah.get(i);
    if (iSesudah === undefined) {
      f.push(`[${idxKlip[i]}:v]${potong}[v${i}]`);
      return;
    }
    // Sebelum → sesudah: tahan keadaan sebelum ±45%, sapu ke kanan, tahan sesudah.
    const offset = Math.max(0.6, s.durasi * 0.45);
    f.push(`[${idxKlip[i]}:v]trim=start=${BUANG_AWAL}:duration=${s.durasi},setpts=PTS-STARTPTS,${normal},settb=AVTB[bs${i}]`);
    f.push(`[${iSesudah}:v]trim=start=${BUANG_AWAL}:duration=${s.durasi},setpts=PTS-STARTPTS,${normal},settb=AVTB[bd${i}]`);
    f.push(`[bs${i}][bd${i}]xfade=transition=wiperight:duration=${SAPU_BUKTI}:offset=${offset.toFixed(3)},trim=duration=${s.durasi},setpts=PTS-STARTPTS,settb=AVTB[v${i}]`);
  });

  // LOCKUP: latar diam dengan push-in 1,00 -> 1,05, sedikit diredupkan dan dilembutkan
  // supaya produk asli di depannya menjadi pusat.
  const dL = slot[lockupIdx].durasi;
  const bingkai = Math.round(dL * FPS);
  f.push(
    `[${idxLatar}:v]scale=${W * 2}:${H * 2}:force_original_aspect_ratio=increase,crop=${W * 2}:${H * 2},`
    + `zoompan=z='1+0.05*on/${bingkai}':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=1:s=${W}x${H}:fps=${FPS},`
    + `gblur=sigma=3,eq=brightness=-0.06:saturation=0.95,trim=duration=${dL},setpts=PTS-STARTPTS,format=yuv420p,setsar=1[latar]`,
  );
  // Produk: dasar botol berhenti di 68% tinggi, tepat di atas kotak ajakan
  // (±70–76%); puncaknya di bawah blok merek (berakhir ±21%). PNG sudah memuat
  // bayangan dan bantalan 12% di tiap sisi, jadi tingginya dihitung dengan itu.
  // Tinggi PNG termasuk bantalan: produk sendiri ±0,54/1,24 ≈ 44% tinggi layar.
  const tinggiProduk = Math.round(H * (produk.jenis === "potongan" ? 0.54 : 0.38));
  const dasarY = Math.round(H * 0.68);
  const bantalanBawah = produk.jenis === "potongan" ? Math.round(tinggiProduk * 0.12 / 1.24) : 0;
  f.push(`[${idxProduk}:v]format=rgba,scale=-2:${tinggiProduk}:flags=lanczos,trim=duration=${dL},setpts=PTS-STARTPTS,fade=t=in:st=0.15:d=0.5:alpha=1[prodf]`);
  f.push(`[${idxScrim}:v]format=rgba,trim=duration=${dL},setpts=PTS-STARTPTS[scrim]`);
  f.push(`[latar][scrim]overlay=0:0:format=auto[lat1]`);
  f.push(`[lat1][prodf]overlay=x=(W-w)/2:y=${dasarY + bantalanBawah}-h:format=auto,format=yuv420p,settb=AVTB[v${lockupIdx}]`);

  const kepala = Array.from({ length: lockupIdx }, (_, i) => `[v${i}]`).join("");
  f.push(`${kepala}concat=n=${lockupIdx}:v=1:a=0,fps=${FPS},settb=AVTB[badan]`);
  const offset = slot[lockupIdx].mulai - LARUT_LOCKUP;
  f.push(`[badan][v${lockupIdx}]xfade=transition=fade:duration=${LARUT_LOCKUP}:offset=${offset.toFixed(3)}[vgab]`);
  const fontsDir = path.join(process.cwd(), "assets", "fonts");
  f.push(`[vgab]ass=filename='${berkasAss.replace(/'/g, "\\'")}':fontsdir='${fontsDir}',fade=t=in:st=0:d=0.2[vout]`);

  // Suara: tiap kalimat ditunda ke posisinya (dan dipercepat bila perlu).
  const labelVo: string[] = [];
  m.kalimat.forEach((k, j) => {
    const s = slot[k.shot];
    const mulai = (s.voMulai ?? s.mulai) - (k.shot === lockupIdx ? LARUT_LOCKUP : 0);
    const tempo = s.voTempo && s.voTempo > 1.001 ? `atempo=${s.voTempo.toFixed(3)},` : "";
    f.push(`[${idxVo0 + j}:a]aresample=48000,${tempo}adelay=${Math.round(mulai * 1000)}:all=1,apad[vo${j}]`);
    labelVo.push(`[vo${j}]`);
  });
  f.push(`${labelVo.join("")}amix=inputs=${labelVo.length}:duration=longest:normalize=0,atrim=0:${total},asplit=2[suara][picu]`);
  f.push(`[${idxMusik}:a]aresample=48000,atrim=0:${total},volume=0.55,afade=t=in:st=0:d=0.5,afade=t=out:st=${(total - 1.2).toFixed(2)}:d=1.2[mus]`);
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
  return { path: keluar, total, slot, produkLockup: produk.path };
}
