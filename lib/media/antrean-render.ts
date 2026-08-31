/**
 * ANTREAN RENDER — pembatas berapa ffmpeg boleh berjalan bersamaan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * MASALAH YANG DITUTUP
 * ────────────────────────────────────────────────────────────────────────────
 * ffmpeg memakai CPU sebanyak yang diberikan. Tanpa pembatas, dua atau tiga
 * job assembly yang kebetulan bertemu akan mengambil seluruh core mesin, dan
 * yang kalah bukan job berikutnya — melainkan REQUEST HTTP yang sedang
 * berjalan. Halaman jadi lambat, health check lewat batas waktu, dan platform
 * terlihat mati padahal ia cuma sedang sibuk merender.
 *
 * Di Render hal ini tersembunyi karena plan starter cuma punya sedikit CPU dan
 * `-threads 1` sudah mengunci ffmpeg ke satu inti. Di server baru (8 core)
 * batas itu hilang: satu job bisa menghabiskan delapan inti sekaligus kalau
 * dibiarkan. Jadi pembatasnya harus eksplisit, bukan diwariskan dari kekecilan
 * mesin lama.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * YANG DIANTRE, DAN YANG SENGAJA TIDAK
 * ────────────────────────────────────────────────────────────────────────────
 * HANYA ffmpeg. ffprobe TIDAK diantre, dan itu keputusan, bukan kelalaian:
 * ffprobe dipanggil di jalur REQUEST (validasi unggahan, pemeriksaan durasi)
 * dan selesai dalam milidetik. Menaruhnya di belakang antrean render berarti
 * satu permintaan API menunggu render tiga menit selesai — persis kerusakan
 * yang antrean ini ada untuk mencegah.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * SIFAT YANG DIJAGA
 * ────────────────────────────────────────────────────────────────────────────
 * 1. FIFO. Yang datang duluan jalan duluan. Tanpa urutan, job panjang bisa
 *    terus kalah oleh job pendek yang datang belakangan dan tidak pernah
 *    selesai.
 * 2. Slot SELALU dikembalikan, termasuk saat ffmpeg gagal atau melempar.
 *    Slot yang bocor sekali saja akan menyusutkan kapasitas selamanya sampai
 *    proses di-restart.
 * 3. Menunggu ada batasnya. Antrean yang tak berbatas mengubah kemacetan jadi
 *    proses menggantung tanpa pesan; batas waktu mengubahnya jadi kegagalan
 *    yang bisa dibaca dan diulang.
 */

import { config } from "../config";

type Penunggu = { lanjut: () => void; batal: (err: Error) => void; sejak: number };

let berjalan = 0;
const antre: Penunggu[] = [];

/** Untuk log dan uji — bukan untuk mengambil keputusan di jalur produksi. */
export function statusAntrean() {
  return { berjalan, menunggu: antre.length, batas: config.ffmpegMaxConcurrent };
}

function lepaskan() {
  berjalan--;
  const berikut = antre.shift();
  if (berikut) {
    berjalan++;
    berikut.lanjut();
  }
}

async function ambilSlot(label: string): Promise<() => void> {
  if (berjalan < config.ffmpegMaxConcurrent) {
    berjalan++;
    return lepaskan;
  }

  const mulaiTunggu = Date.now();
  console.log(
    `[antrean-render] ${label} MENUNGGU — ${berjalan} berjalan, ${antre.length + 1} di antrean ` +
      `(batas ${config.ffmpegMaxConcurrent})`,
  );

  await new Promise<void>((resolve, reject) => {
    const penunggu: Penunggu = { lanjut: () => { clearTimeout(jam); resolve(); }, batal: reject, sejak: mulaiTunggu };
    const jam = setTimeout(() => {
      const i = antre.indexOf(penunggu);
      if (i >= 0) antre.splice(i, 1);
      reject(new Error(
        `[antrean-render] ${label} menyerah setelah menunggu ${Math.round(config.ffmpegQueueTimeoutMs / 1000)} detik. ` +
          `Antrean penuh (${berjalan} berjalan, ${antre.length} menunggu).`,
      ));
    }, config.ffmpegQueueTimeoutMs);
    antre.push(penunggu);
  });

  console.log(`[antrean-render] ${label} JALAN setelah menunggu ${Date.now() - mulaiTunggu} ms`);
  return lepaskan;
}

/**
 * Jalankan pekerjaan berat di dalam satu slot antrean.
 *
 * Slot dikembalikan di `finally`, jadi kegagalan ffmpeg tidak pernah
 * menghilangkan kapasitas.
 */
export async function denganSlotRender<T>(label: string, kerja: () => Promise<T>): Promise<T> {
  const kembalikan = await ambilSlot(label);
  try {
    return await kerja();
  } finally {
    kembalikan();
  }
}

/** HANYA untuk test — mengosongkan keadaan modul antar berkas uji. */
export function resetAntreanUntukUji() {
  berjalan = 0;
  while (antre.length) antre.pop()!.batal(new Error("antrean direset oleh uji"));
}
