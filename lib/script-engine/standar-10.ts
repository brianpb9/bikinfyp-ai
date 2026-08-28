/**
 * STANDAR 10/10 (knowledge/rules/standard-10.md, Brian 18 Agu 2026) sebagai KODE.
 *
 * Dokumennya adalah sumbernya; berkas ini yang membuat sebagiannya bisa
 * ditegakkan mesin. Pemisahan itu disengaja: teks standar berubah lewat diskusi
 * produk, kode berubah lewat tes — dan menyalin kalimatnya ke sini akan membuat
 * keduanya menyimpang diam-diam. Yang disalin cuma NOMOR barisnya.
 *
 * Empat tingkat penegakan, dan bedanya harus jujur:
 *
 *   "kode"   — ada pemeriksa mekanis yang bisa MENOLAK naskah.
 *   "render" — dijamin mekanis saat merender (composer/QC), bukan saat menulis.
 *              Naskah tidak bisa melanggarnya karena naskah bukan tempatnya
 *              diputuskan. Baris 7 begitu sejak 20 Agu: label merek dijamin
 *              packshot foto asli, bukan diminta dari penulis atau model video.
 *   "prompt" — hanya disuntikkan ke penulis; ia bisa mengabaikannya.
 *   "belum"  — butuh bukti yang belum kita punya (render, riwayat akun).
 *
 * Menyebut baris yang cuma ada di prompt sebagai "ditegakkan" adalah cara
 * paling cepat membuat standar ini terlihat berjalan padahal tidak.
 */
import { hookLevelRank, type HookLevel } from "../config/hooks";
import { tutupiNama } from "../media/pemicu-filter";
import type { SegmentDraft } from "./templates";

export type Penegakan = "kode" | "render" | "prompt" | "belum";

export interface Baris10 {
  no: number;
  judul: string;
  penegakan: Penegakan;
  /** Dimensi FYP Gate yang diwakili baris ini (PATCH 4 §6). */
  dimensi: string;
  /** Kenapa belum bisa ditegakkan mesin — wajib diisi kalau bukan "kode". */
  catatan?: string;
}

/**
 * Peta 12 baris -> dimensi FYP, plus status penegakannya.
 *
 * Empat baris berbintang (1, 2, 6, 8) memakai aturan cap: kalau salah satunya
 * gagal, totalnya ditahan di 6 apa pun sisanya. Itu keputusan Brian di §B, dan
 * alasannya sama dengan ambang per dimensi di FYP Gate: kelemahan kritis tidak
 * boleh bisa dirata-ratakan sampai hilang.
 */
export const BARIS_10: Baris10[] = [
  // Turun dari "kode" ke "belum" (audit A2, 19 Agu): anomaliTanpaKata() ada dan
  // punya unit test sendiri, tapi TIDAK dipanggil validator maupun Idea Stage —
  // fungsi yang tidak pernah dijalankan tidak menegakkan apa pun. Dijaga
  // tests/standar-10-klaim-penegakan.test.ts.
  { no: 1, judul: "Anomali di frame pertama tanpa kata", penegakan: "belum", dimensi: "scroll_stop",
    catatan: "anomaliTanpaKata() belum dipanggil jalur produksi mana pun — hanya prompt yang memintanya" },
  { no: 2, judul: "Satu ide, tidak bisa dipindah ke produk lain", penegakan: "kode", dimensi: "distinctiveness" },
  { no: 3, judul: "Situasi manusia menanggung video", penegakan: "kode", dimensi: "story_pull" },
  { no: 4, judul: "Payoff menjawab hook, bukan katalog", penegakan: "kode", dimensi: "payoff" },
  { no: 5, judul: "Level hook sesuai kategori", penegakan: "kode", dimensi: "scroll_stop" },
  { no: 6, judul: "Nol klaim yang bisa disalahkan", penegakan: "kode", dimensi: "brand_fidelity_plan" },
  { no: 7, judul: "Brand fidelity terencana", penegakan: "render", dimensi: "brand_fidelity_plan",
    catatan: "sejak 20 Agu label dijamin PACKSHOT foto asli di composer (appendPackshot), bukan diminta ke model video; QC-10 membuktikan asal-usul fotonya (sha) dan memburu huruf salah di bagian generate" },
  { no: 8, judul: "Filter-safe secara struktural", penegakan: "kode", dimensi: "nativeness" },
  { no: 9, judul: "Bahasa dikunci 4 lapis", penegakan: "kode", dimensi: "story_pull" },
  { no: 10, judul: "Struktur produksi jujur", penegakan: "kode", dimensi: "nativeness" },
  { no: 11, judul: "Variasi katalog antar video", penegakan: "belum", dimensi: "distinctiveness",
    catatan: "fungsinya ada (variasiKatalog) tapi riwayat per-talent belum tersimpan: scripts tidak menyimpan persona" },
  { no: 12, judul: "Bisa dijelaskan kenapa orang berhenti", penegakan: "kode", dimensi: "story_pull" },
];

/** Baris yang kegagalannya menahan total di 6. */
export const BARIS_CAP = [1, 2, 6, 8];

// ---------------------------------------------------------------------------
// §A — uji cepat genre
// ---------------------------------------------------------------------------

/** Kata yang menandai TINDAKAN PRIBADI pembeli (syarat ide Affiliate). */
// Awalan Indonesia (di-, me-, ke-, ter-, ber-) dan akhiran (-in, -nya, -an)
// ikut: "dipakai", "nyimpenin", dan "belinya" semuanya tindakan pribadi. Versi
// pertama memakai \b di depan, jadi "dipakai" tidak terhitung sama sekali.
const TINDAKAN_PRIBADI = /\w*(beli|belanja|borong|checkout|pakai|pake|simpan|nyimpen|sembunyi|rebut|titip|stok|restock|habis|nyoba|coba|punya)\w*/i;
/** Kata belanja/transaksi — dilarang di ide Ads (§A: jual rasa, bukan transaksi). */
const KATA_BELANJA = /\b(keranjang|checkout|diskon|promo|harga|murah|stok|beli|borong|gratis ongkir)\b/i;

export interface HasilUjiGenre {
  lolos: boolean;
  sebab: string[];
}

/**
 * Uji cepat §A, dijalankan otomatis pada tiap kandidat ide.
 *
 * Dua arah, persis seperti tertulis di dokumen:
 *   - ide Ads yang masih masuk akal dengan CTA "keranjang kuning" adalah
 *     Affiliate yang menyamar;
 *   - ide Affiliate tanpa satu pun tindakan pribadi adalah Ads yang salah kamar.
 */
export function ujiCepatGenre(input: {
  contentType: "affiliate" | "ads";
  one_liner: string;
  human_situation: string;
  mechanic?: string;
}): HasilUjiGenre {
  const teks = `${input.one_liner} ${input.human_situation}`;
  const sebab: string[] = [];
  if (input.contentType === "ads") {
    const belanja = teks.match(KATA_BELANJA);
    if (belanja) {
      sebab.push(
        `ide Ads memakai bahasa transaksi ("${belanja[0]}") — dengan CTA "keranjang kuning" ide ini tetap masuk akal, ` +
          "artinya ini Affiliate yang menyamar (§A uji cepat)"
      );
    }
  } else {
    if (!TINDAKAN_PRIBADI.test(teks)) {
      sebab.push(
        "ide Affiliate tidak menyebut satu pun tindakan pribadi (beli/pakai/simpan/rebutan) — " +
          "itu Ads yang salah kamar (§A uji cepat)"
      );
    }
  }
  return { lolos: sebab.length === 0, sebab };
}

// ---------------------------------------------------------------------------
// §B baris 5 — level hook minimal per kategori
// ---------------------------------------------------------------------------

/** Kategori jenuh: minimal L2 (agak_berani). Angka & daftarnya dari §B baris 5. */
export const KATEGORI_JENUH = new Set(["beauty", "skincare", "food", "fnb", "makanan", "minuman", "home", "cleaning"]);
const KATA_JENUH = /\b(sabun|soap|odol|toothpaste|pasta gigi|serum|skincare|lotion|shampoo|sampo|kopi|snack|minuman)\b/i;

export function kategoriJenuh(input: { productCategory?: string | null; productName?: string | null }): boolean {
  return KATEGORI_JENUH.has((input.productCategory ?? "").toLowerCase()) || KATA_JENUH.test(input.productName ?? "");
}

export function levelHookCukup(input: {
  hookLevel: HookLevel;
  productCategory?: string | null;
  productName?: string | null;
}): { lolos: boolean; sebab?: string } {
  if (!kategoriJenuh(input)) return { lolos: true };
  if (hookLevelRank(input.hookLevel) >= 2) return { lolos: true };
  return {
    lolos: false,
    sebab: `kategori jenuh menuntut level hook minimal L2 (agak_berani), sekarang L${hookLevelRank(input.hookLevel)} (${input.hookLevel}) — §B baris 5`,
  };
}

// ---------------------------------------------------------------------------
// §B baris 4 — payoff bukan katalog
// ---------------------------------------------------------------------------

/** Pembuka kalimat katalog: mendeskripsikan barang, bukan menjawab hook. */
const PEMBUKA_KATALOG = /^\s*(isinya|isi nya|teksturnya|kandungannya|ukurannya|beratnya|warnanya|bahannya|komposisinya|netto|volumenya)\b/i;

export function payoffBukanKatalog(input: { teksShot2: string; mechanic?: string }): { lolos: boolean; sebab?: string } {
  // Mekanik yang memang TENTANG teksturnya dikecualikan — di sana mendeskripsikan
  // bendanya justru payoff-nya.
  if (/tekstur|texture|transformation/i.test(input.mechanic ?? "")) return { lolos: true };
  const m = input.teksShot2.match(PEMBUKA_KATALOG);
  if (!m) return { lolos: true };
  return {
    lolos: false,
    sebab: `kalimat shot 2 dibuka "${m[0].trim()}" — itu katalog, bukan ALASAN yang menjawab hook (§B baris 4)`,
  };
}

// ---------------------------------------------------------------------------
// §B baris 1 — anomali di frame pertama tanpa kata
// ---------------------------------------------------------------------------

export function anomaliTanpaKata(segments: SegmentDraft[]): { lolos: boolean; sebab?: string } {
  const pertama = segments[0];
  if (!pertama) return { lolos: false, sebab: "tidak ada segmen" };
  const keadaan = (pertama.start_state ?? "").trim();
  if (keadaan.length < 15) {
    return {
      lolos: false,
      sebab: "segmen pertama tidak menuliskan start_state — anomali detik 0-1 harus terbaca tanpa dialog (§B baris 1)",
    };
  }
  if (!pertama.product_state) {
    return { lolos: false, sebab: "segmen pertama tidak menyatakan product_state (hidden/partial/hero) — §B baris 1" };
  }
  return { lolos: true };
}

// ---------------------------------------------------------------------------
// §B baris 2 — uji tukar produk
// ---------------------------------------------------------------------------

/**
 * One-liner harus menyebut kategori produknya secara SPESIFIK.
 *
 * Ujinya persis contoh Brian: "Aku ngopi terus, jadi aku pakai ini" bisa
 * dipasang ke odol apa pun -> gagal. Mekanisnya sederhana dan sengaja tidak
 * pintar: kalau kalimatnya tidak menyebut satu pun kata benda kategori atau
 * kata dari nama produknya, ia lolos tukar-produk.
 */
export function ujiTukarProduk(input: {
  one_liner: string;
  productName: string;
  productCategory?: string | null;
}): { lolos: boolean; sebab?: string } {
  const teks = input.one_liner.toLowerCase();
  const kataNama = (input.productName.toLowerCase().match(/[a-z]{4,}/g) ?? [])
    .filter((w) => !["yang", "untuk", "dengan", "dari", "official", "store"].includes(w));
  if (kataNama.some((w) => teks.includes(w))) return { lolos: true };
  if (KATA_JENUH.test(teks)) return { lolos: true };
  const kategori = (input.productCategory ?? "").toLowerCase();
  if (kategori.length >= 4 && teks.includes(kategori)) return { lolos: true };
  return {
    lolos: false,
    sebab: `one-liner tidak menyebut produk/kategorinya, jadi kalimatnya bisa dipindah ke produk lain (§B baris 2)`,
  };
}

// ---------------------------------------------------------------------------
// §B baris 9 — batas kata per shot
// ---------------------------------------------------------------------------

export const MAKS_KATA_PER_SHOT = 10;

/**
 * Batas kata satu shot.
 *
 * §B baris 9 menulis dua angka: <=1,5 kata/detik dan <=10 kata per shot. Yang
 * kedua ditulis untuk shot standar ~5 detik (baris 10: "15 detik = 3 shot
 * +-5 detik"). Menerapkan angka 10 apa adanya ke segmen 20 detik akan menolak
 * naskah yang justru masih jauh di bawah 1,5 kata/detik — aturan yang benar
 * dipakai di tempat yang salah tetap menghasilkan penolakan yang salah.
 *
 * Jadi batasnya yang LEBIH LONGGAR di antara keduanya: 10 kata untuk shot
 * pendek, dan 1,5 kata/detik begitu shotnya lebih panjang dari itu.
 */
export function batasKataShot(durasiDetik: number): number {
  return Math.max(MAKS_KATA_PER_SHOT, Math.round(1.5 * Math.max(0, durasiDetik)));
}

export function kataPerShot(segments: SegmentDraft[]): { lolos: boolean; sebab?: string } {
  for (const s of segments) {
    const n = s.text.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;
    const batas = batasKataShot((Number(s.end) || 0) - (Number(s.start) || 0));
    if (n > batas) {
      return { lolos: false, sebab: `segmen "${s.role}" ${n} kata — maksimal ${batas} kata untuk shot ${Math.round((Number(s.end)||0)-(Number(s.start)||0))} detik (§B baris 9)` };
    }
  }
  return { lolos: true };
}

// ---------------------------------------------------------------------------
// §B baris 11 — variasi katalog
// ---------------------------------------------------------------------------

function normal(teks: string): string {
  return teks.toLowerCase().replace(/\[[^\]]*\]/g, " ").replace(/[^a-z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
}

/**
 * Shot 2 dan CTA tidak boleh identik dengan DUA video terakhir talent yang sama.
 *
 * Fungsinya siap; yang belum ada RIWAYATNYA — tabel scripts tidak menyimpan
 * persona/talent, jadi "dua video terakhir talent ini" belum bisa dijawab.
 * Sampai itu ada, baris 11 tercatat sebagai BELUM ditegakkan, bukan lulus.
 */
export function variasiKatalog(input: {
  shot2: string;
  cta: string;
  riwayat: { shot2: string; cta: string }[];
}): { lolos: boolean; sebab?: string } {
  const dua = input.riwayat.slice(0, 2);
  const samaShot2 = dua.filter((r) => normal(r.shot2) === normal(input.shot2)).length;
  const samaCta = dua.filter((r) => normal(r.cta) === normal(input.cta)).length;
  if (samaShot2 >= 2) return { lolos: false, sebab: "kalimat shot 2 sama dengan dua video terakhir talent ini (§B baris 11)" };
  if (samaCta >= 2) return { lolos: false, sebab: "kalimat CTA sama dengan dua video terakhir talent ini (§B baris 11)" };
  return { lolos: true };
}

// ---------------------------------------------------------------------------
// Skor 12/12
// ---------------------------------------------------------------------------

export interface Skor12 {
  /** Baris yang LULUS. */
  lulus: number[];
  gagal: { no: number; sebab: string }[];
  /** "9/12" — dicetak di UI dan log. */
  garis: string;
  /** Nilai 0-10 sesuai §B: 12/12 = 10, tiap baris gagal -1, cap 6 bila 1/2/6/8 gagal. */
  nilai: number;
  /** true bila cap baris kritis aktif. */
  capKritis: boolean;
}

export function skor12(gagal: { no: number; sebab: string }[]): Skor12 {
  const nomorGagal = new Set(gagal.map((g) => g.no));
  const lulus = BARIS_10.map((b) => b.no).filter((n) => !nomorGagal.has(n));
  const dasar = Math.max(0, 10 - nomorGagal.size);
  const capKritis = BARIS_CAP.some((n) => nomorGagal.has(n));
  return {
    lulus,
    gagal,
    garis: `${lulus.length}/12 baris standar`,
    nilai: capKritis ? Math.min(dasar, 6) : dasar,
    capKritis,
  };
}


// ---------------------------------------------------------------------------
// Penilaian 12 baris pada tingkat IDE
// ---------------------------------------------------------------------------

/**
 * Nilai baris yang bisa diperiksa dari IDE saja (sebelum naskah ada).
 *
 * Yang TIDAK bisa dinilai di sini tidak dihitung gagal — ia belum diuji. Baris
 * yang butuh naskah (1, 4, 9) dan yang butuh video jadi (7) dinilai di gerbang
 * masing-masing, dan baris 11 belum bisa dinilai sama sekali. Menandai yang
 * belum diuji sebagai LULUS akan membuat garis "12/12" berbohong ke atas.
 */
export interface KonteksIde12 {
  contentType: "affiliate" | "ads";
  one_liner: string;
  human_situation: string;
  mechanic: string;
  why_stop: string;
  hookLevel: HookLevel;
  productName: string;
  productCategory?: string | null;
  /** Temuan detektor pemicu pada teks ide (baris 8). */
  pemicu?: string[];
  /** Klaim yang disebut ide (baris 6) — kosong berarti tidak ada klaim. */
  claim_safety?: string;
}

/**
 * Buang SETIAP kata nama produk (>=4 huruf) dari teks — bukan cuma pasangan
 * kata berurutan. Dipakai baris 6 saja; lihat alasannya di pemakaiannya.
 */
function tutupiKataNama(teks: string, nama?: string | null): string {
  const dasar = tutupiNama(teks, nama); // pasangan kata dulu (pola terbukti)
  const kata = (nama ?? "").split(/\s+/).filter((w) => w.length >= 4);
  let out = dasar;
  for (const w of kata) {
    out = out.replace(new RegExp(`\\b${w.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "gi"), " PRODUK ");
  }
  return out;
}

export function nilaiBarisIde(k: KonteksIde12): { gagal: { no: number; sebab: string }[]; belumDiuji: number[] } {
  const gagal: { no: number; sebab: string }[] = [];
  const belumDiuji = [1, 4, 7, 9, 11];

  const b2 = ujiTukarProduk({ one_liner: k.one_liner, productName: k.productName, productCategory: k.productCategory });
  if (!b2.lolos) gagal.push({ no: 2, sebab: b2.sebab! });

  if (k.human_situation.trim().length < 15) {
    gagal.push({ no: 3, sebab: "human_situation kosong/terlalu pendek — video ditanggung situasi manusia, bukan benda" });
  }

  const b5 = levelHookCukup({ hookLevel: k.hookLevel, productCategory: k.productCategory, productName: k.productName });
  if (!b5.lolos) gagal.push({ no: 5, sebab: b5.sebab! });

  // Baris 6 dinilai dari klaimnya sendiri: kata yang tidak boleh DIUCAPKAN.
  //
  // Nama produk dibuang lebih dulu (20 Agu). Bug nyata: "Scarlett Whitening
  // Serum" adalah nama SKU di katalog, dan menyebutnya bukan mengklaim apa pun
  // — tapi baris 6 menjatuhkannya, menahan nilai di 6, sehingga setiap SKU
  // dengan kata itu di namanya mustahil lolos gate berapa pun bagus idenya.
  // Yang dilarang tetap klaimnya sebagai kalimat; masking memakai helper yang
  // sama dengan penyaring pemicu, bukan salinan aturan kedua.
  // Masking baris 6 lebih lebar daripada masking penyaring pemicu, dan itu
  // disengaja. tutupiNama() menuntut DUA kata berurutan supaya "shower"
  // sendirian tidak jadi izin global — benar untuk penyaring penyedia, tapi
  // salah di sini: SKU bernama "Scarlett Whitening Serum" ditulis ulang model
  // sebagai "serum whitening-nya", satu kata, lalu dituduh mengklaim.
  //
  // Aman dilonggarkan karena gerbang yang sebenarnya menjaga penonton ada di
  // tingkat NASKAH dan tetap keras: L-10 (overclaim) dan L-11 (klaim medis)
  // memeriksa kalimat yang benar-benar diucapkan. Yang dilonggarkan di sini
  // cuma penilaian IDE, dan hanya untuk kata yang memang ada di nama produk.
  const teksKlaim = tutupiKataNama(`${k.one_liner} ${k.why_stop} ${k.claim_safety ?? ""}`, k.productName);
  if (/\b(whitening|memutihkan|instan|instant|menyembuhkan|klinis)\b/i.test(teksKlaim)) {
    gagal.push({ no: 6, sebab: "ide menyebut klaim yang tidak boleh diucapkan (whitening/instan/menyembuhkan/klinis)" });
  }

  if ((k.pemicu ?? []).length) {
    gagal.push({ no: 8, sebab: `ide memuat pemicu penyaring: ${(k.pemicu ?? []).join("; ")}` });
  }

  // Baris 10: struktur produksi jujur — genre Ads TIDAK boleh menjual transaksi.
  const genre = ujiCepatGenre(k);
  if (!genre.lolos) gagal.push({ no: 10, sebab: genre.sebab.join("; ") });

  if (k.why_stop.trim().length < 10 || !k.mechanic.trim()) {
    gagal.push({ no: 12, sebab: "why_stop/mechanic kosong — kalau tidak bisa dijelaskan kenapa orang berhenti, idenya belum ada" });
  }

  return { gagal, belumDiuji };
}
