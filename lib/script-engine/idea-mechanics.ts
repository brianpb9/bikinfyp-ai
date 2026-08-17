/**
 * Bank mekanik ide (PATCH 4 §4).
 *
 * KENAPA ADA. Semua gerbang kita sebelumnya bersifat NEGATIF — jangan
 * overclaim, jangan salah ucap, jangan sebut merek lain. Tidak satu pun
 * menjawab "kenapa orang berhenti scroll?". Hasilnya iklan sopan yang
 * dilupakan dalam tiga detik.
 *
 * Video yang menang di playbook bagus bukan karena kalimatnya rapi, tapi
 * karena masing-masing punya SATU IDE: kipas di ladang lava, kamera dari dalam
 * kardus, alat studio yang lenyap satu per satu. Produk cuma menumpang pada
 * ide itu.
 *
 * Jadi setiap ide WAJIB memilih TEPAT SATU mekanik utama dari daftar ini.
 * "Tepat satu" bukan formalitas: ide yang memakai dua mekanik sekaligus
 * hampir selalu berarti idenya belum ketemu, dan hasilnya kembali datar.
 *
 * Ditulis sebagai modul TypeScript, bukan JSON seperti bunyi spesifikasi.
 * Alasannya: daftar ini dibaca kode (anti-repeat, larangan kategori jenuh,
 * validasi keluaran LLM) sehingga tipenya berguna, dan memuatnya dari berkas
 * saat runtime menambah satu jalur gagal tanpa menambah kemampuan apa pun.
 */

export type IdMekanik =
  | "contrast"
  | "anomaly_pov"
  | "forbidden"
  | "stakes"
  | "transformation"
  | "honest_reaction"
  | "secret"
  | "social_theft"
  | "time_compression"
  | "absence"
  | "scale"
  | "confession";

export interface Mekanik {
  id: IdMekanik;
  /** Namanya dalam satu frasa — dipakai di prompt dan di UI. */
  mekanik: string;
  /** Contoh SATU KALIMAT. Kalau tidak bisa satu kalimat, itu bukan ide. */
  contoh: string;
  /** Kapan mekanik ini cocok. */
  cocok: string;
}

export const MEKANIK_IDE: Mekanik[] = [
  { id: "contrast", mekanik: "benda paling lemah di tempat paling ekstrem",
    contoh: "kipas genggam di ladang lava", cocok: "produk kecil/fungsional (level berani ke atas)" },
  { id: "anomaly_pov", mekanik: "sudut kamera yang tidak mungkin atau aneh",
    contoh: "unboxing dari DALAM kardus", cocok: "unboxing, apa saja" },
  { id: "forbidden", mekanik: "larangan yang bikin penasaran",
    contoh: "sabun yang nggak boleh dipakai sebelum jam enam pagi", cocok: "keluarga, komoditas" },
  { id: "stakes", mekanik: "taruhan atau tes yang bisa gagal di depan kamera",
    contoh: "case HP dilempar dari lantai dua", cocok: "ketahanan" },
  { id: "transformation", mekanik: "perubahan terlihat dalam satu take",
    contoh: "dapur super kotor jadi bersih", cocok: "pembersih, before/after" },
  { id: "honest_reaction", mekanik: "reaksi yang tidak bisa dipalsukan sebagai satu-satunya bukti",
    contoh: "mencium parfum, mata merem sendiri", cocok: "aroma, rasa, tekstur" },
  { id: "secret", mekanik: "trik atau fungsi tersembunyi yang ditunda",
    contoh: "yang jarang orang tahu dari benda ini", cocok: "fungsi tersembunyi" },
  { id: "social_theft", mekanik: "produk yang direbutin orang lain",
    contoh: "ibu ngumpetin sabun dari anak-anak", cocok: "rumah tangga, makanan minuman" },
  { id: "time_compression", mekanik: "waktu dipadatkan dengan framing terkunci",
    contoh: "empat belas hari dalam lima belas detik", cocok: "skincare, hasil pelan" },
  { id: "absence", mekanik: "menunjukkan hilangnya masalah, bukan hadirnya produk",
    contoh: "alat studio lenyap satu per satu", cocok: "jasa, SaaS, hasil abstrak" },
  { id: "scale", mekanik: "produk seukuran gedung, atau mini",
    contoh: "serum sebesar tugu", cocok: "produk kecil (level berani ke atas)" },
  { id: "confession", mekanik: "pengakuan yang bikin percaya",
    contoh: "aku males banget skincare, tapi", cocok: "testimoni" },
];

export const MEKANIK_BY_ID = Object.fromEntries(MEKANIK_IDE.map((m) => [m.id, m])) as Record<IdMekanik, Mekanik>;

/**
 * Kategori JENUH — di sini pain-hook polos (keluhan sehari-hari tanpa twist)
 * DILARANG sebagai satu-satunya mekanik.
 *
 * Bukan selera: di kategori ini feed-nya sudah penuh video yang persis sama,
 * jadi keluhan biasa tidak lagi menghentikan siapa pun. Yang dilarang adalah
 * memakainya SENDIRIAN; keluhan tetap boleh jadi bahan di dalam mekanik lain.
 */
export const KATEGORI_JENUH = new Set(["beauty", "skincare", "food", "beverage", "home", "kitchen"]);

/** Hari sebuah mekanik dianggap "baru dipakai" untuk merek yang sama. */
export const HARI_ANTI_ULANG = 30;

/**
 * Urutkan mekanik: yang belum dipakai merek ini dalam 30 hari lebih dulu.
 *
 * DITURUNKAN, bukan dibuang. Kalau semua mekanik kebetulan baru dipakai,
 * membuangnya berarti tidak ada ide sama sekali — dan tidak punya ide jauh
 * lebih buruk daripada mengulang mekanik yang bagus.
 */
export function urutkanMekanik(baruDipakai: IdMekanik[]): Mekanik[] {
  const baru = new Set(baruDipakai);
  return [...MEKANIK_IDE].sort((a, b) => Number(baru.has(a.id)) - Number(baru.has(b.id)));
}

/**
 * Apakah one-liner ini GENERIK — yaitu bisa dipakai produk lain tanpa diubah?
 *
 * Aturan dari spesifikasi: kandidat generik dibuang. Diukur dengan satu
 * pertanyaan yang bisa dijawab kode: apakah kalimatnya menyebut sesuatu yang
 * khas produk/kategorinya (nama produk, kata bendanya, atau kata benda konkret
 * lain), atau ia cuma rangkaian kata sifat pemasaran?
 *
 * Sengaja LONGGAR. Penyaring ini menangkap yang jelas-jelas kosong ("produk
 * ini bikin hidup lebih mudah"); penilaian halusnya ada di FYP Gate, yang
 * memang memakai model. Penyaring kode yang terlalu ketat akan membuang ide
 * bagus yang kebetulan tidak menyebut nama produknya — padahal hook justru
 * dilarang menyebut nama produk.
 */
const KATA_KOSONG = new Set([
  "produk", "barang", "item", "solusi", "kualitas", "terbaik", "bagus", "mantap",
  "hidup", "mudah", "praktis", "wajib", "punya", "banget", "ini", "itu", "yang",
  "bikin", "buat", "dengan", "untuk", "dan", "atau", "dari", "kamu", "aku", "gue", "lo",
  "lebih", "juga", "bisa", "ada", "nggak", "gak", "tidak", "sih", "deh", "aja", "saja",
]);

export function ideGenerik(oneLiner: string, konteks: { productName: string; kategoriNoun: string }): boolean {
  const kata = oneLiner.toLowerCase().replace(/[^a-z0-9\s]/g, " ").split(/\s+/).filter(Boolean);
  if (kata.length < 4) return true; // terlalu pendek untuk jadi ide
  const namaTokens = konteks.productName.toLowerCase().split(/\s+/).filter((t) => t.length >= 4);
  const menyebutProduk =
    namaTokens.some((t) => kata.some((k) => k.includes(t.slice(0, 4)))) ||
    kata.some((k) => k.includes(konteks.kategoriNoun.toLowerCase().slice(0, 4)));
  const konkret = kata.filter((k) => k.length >= 4 && !KATA_KOSONG.has(k));
  // Menyebut produk/kategorinya SAJA belum cukup, dan tidak menyebutnya pun
  // belum tentu generik — yang menentukan adalah ada tidaknya benda/keadaan
  // konkret di kalimat itu.
  return !menyebutProduk && konkret.length < 2;
}

/**
 * Mekanik yang MENUNTUT CGI atau kamera mustahil.
 *
 * Di jalur produksi kita (satu talent, satu HP, r2v Seedance) mekanik ini
 * tidak bisa terasa spontan — dan itu terukur, bukan selera: pada jalankan
 * Scarlett 17 Agu, anomaly_pov "kamera di dasar botol" dinilai nativeness 3
 * dan scale "botol setinggi pintu" juga 3, dengan alasan juri yang sama
 * ("jelas dirakit, nol spontanitas", "CGI jelas terasa dirakit").
 *
 * Mereka bukan ide buruk — mereka ide untuk hook level tinggi, di mana
 * penonton memang datang untuk tontonan yang mustahil. Di level normal,
 * mereka cuma terasa iklan.
 */
export const MEKANIK_BUTUH_CGI = new Set<IdMekanik>(["anomaly_pov", "scale"]);

/** Level hook yang memang menjual tontonan mustahil. */
export const LEVEL_TONTONAN = new Set(["agak_gila", "gila"]);

/** Batas nativeness untuk mekanik CGI di luar level tontonan.
 *
 *  4, yaitu DI BAWAH ambang 7 — jadi ia tidak bisa lolos gate, bukan sekadar
 *  kehilangan sedikit poin. Itu memang maksudnya: mekanik ini hanya milik
 *  level tinggi, dan setengah-setengah akan membuatnya lolos sesekali lalu
 *  keluar sebagai video yang terasa dirakit. */
export const BATAS_NATIVENESS_CGI = 4;

/** Kata yang menandai SITUASI MANUSIA — orang, hubungan, tempat sosial, momen.
 *
 *  Dipakai memeriksa apakah kandidat berangkat dari manusia atau dari benda.
 *  Sengaja daftar kata, bukan model: yang diukur cuma "ada manusianya atau
 *  tidak", dan pertanyaan sesederhana itu tidak butuh panggilan berbayar. */
const KATA_MANUSIA = [
  "aku", "gue", "saya", "kamu", "dia", "orang", "teman", "temen", "bestie", "sahabat",
  "ibu", "bapak", "adik", "kakak", "anak", "pacar", "suami", "istri", "mertua", "tetangga",
  "kos", "kantor", "sekolah", "kampus", "kelas", "rumah", "kamar mandi", "dapur", "arisan",
  "pagi", "malam", "subuh", "telat", "buru-buru", "ngantri", "antre", "reuni", "kondangan",
  "nanya", "ditanya", "bilang", "ngomong", "ketahuan", "sembunyi", "ngumpet", "malu",
  "rebutan", "pinjam", "minjem", "nyamber", "nitip", "dimarahi", "dilarang",
];

/** Apakah situasi ini berangkat dari MANUSIA, bukan dari bendanya? */
export function situasiManusiawi(human_situation: string): boolean {
  const t = ` ${human_situation.toLowerCase().replace(/[^a-z\s-]/g, " ")} `;
  return KATA_MANUSIA.some((k) => t.includes(` ${k} `) || t.includes(`${k} `));
}
