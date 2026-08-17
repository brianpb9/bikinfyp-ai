import { ERR } from "./errors";
import { allowRate } from "./rate-limit";

// Rate limit untuk jalur MAHAL di dashboard brand.
//
// lib/rate-limit.ts sudah ada dan sudah benar (Redis, lintas instance, fallback
// memori), tapi selama ini hanya dipasang di dua endpoint publik. Jalur yang
// benar-benar mahal — memanggil LLM, memulai render berbayar, menembak Gemini —
// tidak dibatasi sama sekali. Satu akun yang mengulang-ulang bisa menghabiskan
// kuota provider untuk semua brand.
//
// KUNCINYA ORG, BUKAN USER. Yang membayar dan yang punya kuota adalah
// organisasi; membatasi per-user berarti org dengan lima anggota bisa memakai
// lima kali lipat. Untuk jalur yang membuat akun (undang anggota) kuncinya user,
// karena di situ yang dibatasi memang perbuatan orangnya.
//
// FAIL-OPEN, dan itu disengaja: allowRate mengembalikan true kalau Redis
// bermasalah. Memblokir brand yang membayar karena Redis sedang ngadat jauh
// lebih merugikan daripada meloloskan beberapa permintaan ekstra. Ini peredam
// penyalahgunaan, BUKAN penjaga kuota yang keras — batas keras sesungguhnya
// tetap saldo token, yang dipotong di dalam transaksi berkunci.

export const DASHBOARD_LIMITS = {
  /** Tulis skrip: memanggil mesin skrip berkali-kali per permintaan. */
  generate: { max: 30, windowSec: 300 },
  /** Mulai render: setiap panggilan menahan token dan mengantre job berbayar. */
  confirm: { max: 20, windowSec: 300 },
  /** Ganti scene: tiap panggilan uang nyata ke provider video. */
  regenerate: { max: 30, windowSec: 300 },
  /** Analisa bisnis: mengambil website orang lain + memanggil Gemini. */
  analysis: { max: 10, windowSec: 900 },
  /** Undang anggota: bisa MEMBUAT baris user, jadi dibatasi lebih ketat. */
  invite: { max: 20, windowSec: 3600 },
  /** Simpan template: murah, tapi tetap perlu batas supaya tidak dibanjiri. */
  template: { max: 30, windowSec: 3600 },
  /** Upload foto bisa menjalankan decode penuh dan OCR. */
  photo: { max: 30, windowSec: 300 },
  /** Rencana posting: murni tulis database. */
  publish: { max: 60, windowSec: 300 },
} as const;

export type DashboardBucket = keyof typeof DASHBOARD_LIMITS;

/** Lempar ERR ramah kalau lewat batas. Pesannya menyebut MENUNGGU, bukan
 * menyalahkan — yang kena batas hampir selalu pemakaian wajar yang menumpuk,
 * bukan penyalahgunaan. */
export async function assertDashboardRate(bucket: DashboardBucket, key: string): Promise<void> {
  const { max, windowSec } = DASHBOARD_LIMITS[bucket];
  if (await allowRate(`dash:${bucket}`, key, max, windowSec)) return;
  const menit = Math.round(windowSec / 60);
  throw ERR.BAD_REQUEST(
    `Terlalu banyak permintaan. Tunggu ${menit} menit lagi ya — batasnya ${max} per ${menit} menit.`,
    `Rate limited: ${bucket}`
  );
}
