// GERBANG PROMPT AKHIR — satu tempat, dipanggil worker tepat sebelum penyedia.
//
// Ada karena audit 19 Agu menemukan tiga hal yang DIKLAIM ditegakkan tapi tidak
// diperiksa siapa pun pada prompt yang benar-benar dikirim:
//   - kunci bahasa 4 lapis + "no English speech" (standar 10/10 baris 9),
//   - kunci ukuran ASLI produk (§C.10 — cacat produk raksasa yang sudah terjadi),
//   - kosakata pemicu, yang dulu hanya DICATAT di prompt akhir walau keras di
//     tingkat skrip. Satu aturan dengan dua kekerasan berbeda adalah aturan
//     yang bisa dilewati dengan mengedit naskah sesudah validasi.
//
// Semua temuan di sini KERAS: prompt yang kehilangan kunci atau memuat pemicu
// tidak dikirim. Menemukan cacat sesudah membayar render tidak ada gunanya.

import { periksaPemicu, ringkasPemicu } from "./pemicu-filter";

export type AturanPromptAkhir = "BAHASA" | "UKURAN" | "L-21-NEGASI" | "L-21-KOSAKATA";

export interface TemuanPromptAkhir {
  aturan: AturanPromptAkhir;
  keras: boolean;
  di: string;
  pesan: string;
}

/** Empat lapis kunci bahasa persis seperti standar 10/10 baris 9. */
const LAPIS_BAHASA: { nama: string; pola: RegExp }[] = [
  { nama: "header 'Every spoken word is Indonesian'", pola: /Every spoken word is Indonesian/i },
  { nama: "penanda per shot bicara '(Bahasa Indonesia)'", pola: /\(Bahasa Indonesia\)/i },
  { nama: "label dialog 'Indonesian dialogue'", pola: /Indonesian dialogue/i },
  { nama: "penutup 'no English speech'", pola: /no English speech/i },
];

/** Kunci ukuran asli produk (§C.10). Dua bagian: skala + jarak kamera. */
const LAPIS_UKURAN: { nama: string; pola: RegExp }[] = [
  { nama: "skala 'true small size'", pola: /true small size/i },
  { nama: "jarak 'normal conversational distance'", pola: /normal conversational distance/i },
];

export function periksaPromptAkhir(input: {
  shots: { index: number; prompt: string }[];
  negativePrompt: string;
  namaProduk: string;
  format: string;
  /** Tier bersuara. Kunci BAHASA hanya relevan bila ada yang diucapkan. */
  withAudio: boolean;
}): TemuanPromptAkhir[] {
  // vo_broll DILEWATI, dan alasannya diverifikasi ulang 19 Agu: format ini
  // tidak memanggil penyedia video sama sekali — visualnya foto milik pengguna
  // yang di-pan/zoom oleh ffmpeg (lihat cabang vo_broll di lib/postgres/worker.ts),
  // sehingga tidak ada penyaring penyedia yang bisa menolaknya dan tidak ada
  // prompt visual yang dikirim ke mana pun. Kunci bahasa untuk VO-nya sendiri
  // ditegakkan di tingkat naskah (L-22 + kamus ucap), bukan di sini.
  if (input.format === "vo_broll") return [];

  const temuan: TemuanPromptAkhir[] = [];

  for (const sh of input.shots) {
    const di = `shot ${sh.index}`;

    if (input.withAudio) {
      // Lapis "label dialog" hanya berlaku pada shot yang PUNYA dialog.
      //
      // Ditemukan dari prompt nyata 20 Agu: shot hook sengaja tanpa kata
      // (standar §E: anomali terbaca tanpa dialog), lalu gerbang ini
      // menjatuhkannya karena tidak menemukan label dialog — menghukum shot
      // justru karena mematuhi aturan lain. Gerbang yang menolak keluaran yang
      // benar akan dimatikan orang, dan itu lebih buruk daripada tidak ada.
      // Penanda eksplisit dari perakit prompt, bukan tebakan dari tanda kutip:
      // nama produk memang ditulis dalam kutip, jadi tebakan lama menganggap
      // setiap shot berdialog.
      const punyaDialog = !/No spoken words in this shot/i.test(sh.prompt);
      const wajib = punyaDialog ? LAPIS_BAHASA : LAPIS_BAHASA.filter((l) => !/label dialog/.test(l.nama));
      const hilang = wajib.filter((l) => !l.pola.test(sh.prompt)).map((l) => l.nama);
      if (hilang.length) {
        temuan.push({
          aturan: "BAHASA",
          keras: true,
          di,
          pesan: `kunci bahasa tidak lengkap — lapis hilang: ${hilang.join("; ")}`,
        });
      }
    }

    const ukuranHilang = LAPIS_UKURAN.filter((l) => !l.pola.test(sh.prompt)).map((l) => l.nama);
    if (ukuranHilang.length) {
      temuan.push({
        aturan: "UKURAN",
        keras: true,
        di,
        pesan: `kunci ukuran asli produk tidak lengkap — hilang: ${ukuranHilang.join("; ")}`,
      });
    }
  }

  // Pemicu penyedia: prompt tiap shot DAN negative prompt.
  const sumber = [
    ...input.shots.map((sh) => ({ di: `shot ${sh.index}`, teks: sh.prompt })),
    { di: "negative prompt", teks: input.negativePrompt },
  ];
  for (const { di, teks } of sumber) {
    for (const t of periksaPemicu(teks, { namaProduk: input.namaProduk })) {
      temuan.push({
        // Kosakata KERAS sejak 19 Agu (perintah Brian). Sebelumnya hanya
        // dicatat di sini walau keras di validator skrip; naskah yang diedit
        // sesudah validasi bisa menyelinapkan kosakata pemicu ke prompt
        // berbayar tanpa satu pun gerbang menahannya.
        aturan: t.jenis === "negasi-orang" ? "L-21-NEGASI" : "L-21-KOSAKATA",
        keras: true,
        di,
        pesan: ringkasPemicu([t]),
      });
    }
  }

  return temuan;
}

/** Ringkasan siap-log untuk pesan error/peringatan. */
export function ringkasTemuanPrompt(temuan: TemuanPromptAkhir[]): string {
  return temuan.map((t) => `${t.aturan} @ ${t.di}: ${t.pesan}`).join(" | ");
}
