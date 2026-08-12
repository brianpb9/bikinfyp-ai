// MASTERING AUDIO — standar siaran TikTok.
//
// Diukur 2026-08-13 pada video yang benar-benar dirender pipeline ini:
//   loudness    -12,4 LUFS   (standar TikTok -14)
//   sample rate  32.000 Hz   (standar 44.100 / 48.000)
//   musik        tidak ada
// Audio kita selama ini keluar mentah dari model video, apa adanya, dan tidak
// pernah sekali pun diukur. Iklan dinilai lewat telinga sebanyak lewat mata;
// membiarkan ini berarti setiap video kita terdengar lebih keras dan lebih
// kasar daripada video di sebelahnya di feed.
//
// ANGKANYA DARI DOKUMEN PRODUKSI BRIAN (PROMPT-FINAL-3-TVC.md dan
// 00-BACA-DULU.md), bukan dari selera saya:
//   -14 LUFS, true peak -1 dBTP, 44.1 kHz, musik -20 dB dan turun ke -26 dB
//   saat talent bicara, potong keras di akhir (jangan fade).
//
// KENAPA loudnorm DUA LEWATAN. Sekali lewat, ffmpeg menebak dari awal berkas
// dan hasilnya meleset beberapa LU pada materi yang dinamikanya berubah —
// persis kasus kita: satu klip diam, klip berikutnya orang bicara. Dua lewatan
// mengukur dulu seluruh berkas, baru menormalkan dengan angka yang benar.

import { runFfmpeg } from "./ffmpeg";

/** Target siaran. Diekspor supaya tes bisa menegakkan angkanya, bukan
 *  mempercayai komentar. */
export const AUDIO_TARGET = {
  /** Integrated loudness. TikTok menormalkan ke sekitar ini; lebih keras
   *  bukan berarti lebih terdengar, cuma lebih terkompresi oleh platform. */
  lufs: -14,
  /** True peak. -1 dBTP menyisakan ruang untuk encoder lossy platform. */
  truePeak: -1,
  /** Rentang dinamika. Terlalu lebar bikin dialog tenggelam di HP. */
  lra: 7,
  sampleRate: 44100,
  channels: 2,
  bitrate: "192k",
} as const;

export interface LoudnessReading {
  inputI: number;
  inputTp: number;
  inputLra: number;
  inputThresh: number;
  targetOffset: number;
}

/** Lewatan PENGUKURAN. Tidak menulis berkas apa pun — hanya membaca. */
export async function measureLoudness(filePath: string): Promise<LoudnessReading | null> {
  const { stderr } = await runFfmpeg([
    "-hide_banner", "-i", filePath, "-af",
    `loudnorm=I=${AUDIO_TARGET.lufs}:TP=${AUDIO_TARGET.truePeak}:LRA=${AUDIO_TARGET.lra}:print_format=json`,
    "-f", "null", "-",
  ]);
  // loudnorm mencetak JSON-nya ke stderr, di antara log lain. Diambil dengan
  // mencari blok yang MEMUAT input_i — bukan blok JSON pertama, karena log
  // ffmpeg bisa memuat kurung kurawal lain sebelum itu.
  const m = stderr?.match(/\{[^{}]*"input_i"[\s\S]*?\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      inputI: Number(j.input_i), inputTp: Number(j.input_tp),
      inputLra: Number(j.input_lra), inputThresh: Number(j.input_thresh),
      targetOffset: Number(j.target_offset),
    };
  } catch {
    return null;
  }
}

/** Rantai filter audio untuk lewatan KEDUA, memakai hasil pengukuran.
 *
 *  Dipisah dari eksekusinya supaya bisa disisipkan ke filter_complex yang
 *  sudah ada di compositor tanpa menambah satu lewatan encode lagi — encode
 *  ulang video demi audio berarti membuang kualitas gambar tanpa alasan. */
export function loudnormFilter(m: LoudnessReading | null): string {
  const t = AUDIO_TARGET;
  if (!m) {
    // Tanpa pengukuran, pakai lewatan tunggal. Lebih meleset, tapi tetap jauh
    // lebih baik daripada tidak dinormalkan sama sekali.
    return `loudnorm=I=${t.lufs}:TP=${t.truePeak}:LRA=${t.lra}`;
  }
  return (
    `loudnorm=I=${t.lufs}:TP=${t.truePeak}:LRA=${t.lra}` +
    `:measured_I=${m.inputI}:measured_TP=${m.inputTp}` +
    `:measured_LRA=${m.inputLra}:measured_thresh=${m.inputThresh}` +
    `:offset=${m.targetOffset}:linear=true:print_format=summary`
  );
}

/** Argumen encoder audio. Satu tempat, supaya tidak ada berkas keluaran yang
 *  diam-diam memakai sample rate berbeda — 32 kHz yang terukur hari ini masuk
 *  justru karena tiap pemanggil menulis argumennya sendiri. */
export function audioEncoderArgs(): string[] {
  return [
    "-c:a", "aac",
    "-b:a", AUDIO_TARGET.bitrate,
    "-ar", String(AUDIO_TARGET.sampleRate),
    "-ac", String(AUDIO_TARGET.channels),
  ];
}

/** Apakah sebuah berkas sudah memenuhi standar? Dipakai QC dan tes.
 *  Toleransi 1 LU: loudnorm sendiri tidak presisi mutlak, dan menuntut
 *  kesamaan persis akan menghasilkan kegagalan palsu. */
export function memenuhiStandar(m: LoudnessReading | null): { ok: boolean; alasan: string[] } {
  if (!m) return { ok: false, alasan: ["loudness tidak terbaca"] };
  const alasan: string[] = [];
  if (Math.abs(m.inputI - AUDIO_TARGET.lufs) > 1) {
    alasan.push(`loudness ${m.inputI} LUFS, target ${AUDIO_TARGET.lufs}`);
  }
  if (m.inputTp > AUDIO_TARGET.truePeak + 0.5) {
    alasan.push(`true peak ${m.inputTp} dBTP, batas ${AUDIO_TARGET.truePeak}`);
  }
  return { ok: alasan.length === 0, alasan };
}

/** Mastering DUA LEWATAN pada berkas jadi. Video di-copy, hanya audio yang
 *  di-encode ulang — jadi tidak ada kualitas gambar yang hilang dan biayanya
 *  hitungan detik.
 *
 *  KENAPA DI SINI, BUKAN DI DALAM filter_complex COMPOSITOR: audio akhir
 *  adalah campuran beberapa masukan yang baru ada SETELAH dirakit. Mengukurnya
 *  sebelum dirakit mustahil, dan lewatan tunggal terbukti meleset — diukur
 *  2026-08-13: dari -12,4 LUFS, sekali lewat mendarat di -15,5 LUFS, 1,5 LU
 *  di luar toleransi. Dua lewatan mengukur campuran jadinya dulu.
 *
 *  Mengembalikan hasil akhir supaya pemanggil bisa mencatatnya, dan MENOLAK
 *  diam-diam gagal: kalau berkas keluaran tidak terbentuk, berkas asli
 *  dibiarkan utuh dan pemanggil diberi tahu. */
export async function masterAudioFile(input: {
  filePath: string;
  outPath: string;
}): Promise<{ ok: boolean; sebelum: LoudnessReading | null; sesudah: LoudnessReading | null }> {
  const sebelum = await measureLoudness(input.filePath);
  await runFfmpeg([
    "-y", "-i", input.filePath,
    "-af", `aresample=${AUDIO_TARGET.sampleRate},${loudnormFilter(sebelum)}`,
    "-c:v", "copy",
    ...audioEncoderArgs(),
    "-movflags", "faststart+use_metadata_tags",
    "-map_metadata", "0",
    input.outPath,
  ]);
  const sesudah = await measureLoudness(input.outPath);
  return { ok: memenuhiStandar(sesudah).ok, sebelum, sesudah };
}
