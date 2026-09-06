/**
 * Hashtag yang MENYEBUT PRODUKNYA, bukan cuma kategorinya.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA
 * ---------------------------------------------------------------------------
 * Dilaporkan Brian 6 Sep 2026. Sampai saat itu hashtag dibuat oleh
 * buildHashtags(category) yang HANYA melihat kategori — delapan kategori,
 * masing-masing tiga tag tetap. Akibatnya speaker karaoke 100 watt, power bank,
 * dan kabel charger mendapat hashtag yang sama persis:
 *
 *   #gadgetviral #racunteknologi #gadgetmurah
 *
 * Tidak satu pun menyebut speaker, audio, atau karaoke. Untuk penjual, tag
 * seperti itu tidak menemukan penonton yang sedang mencari barangnya — dan tag
 * yang tidak menemukan siapa-siapa adalah kolom yang isinya hanya terlihat
 * seperti pekerjaan.
 *
 * ---------------------------------------------------------------------------
 * KENAPA TIDAK PAKAI LLM
 * ---------------------------------------------------------------------------
 * Ini pekerjaan mengekstrak kata, bukan menulis. LLM menambah biaya, latensi,
 * dan satu lagi titik gagal pada jalur yang sudah tiga kali gagal validator.
 * Nama produk marketplace SUDAH memuat kata yang kita cari; yang dibutuhkan
 * hanya membuang kebisingannya.
 */

/** Kata yang tidak pernah layak jadi hashtag, walau sering muncul di judul. */
const BUANG = new Set([
  // Janji dagang
  "garansi", "resmi", "promo", "paket", "original", "ori", "murah", "termurah",
  "terlaris", "terbaru", "gratis", "free", "ready", "stock", "stok", "cod",
  "diskon", "bonus", "grosir", "official", "store", "shop", "olshop", "seller",
  "best", "new", "sale", "flash", "limited", "bundle",
  // Sifat umum — menempel di hampir semua judul, jadi tidak membedakan apa pun
  "portable", "profesional", "professional", "premium", "mini", "jumbo",
  "besar", "kecil", "super", "extra", "extr", "plus", "pro", "max", "lite",
  "model", "tipe", "type", "warna", "ukuran", "bahan", "kualitas", "bagus",
  // Satuan & kemasan
  "rms", "watt", "inch", "inci", "cm", "mm", "ml", "gram", "gr", "kg", "pcs",
  "pack", "meter", "liter", "set", "isi", "unit", "buah", "lusin",
  // Kata sambung
  "dan", "atau", "untuk", "dengan", "dari", "yang", "ini", "itu", "buat",
  "bisa", "juga", "per", "pada", "serta", "dalam", "tanpa",
]);

/** Maksimal kata produk yang diangkat jadi hashtag. */
export const MAKS_TAG_PRODUK = 2;

/** Total hashtag yang dikirim ke pengguna. */
export const TOTAL_HASHTAG = 8;

/**
 * Kata-kata dari nama produk yang layak jadi hashtag.
 *
 * Token pertama dilewati bila HURUF BESAR SEMUA di teks aslinya: di judul
 * marketplace itu hampir selalu merek ("ADVANCE", "XIAOMI"), dan merek bukan
 * kata yang dicari pembeli yang belum tahu mau beli apa.
 */
export function kataProduk(namaProduk: string): string[] {
  const mentah = namaProduk.split(/[^A-Za-z0-9]+/).filter(Boolean);
  const hasil: string[] = [];
  for (let i = 0; i < mentah.length; i++) {
    const asli = mentah[i]!;
    if (i === 0 && asli.length > 1 && asli === asli.toUpperCase() && /[A-Z]/.test(asli)) continue;
    const kata = asli.toLowerCase();
    // Angka di dalam kata = kode model (K1812), ukuran (18inch), atau daya
    // (100W). Tidak ada yang mencarinya di TikTok.
    if (/\d/.test(kata)) continue;
    if (kata.length < 4) continue;
    if (BUANG.has(kata)) continue;
    if (hasil.includes(kata)) continue;
    hasil.push(kata);
    if (hasil.length >= MAKS_TAG_PRODUK) break;
  }
  return hasil;
}

/**
 * Rangkai hashtag akhir: umum -> produk -> niche kategori, dipotong di
 * TOTAL_HASHTAG.
 *
 * URUTANNYA DISENGAJA. Tag produk didahulukan atas tag niche karena tag produk
 * yang membuat video ini ditemukan orang yang mencari BARANG INI; tag niche
 * hanya menaruhnya di kerumunan. Kalau harus ada yang dibuang karena batas
 * jumlah, yang dibuang niche-nya.
 */
export function rangkaiHashtag(dasar: string[], namaProduk: string, niche: string[]): string[] {
  const produk = kataProduk(namaProduk).map((k) => `#${k}`);
  const keluar: string[] = [];
  for (const t of [...dasar, ...produk, ...niche]) {
    if (keluar.length >= TOTAL_HASHTAG) break;
    if (!keluar.includes(t)) keluar.push(t);
  }
  return keluar;
}
