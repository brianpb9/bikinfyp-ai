/**
 * Kata yang memicu penyaring konten penyedia video — pada adegan yang SOPAN.
 *
 * Lahir dari penolakan nyata: 18 Agu 2026, adegan koridor dengan talent
 * BERPAKAIAN LENGKAP ditolak Seedance sebagai NSFW. Tidak ada yang salah dengan
 * adegannya; yang salah adalah kosakata promptnya, yang secara statistik
 * berdekatan dengan adegan yang memang dilarang.
 *
 * DUA HAL BERBEDA, dan penting membedakannya:
 *
 *   1. Kosakata bertetangga (handuk, mandi, basah, jubah). Tidak satu pun
 *      terlarang, tapi bersama-sama mereka menggeser tebakan penyaring. Untuk
 *      iklan sabun, kamar mandi memang tempat kejadiannya — jadi ini
 *      PERINGATAN, bukan larangan. Melarangnya akan membuat seluruh kategori
 *      sabun mustahil dirender, pola kesalahan yang sudah dua kali kena di
 *      repo ini (QC-10 memblokir semua produk fashion, TVC tanpa entri
 *      kebijakan).
 *
 *   2. NEGASI YANG MENYEBUT ORANG ("no other residents", "her face is never
 *      sharp", "she never speaks"). Ini bukan cuma soal penyaring — model video
 *      memang buruk menangani negasi, dan menyebut sesuatu adalah cara paling
 *      efektif memunculkannya. "No other residents" berujung pada penghuni
 *      lain di frame. Jadi negasi tentang orang harus DITULIS ULANG jadi
 *      kalimat positif: "the corridor is empty", "the camera stays on her
 *      hands", "she listens quietly".
 *
 * Dipakai di tiga tempat supaya satu aturan tidak perlu ditulis tiga kali:
 * prompt penulis naskah (mencegah di sumber), validator (melaporkan), dan
 * worker (mencatat sebelum mengirim, supaya penolakan berikutnya bisa
 * dikorelasikan dengan promptnya).
 */

export interface TemuanPemicu {
  /** "kosakata" | "negasi-orang" — dua jenis dengan penanganan berbeda. */
  jenis: "kosakata" | "negasi-orang";
  /** Potongan yang memicu, apa adanya, untuk ditunjukkan ke penulisnya. */
  cocok: string;
  /** Saran perbaikan yang bisa langsung dipakai. */
  saran: string;
}

/** Kosakata yang bertetangga dengan adegan terlarang. */
const KOSAKATA: { pola: RegExp; saran: string }[] = [
  { pola: /\b(towel|handuk)\b/i, saran: "sebut kainnya secara netral, mis. 'a folded cloth on the rack'" },
  { pola: /\b(bathrobe|robe|kimono mandi|jubah mandi)\b/i, saran: "sebut pakaiannya apa adanya, mis. 'a long-sleeved house shirt'" },
  { pola: /\b(shower|showering|mandi|berendam|bathtub|bak mandi)\b/i, saran: "pindahkan aksinya ke wastafel: 'at the sink', 'di depan wastafel'" },
  { pola: /\b(wet|damp|basah|lembap)\s+(skin|body|hair|kulit|badan|rambut)\b/i, saran: "sebut hasilnya, bukan keadaan tubuhnya: 'freshly rinsed hands'" },
  { pola: /\b(undress|undressing|changing clothes|ganti baju|buka baju|telanjang)\b/i, saran: "hilangkan; adegan ganti pakaian tidak pernah dibutuhkan iklan produk" },
  { pola: /\b(weapon|gun|knife|baton|pistol|senjata|pentungan|pisau)\b/i, saran: "hilangkan; benda ini tidak punya tempat di iklan konsumen" },
];

/** "bathroom door" + orang kedua — kombinasi, bukan kata tunggal. */
const PINTU_KAMAR_MANDI = /\b(bathroom|kamar mandi)\s+(door|pintu)\b/i;
const ORANG_KEDUA = /\b(another|second|other)\s+(person|woman|man|figure|orang)\b|\b(someone else|orang lain|penghuni lain|dua orang|two people)\b/i;

/**
 * Negasi yang menyebut ORANG.
 *
 * Sengaja hanya negasi yang objeknya manusia atau bagian tubuh. "no text on
 * screen" dan "no watermark" adalah negative prompt yang memang kita butuhkan
 * dan tidak boleh ikut tertangkap.
 */
const KATA_ORANG =
  "person|people|resident|residents|woman|women|man|men|face|faces|figure|figures|silhouette|silhouettes|" +
  "speaker|speakers|presenter|model|models|head|heads|hand|hands|arm|arms|limb|limbs|lip|lips|mouth|body|anatomy|" +
  "orang|penghuni|wajah|wajahnya|kepala|tangan|lengan|bibir|mulut|badan|siluet|dia";
/**
 * Bentuk negasi yang dilewatkan versi pertama, dan semuanya nyata di prompt
 * kami sendiri (reviewer ronde 3, oracle independen): "tak", "gak", dan
 * "no one"/"nobody" yang objeknya bukan kata orang mana pun di daftar atas.
 */
const NEGASI = "no|not|never|without|none|nor|neither|tanpa|tidak|tak|gak|nggak|bukan|jangan";
/** Negasi yang objeknya manusia TANPA menyebut kata orangnya. */
const NEGASI_TANPA_OBJEK = /\b(?:no one|no-one|noone|nobody|not a single (?:person|soul)|tak seorang pun|tidak ada orang)\b/gi;
/**
 * DUA arah, bukan satu.
 *
 * Versi pertama hanya menangkap negasi yang mendahului kata orang ("no other
 * residents"). Ia melewatkan urutan terbalik — "her face is never sharp" —
 * padahal itu persis salah satu kalimat yang disebut dalam penolakan 18 Agu.
 * Bahasa tidak menaruh negasinya selalu di depan.
 */
/**
 * Kata ganti orang HANYA dipakai di arah mundur (subjek dulu, negasi kemudian).
 *
 * Kalau ikut dipakai di arah maju, "no music while she talks" akan tertangkap —
 * padahal "no music" justru negative prompt yang memang kita butuhkan. Di arah
 * mundur ("she never speaks") tidak ada tabrakan itu, karena yang dinegasikan
 * memang perbuatan orangnya.
 */
const KATA_GANTI = "she|her|he|him|they|them|dia|mereka";
const NEGASI_ORANG: RegExp[] = [
  new RegExp(`\\b(?:${NEGASI})\\b(?:\\s+\\w+){0,3}\\s+\\b(?:${KATA_ORANG})\\b`, "gi"),
  new RegExp(`\\b(?:${KATA_ORANG}|${KATA_GANTI})\\b(?:\\s+\\w+){0,3}\\s+\\b(?:${NEGASI})\\b`, "gi"),
];

export interface KonteksPemicu {
  /** Nama produk. Kata pemicu yang MEMANG bagian namanya bukan sinyal. */
  namaProduk?: string | null;
}

/**
 * Periksa satu potongan teks (prompt shot, start_state, atau visual direction).
 *
 * `namaProduk` bukan kelonggaran, melainkan koreksi sinyal (reviewer ronde 3):
 * "Bright Shower Gel" dan "Sabun Mandi Harian" membuat 21 dari 21 shot mereka
 * diblokir — bukan karena adegannya berisiko, tapi karena produknya bernama
 * demikian, dan namanya memang muncul di setiap prompt. Menghukumnya berarti
 * memblokir seluruh kategori sabun, persis pola kesalahan yang sudah dua kali
 * terjadi di repo ini. Negasi tentang orang TIDAK ikut dimaafkan: itu cacat
 * penulisan, bukan nama produk.
 */
export function periksaPemicu(teks: string, konteks: KonteksPemicu = {}): TemuanPemicu[] {
  const temuan: TemuanPemicu[] = [];
  const nama = (konteks.namaProduk ?? "").toLowerCase();
  for (const { pola, saran } of KOSAKATA) {
    const m = teks.match(pola);
    if (m && !(nama && nama.includes(m[0].toLowerCase()))) temuan.push({ jenis: "kosakata", cocok: m[0], saran });
  }
  if (PINTU_KAMAR_MANDI.test(teks) && ORANG_KEDUA.test(teks)) {
    temuan.push({
      jenis: "kosakata",
      cocok: "pintu kamar mandi + orang kedua",
      saran: "pisahkan keduanya: pindahkan pintunya ke ruangan lain, atau sisakan satu orang di frame",
    });
  }
  const sudah = new Set<string>();
  for (const pola of [...NEGASI_ORANG, NEGASI_TANPA_OBJEK]) {
    for (const m of teks.matchAll(pola)) {
      // Dua arah bisa mencocoki potongan yang sama; laporkan sekali saja.
      const kunci = m[0].toLowerCase();
      if (sudah.has(kunci)) continue;
      sudah.add(kunci);
      temuan.push({
        jenis: "negasi-orang",
        cocok: m[0],
        saran: "tulis ulang jadi kalimat positif — sebut apa yang ADA, bukan apa yang tidak ada",
      });
    }
  }
  return temuan;
}

/** Ringkasan satu baris untuk log dan pesan validator. */
export function ringkasPemicu(temuan: TemuanPemicu[]): string {
  return temuan.map((t) => `"${t.cocok}" (${t.saran})`).join("; ");
}
