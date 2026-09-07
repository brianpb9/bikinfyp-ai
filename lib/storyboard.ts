/**
 * STORYBOARD — aturan domain gerbang persetujuan pra-render.
 *
 * ---------------------------------------------------------------------------
 * KEBIJAKAN (keputusan Brian 7 Sep 2026)
 * ---------------------------------------------------------------------------
 * GRATIS TAPI BERKUOTA. Storyboard tidak menahan uang sepeser pun: pengguna
 * membayar saat menekan Generate, bukan sebelum melihat apa pun. Itu satu-
 * satunya cara fitur ini jujur — meminta bayaran untuk melihat pratinjau
 * menghapus alasan pratinjau itu ada.
 *
 * Kuotanya yang menjaga margin: 1x generate awal + MAKS_REGEN_PER_SCENE ganti
 * per scene. Tanpa batas, satu pengguna bisa menghabiskan margin tier termurah
 * hanya dengan menekan "ganti" berulang kali.
 *
 * Angka margin nyata SESUDAH kenaikan +5 poin (lib/config.ts, 7 Sep 2026):
 *     standard  Rp15.000 - Rp6.750  = Rp 8.250
 *     premium   Rp48.000 - Rp23.533 = Rp24.467
 *     ultra     Rp59.000 - Rp23.533 = Rp35.467
 *
 * KENAPA ADA DUA PAGU, BUKAN SATU
 * -------------------------------
 * Jumlah scene TIDAK tetap. Diukur dengan menjalankan planShots (7 Sep 2026):
 *
 *     15 detik hands_only   -> 3 scene
 *     30 detik hands_only   -> 6 scene
 *     15 detik talking_head -> 1 scene   (wajah sengaja tidak dipecah)
 *     45 detik hands_only   -> 5 scene
 *
 * Pagu per-scene saja tidak cukup karena biayanya ikut mengembang bersama
 * jumlah scene: 2x per scene berarti Rp6.300 untuk 3 scene tapi Rp12.600 untuk
 * 6 — dan keduanya kebetulan sama-sama 87% dari margin tier standard. Pagu yang
 * aman untuk video pendek jadi berbahaya untuk video panjang tanpa satu baris
 * pun berubah.
 *
 * MAKS_REGEN_TOTAL memberi batas yang TIDAK tumbuh bersama durasi. Per-scene
 * tetap ada supaya satu kartu tidak menyedot seluruh jatah storyboard.
 */
import type { SegmentDraft } from "./script-engine/templates";
import type { ShotSpec } from "./providers/types";

/** Berapa kali SATU scene boleh diganti. Menjaga satu kartu tidak menghabiskan
 *  seluruh jatah storyboard. */
export const MAKS_REGEN_PER_SCENE = 2;

/** Berapa kali SELURUH storyboard boleh minta gambar ulang. Inilah pagu yang
 *  benar-benar menjaga margin, karena ia tidak tumbuh bersama jumlah scene. */
export const MAKS_REGEN_TOTAL = 4;

export type StatusStoryboard = "PENDING" | "BUILDING" | "READY" | "APPROVED" | "FAILED";

export interface SceneStoryboard {
  idx: number;
  durationSec: number;
  prompt: string;
  dialog: string;
  startState: string | null;
  imageKey: string | null;
  tanpaOrang: boolean;
  withholdProduct: boolean;
  regenCount: number;
}

/**
 * Dialog mana yang jatuh di scene ini.
 *
 * Scene punya rentang waktu; segmen skrip juga. Yang dipakai adalah segmen
 * dengan TUMPANG TINDIH TERBESAR, bukan yang kebetulan mulai lebih dulu —
 * segmen hook sepanjang 1 detik yang menyerempet awal scene tidak boleh
 * mengalahkan segmen demo 4 detik yang mengisi hampir seluruhnya.
 *
 * Scene tanpa tumpang tindih sama sekali (packshot di ekor video) mengembalikan
 * string kosong, bukan segmen terdekat: menempelkan kalimat ke gambar yang
 * tidak mengucapkannya membuat kartu storyboard berbohong.
 */
export function dialogUntukScene(
  segments: SegmentDraft[],
  mulai: number,
  selesai: number
): string {
  let terbaik: { seg: SegmentDraft; tumpang: number } | null = null;
  for (const seg of segments) {
    const tumpang = Math.min(selesai, seg.end) - Math.max(mulai, seg.start);
    if (tumpang <= 0) continue;
    if (!terbaik || tumpang > terbaik.tumpang) terbaik = { seg, tumpang };
  }
  return terbaik ? terbaik.seg.text.trim() : "";
}

/** Ubah rencana shot menjadi scene storyboard. Murni — tidak menyentuh DB,
 *  tidak memanggil provider, jadi bisa diuji apa adanya. */
export function sceneDariShots(shots: ShotSpec[], segments: SegmentDraft[]): SceneStoryboard[] {
  let jam = 0;
  return shots.map((sh) => {
    const mulai = jam;
    const selesai = jam + sh.durationSec;
    jam = selesai;
    return {
      idx: sh.index,
      durationSec: sh.durationSec,
      prompt: sh.prompt,
      // Packshot tidak berbicara. Menanyakan dialognya ke segments hanya akan
      // menempelkan kalimat orang lain ke gambar produk.
      dialog: sh.tanpaOrang ? "" : dialogUntukScene(segments, mulai, selesai),
      startState: sh.startState ?? null,
      imageKey: null,
      tanpaOrang: Boolean(sh.tanpaOrang),
      withholdProduct: Boolean(sh.withholdProduct),
      regenCount: 0,
    };
  });
}

export function bolehRegenerate(
  scene: { regenCount: number },
  semuaScene?: { regenCount: number }[]
): boolean {
  if (scene.regenCount >= MAKS_REGEN_PER_SCENE) return false;
  if (!semuaScene) return true;
  return terpakaiTotal(semuaScene) < MAKS_REGEN_TOTAL;
}

export function terpakaiTotal(scenes: { regenCount: number }[]): number {
  return scenes.reduce((n, s) => n + s.regenCount, 0);
}

export function sisaTotal(scenes: { regenCount: number }[]): number {
  return Math.max(0, MAKS_REGEN_TOTAL - terpakaiTotal(scenes));
}

/** Sisa ganti yang BENAR-BENAR bisa dipakai kartu ini: pagu per-scene dan pagu
 *  total, mana pun yang lebih dulu habis. Menampilkan pagu per-scene saja
 *  membuat UI menjanjikan "bisa 2x lagi" pada kartu yang sebenarnya sudah
 *  terkunci karena jatah storyboard habis. */
export function sisaRegenerate(
  scene: { regenCount: number },
  semuaScene?: { regenCount: number }[]
): number {
  const perScene = Math.max(0, MAKS_REGEN_PER_SCENE - scene.regenCount);
  if (!semuaScene) return perScene;
  return Math.min(perScene, sisaTotal(semuaScene));
}

/** Storyboard siap disetujui hanya bila SETIAP scene punya gambar.
 *  Mengizinkan Generate dengan satu kartu kosong berarti pengguna menyetujui
 *  sesuatu yang belum pernah ia lihat. */
export function siapDisetujui(scenes: { imageKey: string | null }[]): boolean {
  return scenes.length > 0 && scenes.every((s) => Boolean(s.imageKey));
}

/** Estimasi biaya gambar untuk ditampilkan sebagai transparansi internal
 *  (admin), bukan ke pengguna — pengguna tidak membayar storyboard. */
export function biayaGambarStoryboard(jumlahScene: number, biayaPerGambar: number): number {
  return jumlahScene * biayaPerGambar;
}
