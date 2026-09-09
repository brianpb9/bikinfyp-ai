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

/**
 * Berapa banyak scene yang DIGAMBAR. Sisanya tetap jadi kartu, tapi kartunya
 * berisi teks saja.
 *
 * ---------------------------------------------------------------------------
 * KENAPA DIBAKUKAN (Brian 9 Sep 2026)
 * ---------------------------------------------------------------------------
 * "Apakah ini tidak menjadi boros? Kalau boros apakah anda bisa buat
 *  standardkan seluruh proses berapapun inputnya tetap storyboardnya sama."
 *
 * Ia benar soal borosnya, walau sebabnya bukan jumlah foto — itu sudah diukur
 * dan tidak berpengaruh. Yang membuatnya berbeda-beda adalah DURASI dan FORMAT:
 *
 *   15 dtk talking_head -> 1 scene   (wajah tidak boleh dipecah)
 *   15 dtk hands_only   -> 3 scene
 *   30 dtk hands_only   -> 6 scene
 *
 * Jadi biaya storyboard berayun 1x sampai 6x tanpa pengguna pernah memilihnya,
 * dan video 30 detik membayar enam gambar untuk satu kali tinjau.
 *
 * ---------------------------------------------------------------------------
 * KENAPA 3, DAN KENAPA BUKAN "SELALU 3 KARTU"
 * ---------------------------------------------------------------------------
 * Kartunya TETAP satu per scene — gerbang persetujuan harus mencakup seluruh
 * video, dan menyembunyikan tiga scene terakhir berarti pengguna menyetujui
 * sesuatu yang tidak pernah ia lihat.
 *
 * Yang dibakukan adalah jumlah yang DIGAMBAR. Tiga karena itu jumlah minimum
 * yang masih memperlihatkan busur cerita — pembuka, tengah, penutup. Scene yang
 * tidak digambar tetap menampilkan dialog dan arahan kameranya, dan frame
 * pertamanya kembali ke jalur lama saat render.
 */
export const MAKS_GAMBAR_STORYBOARD = 3;

/**
 * Scene mana yang digambar: SEBARAN, bukan tiga pertama.
 *
 * Tiga pertama dari enam scene memperlihatkan pembuka dan tengah saja —
 * penutupnya, tempat CTA dan packshot hidup, tidak pernah terlihat. Padahal
 * justru di situ kesalahan paling mahal: produk salah di detik terakhir adalah
 * yang paling diingat penonton.
 *
 * Scene pertama SELALU ikut (ia frame pembuka video), sisanya diambil merata.
 */
export function sceneUntukDigambar(jumlahScene: number, maks = MAKS_GAMBAR_STORYBOARD): number[] {
  if (jumlahScene <= maks) return Array.from({ length: jumlahScene }, (_, i) => i);
  if (maks <= 1) return [0];
  const pilih = new Set<number>([0, jumlahScene - 1]);
  // Sisa jatah disebar di antara keduanya.
  const sisa = maks - pilih.size;
  for (let k = 1; k <= sisa; k++) {
    pilih.add(Math.round((k * (jumlahScene - 1)) / (sisa + 1)));
  }
  return [...pilih].sort((a, b) => a - b).slice(0, maks);
}

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

/**
 * Storyboard siap disetujui bila setiap scene YANG DIJATAH GAMBAR sudah punya
 * gambarnya.
 *
 * Bukan "setiap scene": sejak jumlah gambar dibakukan (MAKS_GAMBAR_STORYBOARD),
 * storyboard 6 scene memang cuma menggambar 3. Menuntut semuanya membuat video
 * 30 detik tidak pernah keluar dari BUILDING — fitur yang macet total, dan
 * macetnya di gerbang yang menahan uang.
 *
 * Scene yang tidak dijatah tetap jadi kartu berisi dialog dan arahan kamera,
 * jadi pengguna tetap menyetujui SELURUH video — ia hanya tidak melihat
 * pratinjau tergambar untuk setiap detiknya.
 */
export function siapDisetujui(scenes: { imageKey: string | null }[]): boolean {
  if (scenes.length === 0) return false;
  const dijatah = new Set(sceneUntukDigambar(scenes.length));
  return scenes.every((s, i) => !dijatah.has(i) || Boolean(s.imageKey));
}

/** Estimasi biaya gambar untuk ditampilkan sebagai transparansi internal
 *  (admin), bukan ke pengguna — pengguna tidak membayar storyboard. */
export function biayaGambarStoryboard(jumlahScene: number, biayaPerGambar: number): number {
  return jumlahScene * biayaPerGambar;
}
