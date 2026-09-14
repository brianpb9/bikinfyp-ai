/**
 * KLIP GERAK PER SHOT — Grok Imagine lewat kie.ai (mesin kualitas Standard).
 *
 * Keputusan Brian 14 Sep 2026: render uji iklan memakai mesin Standard.
 *
 * Grok menuntut klip minimal 6 detik (lib/media/shot-planner.ts
 * MIN_DETIK_MESIN), sementara shot iklan 2–4 detik. Karena itu setiap shot
 * dirender 6 detik lalu dipotong di perakitan: bagian terbaiknya dipakai,
 * sisanya dibuang. Biaya dihitung dari creditsConsumed yang dilaporkan kie.ai.
 */

import fs from "node:fs";
import path from "node:path";
import { config } from "../config";
import { badanKieVideo } from "../kie-payload";
import { ambilResultUrls } from "../providers/stubs/kie-grok";
import { terbitkanGambarProvider } from "../gambar-provider";
import type { NaskahIklan, ShotIklan } from "./naskah";
import { REALITAS, type KategoriRealitas } from "./realitas";
import { negatifShot } from "./keyframe";

export const DETIK_KLIP = 6;
const MODEL = "grok-imagine/image-to-video";
const IDR_PER_KREDIT = () => Number(process.env.KIE_IDR_PER_CREDIT ?? "0") || 0;

/** Fakta gerak saja (berkendara, memakai, menuang) — prompt video Grok pendek dan fokus pada gerak. */
function faktaGerak(kategori: KategoriRealitas[]): string {
  return kategori.flatMap((k) => REALITAS[k].fakta.filter((f) => /\b(rid|driv|mov|pour|spray|appl|walk|roll|start|forward|wheel|lather|bite|sip|put it on)/i.test(f))).join(" ");
}

export function promptGerak(n: NaskahIklan, shot: ShotIklan, kategori: KategoriRealitas[] = ["umum"]): string {
  const gerak = faktaGerak(kategori);
  return [
    `${shot.gerak_en} Camera: ${shot.kamera}.`,
    `Look: ${n.gaya_visual_en}`,
    shot.produk === "tidak_tampil"
      ? ""
      : "The product stays exactly as in the first frame: same shape, colour and label, never morphing, never duplicating.",
    // Render uji Faza: shot "berangkat di jalan pagi" berakhir di dalam garasi
    // malam — model video mengarang tujuan. Lokasi dan waktu dikunci eksplisit.
    "LOCKED LOCATION: the place, time of day and lighting stay exactly the same for the whole shot; the camera never leaves this scene.",
    "Cinematic commercial motion, smooth and controlled, natural physics, stable faces and hands. Riders keep their helmets on.",
    "No text appearing, no subtitles, no logos appearing, no one speaking to camera, no sudden new objects, no scene cut.",
    gerak ? `REAL-WORLD MOTION: ${gerak}` : "",
    `AVOID: ${negatifShot(shot, kategori).slice(0, 40).join(", ")}.`,
  ].filter(Boolean).join(" ");
}

async function kie(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: { authorization: `Bearer ${config.kieApiKey}`, "content-type": "application/json", ...(init?.headers ?? {}) },
    signal: AbortSignal.timeout(60_000),
  });
  const teks = await res.text();
  let data: Record<string, unknown> = {};
  try { data = JSON.parse(teks); } catch { /* teks mentah di pesan galat */ }
  if (!res.ok) throw new Error(`[iklan/klip] HTTP ${res.status} ${url}: ${teks.slice(0, 300)}`);
  return data;
}

export interface HasilKlip {
  /** Klip per shot; kosong ("") untuk LOCKUP dan shot produk asli, yang dibangun dari gambar diam. */
  paths: string[];
  /** Klip SESUDAH untuk shot BUKTI (indeks shot -> path). */
  sesudah: Map<number, string>;
  kredit: number;
  biayaIdr: number;
}

/**
 * Render semua klip ke `dir/klip-XX.mp4`. Klip yang sudah ada dilewati; task
 * yang sudah dikirim diingat di `klip-XX.task` supaya proses yang terputus
 * MELANJUTKAN task berbayar, bukan mengirim ulang.
 */
export async function buatKlip(
  n: NaskahIklan, keyframes: string[], sesudahKf: Map<number, string>, dir: string, idUji: string,
  kategori: KategoriRealitas[] = ["umum"],
): Promise<HasilKlip> {
  if (!config.kieApiKey) throw new Error("KIE_API_KEY belum diisi.");
  fs.mkdirSync(dir, { recursive: true });
  const nama = (i: number, akhiran = "") => path.join(dir, `klip-${String(i + 1).padStart(2, "0")}${akhiran}.mp4`);
  // LOCKUP dan REVEAL berproduk asli dibangun dari gambar diam + foto produk
  // asli di perakitan — merender klipnya hanya membayar untuk dibuang.
  const paths = n.shots.map((s, i) => (s.beat === "LOCKUP" || s.produk === "asli" ? "" : nama(i)));
  const sesudah = new Map([...sesudahKf.keys()].map((i) => [i, nama(i, "-sesudah")] as const));
  const tugas = [
    ...n.shots.map((shot, i) => ({ shot, i, keluar: paths[i], gambar: keyframes[i], slotGambar: i })).filter((t) => t.keluar),
    ...[...sesudah].map(([i, keluar]) => ({ shot: n.shots[i], i, keluar, gambar: sesudahKf.get(i)!, slotGambar: 100 + i })),
  ];
  let kredit = 0;

  await Promise.all(tugas.map(async ({ shot, i, keluar, gambar, slotGambar }) => {
    if (fs.existsSync(keluar) && fs.statSync(keluar).size > 10_000) return;
    const berkasTask = keluar.replace(/\.mp4$/, ".task");
    let taskId = fs.existsSync(berkasTask) ? fs.readFileSync(berkasTask, "utf8").trim() : "";
    if (!taskId) {
      const imageUrl = await terbitkanGambarProvider(gambar, idUji, slotGambar);
      const prompt = promptGerak(n, shot, kategori);
      fs.writeFileSync(keluar.replace(/\.mp4$/, ".prompt.txt"), prompt);
      const data = await kie(`${config.kieBaseUrl}${config.kiePathCreate}`, {
        method: "POST",
        body: JSON.stringify({
          model: MODEL,
          input: badanKieVideo(MODEL, {
            prompt, imageUrls: [imageUrl], aspectRatio: "9:16", durationSec: DETIK_KLIP,
            resolution: "720p", generateAudio: false,
          }),
        }),
      });
      taskId = String((data.data as Record<string, unknown> | undefined)?.taskId ?? data.taskId ?? "");
      if (!taskId) throw new Error(`[iklan/klip] createTask tanpa taskId: ${JSON.stringify(data).slice(0, 300)}`);
      fs.writeFileSync(berkasTask, taskId);
      console.log(`[iklan/klip] ${path.basename(keluar)}: task ${taskId}`);
    }

    const mulai = Date.now();
    for (;;) {
      if (Date.now() - mulai > 20 * 60_000) throw new Error(`[iklan/klip] shot ${i + 1}: task ${taskId} melewati 20 menit`);
      const data = await kie(`${config.kieBaseUrl}${config.kiePathRecord}?taskId=${encodeURIComponent(taskId)}`);
      const isi = (data.data as Record<string, unknown> | undefined) ?? data;
      const urls = ambilResultUrls(isi);
      if (urls?.length) {
        const k = Number(isi.creditsConsumed ?? 0);
        kredit += k;
        const unduh = await fetch(urls[0], { signal: AbortSignal.timeout(120_000) });
        if (!unduh.ok) throw new Error(`[iklan/klip] unduh HTTP ${unduh.status}`);
        fs.writeFileSync(keluar, Buffer.from(await unduh.arrayBuffer()));
        fs.writeFileSync(keluar.replace(/\.mp4$/, ".kredit"), String(k));
        console.log(`[iklan/klip] ${path.basename(keluar)}: selesai ${Math.round((Date.now() - mulai) / 1000)}s, ${k} kredit`);
        return;
      }
      const status = String(isi.state ?? isi.status ?? "").toLowerCase();
      if (["fail", "failed", "error"].includes(status)) {
        // Task gagal dibuang dari ingatan: percobaan berikutnya mengirim baru.
        fs.rmSync(berkasTask, { force: true });
        throw new Error(`[iklan/klip] shot ${i + 1}: task gagal ${JSON.stringify(isi).slice(0, 300)}`);
      }
      await new Promise((r) => setTimeout(r, 5000));
    }
  }));

  // Kredit dari klip yang dirender di proses sebelumnya ikut dihitung.
  const totalKredit = tugas.map((t) => t.keluar).reduce((t, p) => {
    const f = p.replace(/\.mp4$/, ".kredit");
    return t + (fs.existsSync(f) ? Number(fs.readFileSync(f, "utf8")) || 0 : 0);
  }, 0);
  void kredit;
  return { paths, sesudah, kredit: totalKredit, biayaIdr: Math.round(totalKredit * IDR_PER_KREDIT()) };
}
