import type { TemplateCtx } from "./templates";

// Variasi kalimat per TEMPLATE (bukan per keluarga hook).
//
// Kenapa ada: mengunci keluarga hook membuat semua varian keluar sama persis,
// karena mesin punya satu teks tetap per keluarga. Layar "pilih skrip" jadi
// pilihan palsu. Di sini tiap template punya beberapa susunan kalimat dengan
// HOOK DAN STRUKTUR YANG SAMA — yang berbeda hanya cara mengatakannya, persis
// maksud "template = tiru konten itu, variasinya di kata-katanya".
//
// BATASAN YANG MEMBENTUK ISINYA:
//
// 1. L-13/L-14 melarang menyebut klaim atau angka yang tidak ada di data
//    produk. Jadi TIDAK ADA copy di sini yang menyebut nama bahan aktif,
//    durasi pemakaian, atau persentase — semuanya harus datang dari brand.
//    Ini yang membuat T09 ("Klaim + Bahan Aktif") tidak bisa ditiru penuh:
//    formulanya dibangun di atas daftar bahan, dan kita tidak punya kolomnya.
//    Yang ditulis di bawah adalah kerangkanya, dengan tempat bahan diisi dari
//    kolom Klaim brand kalau ada.
//
// 2. Kata ganti ikut register (c.reg.me / c.reg.you), tidak dipatok. Dokumen
//    bedah menyebut video untuk cowok memakai "lo-gue" dan untuk cewek
//    "aku-kamu"; di kita itu sudah ditentukan kategori kreator, jadi copy ini
//    menyesuaikan sendiri alih-alih memaksa satu gaya.
//
// 3. Nama produk disebut SEKALI saja per skrip (aturan T01), kecuali template
//    yang memang membangun kredibilitas dari nama panjangnya.
//
// 4. JANGAN menambahkan "-nya" setelah c.proof atau c.pain. Keduanya SUDAH
//    berakhiran -nya di lib/config/hooks.ts ("teksturnya", "materialnya",
//    "kusamnya"). Ketahuan saat mencetak keluarannya: "teksturnya nya".
//
// 5. Kata keluhan kategori tidak semuanya bisa masuk bingkai kalimat yang
//    sama. "gak bikin kusamnya" masuk akal; "gak bikin berantakannya" untuk
//    kursi kantoran tidak. Bingkai di bawah dipilih yang bekerja untuk semua
//    kategori — juga ketahuan dari keluarannya, bukan dari membaca kode.

export interface CopyTriple {
  hook: string;
  demo: string;
  cta: string;
}

type CopyFn = (c: TemplateCtx) => CopyTriple;

// ── T01 "PAKAI DI TEMPAT SUSAH" ─────────────────────────────────────────────
// Aturan dokumennya: JANGAN pernah menyebut masalahnya sebagai masalah. Video
// aslinya tidak pernah bilang "gigi kuning" — yang ada "kebersihan tetap gak
// boleh di-skip". Positif terus, maksudnya tetap sampai.
const T01: CopyFn[] = [
  (c) => ({
    hook: `Lagi di luar seharian gini tuh seru, tapi ${c.noun} tetep gak boleh di-skip sih menurut ${c.reg.me}`,
    demo: `soalnya ${c.reg.me} tetep beraktivitas kayak biasa. makanya ${c.reg.me} tetep bawa ${c.produk}, ${c.proof} kerasa banget walau lagi di kondisi kayak gini`,
    cta: `Jangan lupa cek keranjang kuning ya`,
  }),
  (c) => ({
    hook: `${c.reg.sapaan}, di tempat kayak gini pun ${c.reg.me} tetep gak mau skip ${c.noun}`,
    demo: `ribet dikit sih, tapi ya tetep ${c.reg.me} jalanin. ${c.produk} ini yang ${c.reg.me} bawa terus, ${c.proof} paling kerasa pas lagi di luar`,
    cta: `Udah ${c.reg.me} taruh di keranjang kuning ya`,
  }),
  (c) => ({
    hook: `Yang sering keluar rumah pasti ngerti, ${c.noun} tuh gampang kelewat`,
    demo: `padahal aktivitasnya jalan terus kayak biasa. ${c.reg.me} akalin bawa ${c.produk} — ${c.proof} tetep kerasa, jadi ${c.reg.me} tetep pede walau lagi di mana pun`,
    cta: `Cek keranjang kuning ya kalau mau`,
  }),
];

// ── T02 "BEDAH FITUR" ───────────────────────────────────────────────────────
// Aturan dokumennya: kalimat kedua LANGSUNG bandingkan dengan kompetitor
// murah — itu yang bikin harga produkmu terasa masuk akal. Sebut rentang harga
// kompetitor, jangan sebut mereknya. Tutup dengan bercanda menghina diri
// sendiri supaya video jualan-teknis tidak terasa seperti brosur.
const T02: CopyFn[] = [
  (c) => ({
    hook: `Enak banget nih ${c.produk}, ${c.proof} mantul`,
    demo: `daripada ${c.reg.you} beli yang murahan kagak jelas, mending ke sini. bahannya niat, bagian yang dipegang tiap hari juga nyaman, dan yang bikin ${c.reg.me} bertahan: ${c.pain} nggak jadi masalah lagi`,
    cta: `Gas cek keranjang kuning sekarang`,
  }),
  (c) => ({
    hook: `${c.reg.sapaan}, ${c.proof} ${c.produk} ini beda sih`,
    demo: `${c.reg.me} udah coba yang lebih murah dan ya gitu deh. yang ini tiap bagiannya kerasa dikerjain beneran, dipakai seharian juga aman — cocok buat yang gampang pegel kayak ${c.reg.me}`,
    cta: `Langsung cek keranjang kuning aja`,
  }),
  (c) => ({
    hook: `Nih ${c.reg.me} bedah ${c.produk} nya satu-satu`,
    demo: `bagian yang paling sering disentuh: aman. ${c.proof}: niat. urusan ${c.pain}: beres. dibanding yang harganya jauh lebih murah, ya jelas beda`,
    cta: `Gas checkout sekarang`,
  }),
];

// ── T09 "KLAIM + BAHAN AKTIF" ───────────────────────────────────────────────
// PALING TERBATAS dari ketiganya. Formula aslinya: hook keraguan -> durasi
// pemakaian -> tiga bahan aktif -> tiga manfaat sejajar -> CTA. Dua bagian
// tengahnya BUTUH data yang tidak kita punya (nama bahan, lama pemakaian), dan
// mengarangnya melanggar L-13/L-14 — di kategori kosmetik itu bukan
// pelanggaran gaya, itu klaim palsu.
//
// Yang ditulis di sini kerangkanya: hook keraguan dan nada "riset dulu" tetap
// dipertahankan, tempat bahan dibiarkan diisi kolom Klaim brand. Kalau brand
// tidak mengisi Klaim, template ini jatuh ke bukti yang memang kita punya
// (c.proof) — jujur, tapi memang bukan tiruan penuh.
const T09: CopyFn[] = [
  (c) => ({
    hook: `Percaya gak sih, ${c.pain} ${c.reg.me} bisa berubah cuma karena ${c.noun} ini aja`,
    demo: `${c.reg.me} pakai rutin, dan ${c.proof} yang paling kelihatan bedanya. ${c.produk} ini emang dirancang buat itu`,
    cta: `Kalau mau coba juga, cek keranjang kuning ya`,
  }),
  (c) => ({
    hook: `${c.reg.sapaan}, ${c.reg.me} sempet ragu ${c.noun} bisa sepengaruh ini`,
    demo: `ternyata pas dipakai rutin ya kelihatan. ${c.proof} beda, dan itu yang bikin ${c.reg.me} lanjut pakai ${c.produk}`,
    cta: `Yuk cek keranjang kuning sekarang`,
  }),
  (c) => ({
    hook: `Buat yang suka riset dulu sebelum beli, ${c.noun} ini ${c.reg.me} pakai rutin`,
    demo: `bukan yang langsung berubah semalam, tapi ${c.proof} konsisten. ${c.produk} — ${c.reg.me} cocok sih`,
    cta: `Cek keranjang kuning ya kalau mau`,
  }),
];

export const TEMPLATE_COPY: Record<string, CopyFn[]> = {
  "t01-tempat-susah": T01,
  "t02-bedah-fitur": T02,
  "t09-bahan-aktif": T09,
};

/** Varian ke-i untuk template ini, atau null kalau templatenya belum ditulis.
 *  Dibungkus modulo supaya jumlah varian yang diminta boleh lebih banyak
 *  daripada jumlah susunan kalimat yang tersedia. */
export function templateCopy(
  templateId: string | null | undefined,
  i: number,
  c: TemplateCtx
): CopyTriple | null {
  if (!templateId) return null;
  const list = TEMPLATE_COPY[templateId];
  if (!list?.length) return null;
  return list[i % list.length](c);
}
