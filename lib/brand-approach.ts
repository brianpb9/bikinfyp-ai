import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from "./templates";
import { TIDAK_OTOMATIS } from "./auto-pick";
import { isServiceLike } from "./config/hooks";
import type { HookLevel } from "./config/hooks";

// PENDEKATAN KONTEN UNTUK SEBUAH BRAND.
//
// Analisa bisnis versi pertama mengembalikan lima label: nama, jenis usaha,
// kategori, audiens, elevator pitch. Brian benar menyebutnya dangkal — itu
// PARAFRASE WEBSITE. Brand yang membayar sudah tahu bisnisnya sendiri; yang
// mereka beli dari kami adalah jawaban atas "jadi kontennya mau diapain?".
//
// Modul ini menjawab itu, dan aturannya sengaja DITURUNKAN DARI KATALOG
// TEMPLATE, bukan ditulis ulang sebagai daftar kedua. Tiap template sudah
// membawa `bestFor` (kategori yang cocok) dan `when` (kapan dipakai); memakai
// ulang keduanya berarti rekomendasi ini ikut benar sendiri waktu katalognya
// bertambah atau berubah. Daftar paralel akan basi diam-diam.
//
// Yang TIDAK dikerjakan di sini: apa pun yang butuh membaca halaman brand
// (nada bicara, klaim yang mereka pakai sendiri). Itu bagian model bahasa di
// lib/brand-analysis.ts. Pembagiannya disengaja — rekomendasi yang bisa
// dihitung harus bisa dipertanggungjawabkan barisnya, bukan dikarang.

export interface SaranTemplate {
  id: string;
  name: string;
  when: string;
  alasan: string;
}

export interface BrandApproach {
  /** Tiga template yang paling masuk akal dijalankan duluan. */
  pakai: SaranTemplate[];
  /** Yang sebaiknya TIDAK dipakai brand ini, dengan alasannya. */
  hindari: { name: string; alasan: string }[];
  kreator: { id: string; label: string; alasan: string };
  hookLevel: { level: HookLevel; label: string; alasan: string };
  klaim: { aman: string[]; hatiHati: string[] };
}

/** Peta kategori -> kreator. Diambil dari daftar CREATORS di app/bikin/gaya
 *  (yang active:true saja) — sengaja id-nya, bukan namanya, supaya kalau
 *  nama avatarnya berubah rekomendasinya tidak ikut salah. */
const KREATOR: Record<string, { id: string; label: string; alasan: string }> = {
  muslim_fashion: { id: "hijaber", label: "Hijaber", alasan: "Audiensnya sendiri berhijab — kreator yang memakai produknya jauh lebih meyakinkan daripada yang cuma memegangnya." },
  beauty: { id: "chindo", label: "Chindo", alasan: "Skincare dinilai dari kulit yang terlihat di kamera, dan persona ini yang paling sering dipakai brand skincare premium." },
  health: { id: "ibu", label: "Ibu-ibu", alasan: "Produk kesehatan dibeli untuk keluarga, bukan untuk diri sendiri — pengambil keputusannya ibu." },
  fashion: { id: "genz", label: "Gen-Z", alasan: "Fashion bergerak lewat gaya, bukan spesifikasi; persona ini paling cocok memperagakan daripada menjelaskan." },
  food: { id: "lokal", label: "Lokal", alasan: "Makanan menjual lewat reaksi yang jujur, dan persona ini terbaca paling tidak dibuat-buat." },
  kitchen: { id: "ibu", label: "Ibu-ibu", alasan: "Yang memegang alat dapur tiap hari adalah orang yang tahu masalahnya — itu yang bikin demonya dipercaya." },
  home: { id: "ibu", label: "Ibu-ibu", alasan: "Barang rumah tangga dibeli oleh yang mengurus rumahnya." },
  gadget: { id: "pria", label: "Pria", alasan: "Kategori ini menuntut penjelasan fitur, dan persona ini paling nyaman membawakan nada teknis." },
  electronics: { id: "pria", label: "Pria", alasan: "Sama dengan gadget: yang dijual kemampuan barangnya, bukan gayanya." },
  kids: { id: "ibu", label: "Ibu-ibu", alasan: "Yang membeli produk anak adalah orang tuanya, bukan anaknya." },
  jasa: { id: "profesional", label: "Profesional", alasan: "Jasa dijual lewat kepercayaan pada orangnya; tampilan profesional yang menahan skeptis calon klien." },
  app: { id: "genzpria", label: "Gen-Z Pria", alasan: "Aplikasi dijelaskan lewat layar dan alur, dan persona ini paling akrab dengan bahasanya." },
  toko: { id: "lokal", label: "Lokal", alasan: "Toko lokal menang justru karena terasa lokal — persona netral yang tidak berjarak." },
};

const KREATOR_DEFAULT = { id: "lokal", label: "Lokal", alasan: "Kategorinya belum menonjol ke satu arah, jadi dipakai persona serbaguna yang aman untuk hampir semua produk." };

/** Peta kategori -> level hook.
 *
 *  Bukan selera: makin mahal dan makin bergantung pada kepercayaan sebuah
 *  kategori, makin mahal juga ongkos hook yang berlebihan. Klinik dan agency
 *  kehilangan klien karena terdengar murahan; brand fashion massal tidak. */
const HOOK: Record<string, { level: HookLevel; alasan: string }> = {
  jasa: { level: "normal", alasan: "Jasa dibeli karena dipercaya. Hook yang terlalu heboh justru membuat calon klien ragu, bukan penasaran." },
  health: { level: "normal", alasan: "Kategori kesehatan diawasi dan mudah terpeleset jadi klaim berlebihan — tahan di nada tenang." },
  app: { level: "agak_berani", alasan: "Aplikasi harus dijelaskan sebelum dijual, jadi hook boleh menarik tapi tidak boleh menelan penjelasannya." },
  beauty: { level: "berani", alasan: "Feed skincare padat dan mirip semua; butuh cukup berani untuk menghentikan jempol, tapi tetap di bawah klaim hasil." },
  toko: { level: "berani", alasan: "Toko lokal bersaing dengan jarak, jadi hook-nya harus memberi alasan datang — bukan sekadar memperkenalkan diri." },
  food: { level: "agak_gila", alasan: "Makanan menang lewat reaksi. Di kategori ini yang berlebihan justru terasa jujur, bukan norak." },
  fashion: { level: "agak_gila", alasan: "Fashion dijual lewat kejutan visual, dan penonton kategori ini paling tahan terhadap hook yang ramai." },
  muslim_fashion: { level: "berani", alasan: "Cukup berani untuk berhenti di-scroll, tapi ditahan dari nada yang terasa tidak sopan untuk audiensnya." },
};

const HOOK_LABEL: Record<HookLevel, string> = {
  normal: "Normal", agak_berani: "Agak Berani", berani: "Berani", agak_gila: "Agak Gila", gila: "Gila",
};

const HOOK_DEFAULT = { level: "berani" as HookLevel, alasan: "Titik tengah yang aman: cukup kuat untuk menahan scroll, belum masuk wilayah yang bisa bikin brand terlihat murahan." };

/** Rambu klaim per kategori. Ini bukan nasihat hukum — ini terjemahan dari
 *  aturan validator kami sendiri (L-13/L-14: mesin tidak boleh mengarang klaim
 *  yang tidak diberikan brand) ke dalam bahasa yang bisa dipakai brand saat
 *  menyiapkan bahan. */
const KLAIM: Record<string, { aman: string[]; hatiHati: string[] }> = {
  beauty: {
    aman: ["Kandungan dan teksturnya", "Cara pakai dan rutinitas", "Kemasan dan ukuran", "Harga dan promo yang benar-benar berjalan"],
    hatiHati: ["Janji hasil dalam jumlah hari tertentu", "Kata yang terdengar medis: menyembuhkan, menghilangkan permanen", "Klaim 'nomor 1' atau 'terbaik' tanpa sumber", "Sebelum-sesudah tanpa rekaman asli"],
  },
  health: {
    aman: ["Komposisi yang tertera di kemasan", "Aturan pakai", "Nomor izin edar kalau memang ada"],
    hatiHati: ["Klaim mengobati atau menyembuhkan penyakit", "Testimoni kesembuhan", "Perbandingan dengan obat"],
  },
  food: {
    aman: ["Rasa, tekstur, aroma", "Bahan dan cara penyajian", "Masa simpan dan pengiriman"],
    hatiHati: ["Klaim halal kalau sertifikatnya belum keluar", "Klaim menurunkan berat badan", "Klaim 'tanpa pengawet' yang belum diuji"],
  },
  fashion: {
    aman: ["Bahan, jahitan, dan ukuran", "Cara padu padan", "Ketersediaan warna dan stok"],
    hatiHati: ["Menyebut merek lain sebagai pembanding", "Klaim 'ori' untuk barang yang bukan produksi sendiri"],
  },
  gadget: {
    aman: ["Spesifikasi yang tertulis di kotak", "Isi paket penjualan", "Garansi resmi"],
    hatiHati: ["Angka performa yang tidak diuji sendiri", "Klaim kompatibilitas yang belum dicoba", "Membandingkan langsung dengan merek lain"],
  },
  jasa: {
    aman: ["Cakupan pekerjaan", "Proses dan lama pengerjaan", "Portofolio yang memang milik sendiri"],
    hatiHati: ["Janji hasil dalam angka (omzet naik sekian persen)", "Menyebut nama klien tanpa izin", "Garansi yang tidak tertulis di kontrak"],
  },
};

const KLAIM_DEFAULT = {
  aman: ["Yang terlihat di foto produk", "Harga dan promo yang benar-benar berjalan", "Isi paket dan pengiriman"],
  hatiHati: ["Klaim hasil yang tidak bisa dibuktikan", "Klaim 'terbaik' atau 'nomor 1' tanpa sumber", "Membandingkan langsung dengan merek lain"],
};

/** Template pembawa KLAIM HASIL: butuh rekaman asli sebelum-sesudah yang tidak
 *  boleh kami buatkan. Alasannya sama dengan TIDAK_OTOMATIS di lib/auto-pick.ts
 *  — di sana untuk mode otomatis, di sini untuk saran ke brand. */
const ALASAN_KLAIM_HASIL =
  "Butuh rekaman asli sebelum-sesudah dari pemakai betulan. Kami tidak membuatkan bukti hasil — kalau brand punya rekamannya, template ini baru boleh jalan.";

/** Urutan level hook, dipakai membandingkan template dengan level yang kami
 *  sarankan sendiri. Tanpa ini kartunya bisa menyarankan "Atap Jebol" tepat di
 *  sebelah kalimat "level hook: Normal, karena jasa dibeli karena dipercaya" —
 *  terukur waktu builder ini dijalankan pertama kali untuk kategori jasa. */
const URUTAN: HookLevel[] = ["normal", "agak_berani", "berani", "agak_gila", "gila"];
const tingkat = (l: HookLevel) => URUTAN.indexOf(l);

export function buildBrandApproach(input: { category: string; businessType?: string }): BrandApproach {
  const kategori = input.category || "default";
  const tanpaBarang = isServiceLike(kategori);
  const saranHook = HOOK[kategori] ?? HOOK_DEFAULT;

  const cocok = CAMPAIGN_TEMPLATES.filter((t) => t.bestFor.includes(kategori));
  // Cadangan kalau kategorinya tidak dikenal katalog, ATAU kalau yang cocok
  // kurang dari tiga: template yang bestFor-nya paling luas = yang paling
  // sering masuk akal. Ini bukan mengarang kecocokan — alasannya ditulis apa
  // adanya ke brand ("belum punya template khusus").
  const serbaguna = [...CAMPAIGN_TEMPLATES].sort((a, b) => b.bestFor.length - a.bestFor.length);

  const butuhBukti = (t: CampaignTemplate) => TIDAK_OTOMATIS.includes(t.id);
  // Brand tanpa barang fisik tidak punya apa pun untuk diperagakan tangan.
  const takBisaDiperagakan = (t: CampaignTemplate) => tanpaBarang && t.format === "hands_only";
  // Jangan menyarankan template yang jauh lebih heboh daripada level hook yang
  // baru saja kami sebut pas untuk brand ini. Satu tingkat masih wajar; dua
  // tingkat membuat kartunya membantah dirinya sendiri.
  const terlaluHeboh = (t: CampaignTemplate) => tingkat(t.hookLevel) - tingkat(saranHook.level) >= 2;

  const bolehDipakai = (t: CampaignTemplate) => !butuhBukti(t) && !takBisaDiperagakan(t) && !terlaluHeboh(t);

  const terpilih: CampaignTemplate[] = [];
  for (const t of [...cocok.filter(bolehDipakai), ...serbaguna.filter(bolehDipakai)]) {
    if (terpilih.length >= 3) break;
    if (!terpilih.some((x) => x.id === t.id)) terpilih.push(t);
  }

  const pakai = terpilih.map((t) => ({
    id: t.id,
    name: t.name,
    when: t.when,
    alasan: t.bestFor.includes(kategori)
      ? `Formatnya memang disusun untuk kategori ini — ${t.when.charAt(0).toLowerCase()}${t.when.slice(1)}`
      : "Kategorimu belum punya template khusus untuk slot ini, jadi dipakai format yang cocok untuk paling banyak jenis produk.",
  }));

  // Yang dihindari dicari dari SELURUH katalog, bukan cuma yang cocok
  // kategorinya. Kalau dibatasi ke yang cocok, brand jasa tidak pernah
  // diperingatkan soal format tangan — karena memang tidak ada template
  // hands_only yang menyebut "jasa" di bestFor. Peringatan yang tidak pernah
  // muncul sama saja tidak ada.
  const hindari: { name: string; alasan: string }[] = [];
  const catat = (t: CampaignTemplate, alasan: string) => {
    if (hindari.length < 3 && !hindari.some((x) => x.name === t.name)) hindari.push({ name: t.name, alasan });
  };
  for (const t of [...cocok, ...serbaguna]) {
    if (hindari.length >= 3) break;
    if (butuhBukti(t)) catat(t, ALASAN_KLAIM_HASIL);
    else if (takBisaDiperagakan(t))
      catat(t, "Formatnya bertumpu pada tangan yang memperagakan barang, dan usahamu tidak menjual barang fisik — yang dijual kemampuannya.");
    else if (terlaluHeboh(t))
      // Disebut angkanya, bukan dikhotbahi: template ini bukan dilarang, cuma
      // bukan andalan harian untuk kategori ini.
      catat(t, `Template ini disetel di level hook ${HOOK_LABEL[t.hookLevel]}, dua tingkat di atas ${HOOK_LABEL[saranHook.level]} yang cocok untuk kategorimu. Boleh dipakai kalau memang lagi mau agresif — jangan dijadikan andalan harian.`);
  }

  return {
    pakai,
    hindari,
    kreator: KREATOR[kategori] ?? KREATOR_DEFAULT,
    hookLevel: { level: saranHook.level, label: HOOK_LABEL[saranHook.level], alasan: saranHook.alasan },
    klaim: KLAIM[kategori] ?? KLAIM_DEFAULT,
  };
}
