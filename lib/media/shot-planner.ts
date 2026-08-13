// Shot planner: pecah skrip 15 dtk menjadi 2 shot hands-only (~8 dtk per shot,
// model video umumnya <=12 dtk/klip — SRS T1). Foto produk asli pengguna
// dipakai sebagai image reference (aturan keras).
//
// HANDS-ONLY (fix isu wajah tak diminta): framing eksplisit "hands and forearms
// only, face NOT visible" di prompt SEMUA kategori + negative per-format
// ("no face, no visible face, no head in frame, ...") — menggantikan asumsi
// lama "no face distortion" yang justru menganggap wajah ada.
//
// KONSERVASI IDENTITAS PRODUK (fix produk berganti antar shot): kedua shot
// membawa instruksi identitas eksplisit + deskripsi visual produk opsional
// (product_visual_desc dari user). API ModelArk TIDAK punya parameter image
// strength/weight (diverifikasi di daftar parameter resmi create task) —
// mitigasi lewat prompt + QC-03.
//
// Tier bersuara (audio embedded): dialog diletakkan DALAM tanda kutip, instruksi
// jeda/intonasi DI LUAR tanda kutip, plus arahan "enunciate clearly".
//
// CATATAN EVIDENSI (2026-08-06, MODEL FYP 1.0 ckpt9-n316): arsitektur 2-shot
// dengan shot panjang + produk tampil sejak detik pertama SEJALAN dengan
// koefisien video pemenang (total_cuts -0.19, avg_shot_duration +0.17,
// product_first_appears_sec -0.18, cuts_in_first_3s -0.09). JANGAN menambah
// jumlah cut/rapid-cut atas nama "pacing" tanpa bukti baru dari model.

import type { VisualSpec, ShotSpec, QualityTier } from "../providers/types";
import type { CreatorCategory } from "../personas";
import type { SegmentDraft } from "../script-engine/templates";
import { CATEGORY_NOUN, CATEGORY_PAIN } from "../config/hooks";
import { hargaTerbilang } from "../script-engine/terbilang";
import { MANDATORY_NEGATIVE_PROMPT } from "../config/compliance";
import { ugcRolesFor } from "./ugc-template-roles";
import { isServiceLike } from "../config/hooks";
import { getRecordingStyle, type StyleFormat } from "./recording-styles";

export interface ShotPlanInput {
  jobId: string;
  durationSec: number;
  segments: SegmentDraft[];
  category: CreatorCategory;
  productName: string;
  productCategory: string;
  /** Deskripsi visual produk dari user (opsional) — memperkuat konsistensi identitas. */
  productVisualDesc?: string | null;
  /** M8 (dashboard brand): arahan kreatif bebas dari brand, disuntik ke tiap shot. */
  brandBrief?: string | null;
  imageRefPath: string; // foto produk asli (absolut)
  /** Foto produk ke-2..5 (absolut) — referensi identitas tambahan untuk model
   * yang mendukung r2v (Seedance 2.0 / tier bersuara). Lihat VisualSpec. */
  extraImageRefPaths?: string[];
  qualityTier: QualityTier;
  format?: "hands_only" | "vo_broll" | "talking_head" | "tvc" | "ads";
  /** Level hook S3 (lima level sejak 2026-08-11). Yang mengubah VISUAL hanya
   * dua level teratas: "agak gila" memberi pembuka lembut, "gila" pembuka
   * pattern-interrupt PRODUCT-SAFE (gerakan kamera dramatis + produk naik cepat
   * ke tengah frame) — BUKAN adegan bahaya/kacau: aksi ekstrem berisiko kena
   * moderasi platform, merusak konsistensi identitas produk (QC-03), dan
   * silhouette guard QC-02. Berani = teks saja, visual tidak berubah. */
  hookLevel?: import("../config/hooks").HookLevel;
  /** Multi-shot: jumlah scene yang diminta user (2-6). Tanpa ini, jumlahnya
   * diturunkan dari durasi & format seperti sebelumnya. */
  shotCountOverride?: number;
  /** Rasio aspek. Lihat catatan "TERBUKTI hanya 9:16" di VisualSpec. */
  ratio?: string;
  /** TVC tanpa orang: seluruh beat jadi makro produk, tekstur, dan packshot.
   * Suara tetap dari persona — yang dimatikan hanya kehadirannya di layar. */
  noModel?: boolean;
  /** Rute TVC: "luxury" (makro/mekanisme), "reallife" (sehari penuh), atau
   * "comedy" (parodi/pattern-break — TVC 3 "Tersangka Glowing"). */
  /** Rute TVC. "fabric" dan "intimate" ditambahkan 2026-08-12 dari dua TVC
   *  produksi Brian yang lolos (TVC 5 & 6); empat lainnya dia buang sendiri
   *  karena jelek, jadi hanya dua ini yang jadi acuan. */
  tvcRoute?: "luxury" | "reallife" | "comedy" | "fabric" | "intimate";
  /** Id template UGC affiliate (T01..T12). NULL = perilaku lama, beat generik.
   *
   * Inilah yang membuat template mengubah VIDEONYA, bukan cuma labelnya:
   * tanpa ini "Bedah Fitur" (4 makro berturut-turut) dan "Klaim + Bahan Aktif"
   * (kamera nyaris tidak pindah) menghasilkan struktur shot yang identik.
   * Tabelnya di lib/media/ugc-template-roles.ts. */
  ugcTemplate?: string | null;
  /** Gaya rekam (lib/media/recording-styles.ts) — sumbu "bagaimana direkam",
   *  terpisah dari "apa yang dijual". NULL / "standar" = perilaku lama persis.
   *
   *  Hanya berlaku untuk hands_only / talking_head / ads. TVC SENGAJA tidak
   *  ikut: TVC punya TVC_STYLE_LOCK demi konsistensi antar-shot, dan menimpanya
   *  membatalkan alasan kunci itu ada. */
  recordStyle?: string | null;
}

const HANDS_ONLY_FRAMING =
  "hands and forearms only, face and body NOT visible, cropped below shoulders, " +
  "close-up POV hands-only shot, camera focused on hands and product";

/** Kunci JUMLAH TANGAN untuk hands_only.
 *
 *  Sebelumnya format ini tidak punya batasan jumlah tangan sama sekali:
 *  SINGLE_SUBJECT_LOCK (yang memuat "tepat dua tangan") sengaja TIDAK dipasang
 *  di hands_only karena isinya bicara tentang orang dan wajah. Akibatnya
 *  satu-satunya format yang seluruh isinya adalah TANGAN justru satu-satunya
 *  yang tidak pernah diberi tahu ada berapa tangan yang boleh muncul.
 *
 *  Terukur 2026-08-13: DUA template hands_only pertama yang dirender
 *  (racun-checkout dan unboxing) sama-sama keluar dengan TIGA telapak di beat
 *  yang sama — satu menekan pompa, dua menadah di bawah. Bukan kebetulan:
 *  aksinya memang butuh dua tangan, dan tanpa batas, model menambah satu lagi
 *  supaya "menadah" terlihat lebih penuh.
 *
 *  Ditulis POSITIF lebih dulu, sesuai pelajaran di dokumen produksi Brian:
 *  yang menyelesaikan tangan hantu adalah pernyataan tentang apa yang ADA,
 *  bukan daftar larangan. */
const HANDS_ONLY_HAND_LOCK =
  "Exactly two hands are visible in the entire frame, and both belong to the same single person. " +
  "The SAME hand that holds the bottle also operates it — it is never handed over, and no other hand " +
  "steadies it. The second hand does only one thing: receive the product or show the result. " +
  "No third hand ever enters the frame, from any edge, at any moment. ";

const HANDS_ONLY_NEGATIVE =
  "no face, no visible face, no head in frame, no person facing camera, " +
  "no third hand, no extra hands, no second pair of hands, no disembodied hand entering frame";

// Wajah AI (v1, 2026-08-03): opposite intent of hands_only — face IS the
// point, framed like a normal UGC talking-head selfie, not hands-only POV.
// + estetika candid (2026-08-07, dari referensi visual Brian — grid UGC yang
// menang terlihat seperti foto iPhone sehari-hari: cahaya jendela natural,
// warna kalem, setting rumah yang hidup — BUKAN studio terang/polished).
// TVC = IKLAN TV (koreksi Brian 2026-08-11: "TVC itu kan kayak iklan di tv2").
// Versi pertama saya keliru menulisnya sebagai "UGC yang terstruktur" —
// hand-held, latar sehari-hari. Itu salah kategori: TVC adalah produksi
// terkontrol. Kamera stabil di tripod/slider, pencahayaan sinematik yang
// ditata, warna rapi dan konsisten, set yang dirancang. Yang dipinjam dari
// referensi Brooks hanyalah STRUKTUR beat-nya, bukan tampilannya.
const TVC_FRAMING =
  "high-end television commercial cinematography, shot on a cinema camera, controlled studio-grade " +
  "lighting with deliberate key and rim light, smooth stabilised camera movement on a slider or gimbal, " +
  "shallow cinematic depth of field, polished colour grade, immaculate art-directed set — a broadcast " +
  "commercial, never a phone-shot or hand-held clip";

// AI UGC Ads: iklan untuk APP, JASA, atau TOKO — bukan barang fisik.
//
// Perbedaan yang menentukan: tidak ada produk yang harus tampil identik di
// setiap shot. Karena itu format ini TIDAK memakai IDENTITY_INSTRUCTION sama
// sekali; memaksa "kemasan yang sama persis" pada bisnis yang tidak punya
// kemasan hanya menghasilkan benda karangan di tangan presenter.
const ADS_FRAMING =
  "face and upper body clearly visible, a real person speaking straight to camera with genuine energy, " +
  "front-facing phone-camera angle, natural daylight, muted true-to-life colour, filmed somewhere that " +
  "fits the business being talked about — a shop counter, a desk, a café table — never a blank studio";

// KUNCI SUBJEK TUNGGAL. Ditemukan 2026-08-13 dari render sungguhan: shot
// PENUTUP TVC 30 detik keluar dengan DUA perempuan dan EMPAT tangan
// mengelilingi produk — hal terakhir yang dilihat penonton. Ini persis yang
// dokumen produksi Brian sebut "risiko #1".
//
// Tidak ada satu pun yang menahannya: QC-02 (silhouette) masih stub, tidak ada
// pemeriksaan jumlah orang di mana pun, negative prompt bawaan cuma melarang
// teks, dan format TVC tidak punya larangan anatomi sama sekali (talking_head
// punya, TVC tidak).
//
// DITULIS POSITIF, bukan sebagai larangan. Ini bukan selera: dokumen Brian
// mencatat klip yang sama dibuat TIGA KALI, dan yang akhirnya menyelesaikan
// tangan hantu adalah mengubah larangan negatif jadi pernyataan positif
// ("dia punya tepat dua tangan, keduanya terlihat jelas dan menempel wajar
// pada lengannya"). Larangan tetap dipasang sebagai jaring kedua.
const SINGLE_SUBJECT_LOCK =
  "EXACTLY ONE person is present in the entire frame from start to finish — no one else enters, " +
  "and no second version of the same person ever appears. That one person has exactly two hands, " +
  "both clearly visible and naturally attached to her own arms, and only those two hands ever touch " +
  "the product. ";

/** Berapa orang yang BOLEH ada di frame untuk konfigurasi ini.
 *
 *  SATU sumber kebenaran, dipakai dua kali: di sini untuk memasang kunci
 *  subjek di prompt, dan di QC-11 untuk memeriksa hasilnya. Kalau angkanya
 *  ditulis dua kali, cepat atau lambat prompt dan pemeriksanya tidak lagi
 *  bicara tentang aturan yang sama — dan pemeriksa yang salah lebih buruk
 *  daripada tidak ada pemeriksa, karena ia menolak video yang benar. */
export function maksOrangPerFrame(input: {
  format?: string;
  noModel?: boolean;
  tvcRoute?: string;
}): number {
  if (input.format === "hands_only") return 0; // wajah dilarang sama sekali
  if (input.noModel) return 0; // TVC tanpa orang: makro produk saja
  if (input.tvcRoute === "comedy") return 2; // rute ini SENGAJA dua tokoh
  return 1;
}

const SINGLE_SUBJECT_NEGATIVE =
  "no second person, no duplicate of the same person, no twin, no extra people in frame, " +
  "no extra hands, no third hand, no disembodied hands, exactly two hands";

const TALKING_HEAD_FRAMING =
  "face and upper body clearly visible, warm friendly UGC presenter speaking directly to camera, " +
  "front-facing selfie-style angle, natural phone camera look, soft natural indoor daylight, " +
  "muted authentic colors, candid everyday vibe in a lived-in Indonesian home";

// r4 (Brian, screenshot slop kemasan 2026-08-07): + kemasan harus utuh dan
// masuk akal secara fisik — insiden pipet/tutup ganda pada botol serum.
// r8 (Brian 2026-08-07, screenshot label "BNIGHTENING"/"CASSULE"/baris kecil
// gibberish): nama besar/wordmark biasanya benar, tapi teks KECIL di bawahnya
// nyaris selalu gagal dirender presisi oleh model video — ini limitasi model,
// BUKAN kekurangan foto referensi (produk ini sudah pakai 2-3 foto). Fix:
// jangan minta SEMUA teks tajam (itu memancing model "mencoba" merender teks
// kecil dan gagal jadi huruf acak) — hanya wordmark besar yang wajib tajam;
// teks kecil diarahkan jadi blur alami (shallow depth-of-field macro), bukan
// tulisan tajam yang salah.
// r14 (Brian 2026-08-08, screenshot: "W" Wardah kepotong tepi frame + brand
// text jadi "Ampule" bukan "Ampoule") — kamera terlalu dekat/miring motong
// label, dan model kadang mengeja ulang kata alih-alih mereproduksi persis.
// TEKS KECIL DI LABEL: BELUM TERPECAHKAN, dan jangan diklaim beres.
//
// Diukur 2026-08-14 lewat review kreatif. Label produk keluar sebagai kata
// karangan yang BERUBAH antar shot dalam satu video: "Bright Slow 'ver Gel" ->
// "Shaw Slow 'w' Peer / 30ml / 45 oz" (45 oz untuk botol 30 ml — mustahil).
//
// Percobaan 1 (versi lama): minta nama merek tajam DAN teks kecil "out of
// focus from shallow depth of field". Mustahil secara optik — keduanya di
// bidang datar yang sama — jadi model mengarang di antaranya.
// Percobaan 2 (versi sekarang): berhenti mengklaim optik yang mustahil, minta
// baris kecil terbaca sebagai TEKSTUR cetak tanpa huruf terurai, plus larangan
// eksplisit mengarang kata dan angka volume. DIRENDER ULANG DAN DIUKUR:
// hasilnya "Slow Slow W Gel" / "Show Show W Faer" / "50 m | 16 oL" — masih
// mengarang, masih berubah antar shot.
//
// Kesimpulan jujur: model ini TIDAK BISA merender teks kecil produk dengan
// benar, dan dua putaran prompt tidak mengubahnya. Jalan keluar yang masuk
// akal bukan percobaan ketiga, melainkan mengubah komposisi — misalnya
// packshot penutup memakai FOTO ASLI brand (label dijamin benar), atau produk
// diambil cukup jauh sehingga baris kecil tidak pernah bisa terbaca.
// Keputusan itu mengubah tampilan, jadi menunggu Brian.
//
// Versi sekarang tetap dipertahankan: ia tidak memperbaiki, tapi ia menghapus
// permintaan yang mustahil dan melarang angka volume karangan.
const IDENTITY_INSTRUCTION =
  "the exact same product from the reference image, identical packaging, identical label, " +
  "do not redesign or replace the product, the packaging stays physically intact and correct " +
  "(one cap, one dropper, nothing floating or duplicated). The ENTIRE bottle and its full label " +
  "stay completely inside the frame at all times, with visible margin on every side — never cropped " +
  "or cut off by the frame edges, camera framed wide enough that no part of the bottle ever leaves " +
  "frame. The large bold brand name on the label stays sharp, steady and perfectly legible the whole " +
  "time, reproduced with the EXACT same letters and spelling as the reference image (do not alter, " +
  "add, drop, or misspell any letter). The smaller lines printed below the brand name read as fine " +
  "printed TEXTURE at this distance — visible as faint grey lines of print, with no individual " +
  "letters or words resolved anywhere. Never render invented words, invented ingredient names, or " +
  "invented volume figures on the label";

// Aksi demo per KATEGORI PRODUK (2026-08-07, dipelajari dari akun UGC tim +
// referensi visual Brian): "memegang kemasan" hanya benar untuk sebagian
// kategori — fashion harus TRY-ON (baju dipakai/ditempel ke badan), beauty
// harus swatch/aplikasi, food harus dicicipi. Konten UGC yang menang terlihat
// seperti orang sungguhan MEMAKAI produk, bukan model memegang paket.
const DEMO_ACTION: Record<string, string> = {
  // beauty: swatch di PUNGGUNG TANGAN — bukan wajah (r3, temuan Brian: pegang
  // produk + sentuh muka memicu tangan ganda / AI slop anatomi).
  beauty: "dropping or swatching a little of the product onto the BACK of her other hand to show its texture, both hands clearly accounted for",
  // r17 (Brian 2026-08-09, "ini kan bukan skin care" — shower gel/body wash
  // salah kalau di-demo kayak serum wajah/leave-on). Body wash = dipompa ke
  // telapak tangan sampai berbusa, bukan diteteskan ke punggung tangan.
  body_care: "pumping a dollop of the product into her open palm and rubbing both palms together to work up a rich lather/foam, showing the texture and bubbles",
  fashion: "wearing the garment or holding it against her body, showing the fit and fabric drape like a quick mirror check",
  muslim_fashion: "showing the hijab worn, adjusting the drape to show the fabric and how it frames the face",
  food: "opening it and tasting it with a genuine delighted reaction",
  kitchen: "using the tool naturally on a kitchen counter",
  home: "using the item naturally in a lived-in home setting",
  gadget: "using the gadget hands-on, showing its screen or main feature working",
  kids: "showing playfully how the item is used",
  default: "demonstrating the product in use",
};

// Pembuka pattern-interrupt level GILA (hanya shot 1). Energi dari GERAKAN
// KAMERA + kecepatan — subjek dan framing format tetap dipatuhi (hands-only
// tetap tanpa wajah, identitas produk tetap terkunci).
const CRAZY_OPENER: Record<"hands_only" | "talking_head", string> = {
  hands_only:
    "HIGH-ENERGY OPENING: the shot starts with a fast dramatic camera push-in as the hands sweep the product " +
    "up into center frame in one quick confident motion, slight playful camera whip, energetic start. ",
  talking_head:
    "HIGH-ENERGY OPENING: the presenter pops into frame with a fast dramatic camera push-in, wide surprised " +
    "expressive reaction, immediately holding the product up to the lens, energetic start. ",
};

/** Shot terakhir? Dipakai beat iklan jasa untuk menutup dengan ajakan. */
function isLastShot(i: number, total: number): boolean { return i === total - 1; }

const MIN_SHOT_SEC = 4;

export function planShots(input: ShotPlanInput): VisualSpec {
  // Jumlah shot: batas keras BytePlus 2-15 dtk/klip (lihat byteplus.ts
  // createTask) → satu shot per 15 dtk.
  //
  // WAJAH AI = SESEDIKIT MUNGKIN SHOT (2026-08-07, insiden produksi render
  // Wajah AI pertama Brian): tiap shot adalah generate TERPISAH, dan model
  // tidak menjamin identitas presenter antar generate → video 15 dtk yang
  // dipecah 2 shot menghasilkan DUA KARAKTER BERBEDA. 15 dtk kini SATU shot
  // utuh (satu generate = satu wajah, satu suara — mustahil ganti karakter).
  // hands_only tetap minimal 2 shot (variasi visual; tangan tidak punya
  // masalah identitas wajah — perilaku lama teruji di produksi).
  const format = input.format ?? "hands_only";
  // TVC dipecah per MODUL ~5 detik, bukan per batas teknis 15 detik.
  // Framework TVC menuntut informasi baru tiap 4-6 detik (15 dtk = 3-5 shot,
  // 30 dtk = 5-7 modul); satu shot 15 detik melanggar itu dan menghasilkan
  // adegan yang menggantung. Biaya provider dihitung PER DETIK video
  // (byteplus estimateCost menjumlahkan durasi shot), jadi 6x5 dtk sama
  // mahalnya dengan 2x15 dtk — memecah adegan tidak menambah ongkos.
  // Batas keras dari provider: mode referensi menolak durasi < 4 detik, dan
  // BytePlus membulatkan naik — 6 shot dalam 15 detik berarti 2,5 detik per
  // shot, dipanjangkan jadi 4, dan videonya jadi 24 detik padahal user minta
  // 15. Jadi jumlah shot HARUS dibatasi durasi, bukan cuma dibatasi 2-6.
  const maxShotsForDuration = Math.max(1, Math.floor(input.durationSec / MIN_SHOT_SEC));
  const requested = input.shotCountOverride
    ? Math.min(Math.max(2, Math.round(input.shotCountOverride)), 6, maxShotsForDuration)
    : null;
  const numShots = requested !== null ? requested : format === "tvc"
    ? Math.max(3, Math.round(input.durationSec / 5))
    : format === "talking_head"
      ? Math.max(1, Math.ceil(input.durationSec / 15))
      : Math.max(2, Math.ceil(input.durationSec / 15));
  // r16 (Brian 2026-08-08: "tidak ada lagi foto real produk... di video
  // manapun" — "product proof insert" DIHAPUS TOTAL, semua format). Video
  // 100% AI-generated selalu, tanpa sisipan foto statis di ujung.
  const perShot = input.durationSec / numShots;
  const tier = input.qualityTier;
  const withAudio = tier !== "silent_caption";
  // r7 (Brian 2026-08-07): "presenter/lipsync jual Super HQ 80rb-an, sisanya
  // video+VO mulut nggak lipsync" — Wajah AI + Super HQ = SATU-SATUNYA
  // kombinasi berlip-sync sungguhan (audio embedded asli dipertahankan oleh
  // worker, bukan diganti Gemini TTS) -> prompt di sini boleh minta presenter
  // BENAR-BENAR bicara sinkron kata. Semua kombinasi lain = gaya voice-over
  // (r6: presenter tidak "bicara", mayoritas cutaway) karena akan diucap
  // ulang oleh Gemini TTS yang tak pernah sinkron ke gerak mulut asli.
  const lipSyncPresenter = format === "talking_head" && tier === "super_hq";

  const segText = (role: string) => input.segments.find((s) => s.role === role)?.text ?? "";
  const noun = CATEGORY_NOUN[input.productCategory] ?? CATEGORY_NOUN.default;
  const pain = CATEGORY_PAIN[input.productCategory] ?? CATEGORY_PAIN.default;

  // Deskripsi produk untuk konsistensi: dari user bila ada, selalu + instruksi identitas.
  const productDesc = input.productVisualDesc?.trim()
    ? `The product is ${input.productVisualDesc.trim()}. `
    : "";

  // M8: arahan kreatif brand. Dipotong 400 char — ini teks bebas dari user,
  // brief kepanjangan bisa menenggelamkan instruksi shot kita sendiri di
  // prompt (model memberi bobot pada keseluruhan teks, bukan cuma bagian
  // akhir). Ditaruh SETELAH instruksi teknis supaya tidak menimpa aturan
  // framing/identitas produk yang sudah terbukti.
  const brandBrief = input.brandBrief?.trim()
    ? `Brand direction: ${input.brandBrief.trim().slice(0, 400)}. `
    : "";

  // Dialog per shot (tier bersuara): 1 shot (Wajah AI 15 dtk) = seluruh skrip
  // dalam satu tarikan; 2 shot = [hook+demo] lalu [cta] (perilaku lama, tak
  // berubah). >=3 shot (45 dtk) = 1 segmen penuh per shot — pas karena tiap
  // shot sudah 15 dtk penuh, gak perlu digabung lagi.
  const dialogueForShot = (i: number): string[] =>
    // TVC dipecah jadi 3-6 modul, jadi tangga "hook / demo / sisanya CTA" di
    // bawah tidak bisa dipakai: shot 3,4,5 semuanya akan kebagian kalimat
    // penutup dan mengulang CTA empat kali. Segmen skrip punya start/end
    // sungguhan, jadi tiap shot mengambil kalimat yang jendela waktunya
    // memang beririsan dengan shot itu. Shot tanpa irisan sengaja dibiarkan
    // tanpa dialog — beat visual murni, dan VO final tetap dirakit utuh oleh
    // Gemini TTS di atas video, bukan dari teks per-shot ini.
    format === "tvc"
      ? input.segments.filter((sg) => sg.end > i * perShot && sg.start < (i + 1) * perShot).map((sg) => sg.text)
      : numShots === 1
      ? [segText("hook"), segText("demo"), segText("cta")]
      : numShots >= 3
        ? i === 0 ? [segText("hook")] : i === 1 ? [segText("demo")] : [segText("cta")]
        : i === 0 ? [segText("hook"), segText("demo")] : [segText("cta")];

  // --- TVC (M9, 2026-08-11) ---
  // Iklan brand berstruktur, bukan UGC mengalir. Peta beat mengikuti dua
  // sumber yang sepakat: seedance-tvc-director (0-3 hook, lalu world ->
  // product trigger -> bukti -> pembayaran emosi -> penutup brand) dan
  // contoh Brooks Glycerin Max dari Brian (hook / reveal / on-use / demo /
  // reaction / hero+CTA).
  //
  // Aturan yang sengaja ditegakkan di sini:
  // - Frame pertama SUDAH bergerak. Model cenderung memanjangkan "pose diam"
  //   sampai 2 detik kalau dibiarkan, dan itu membunuh hook.
  // - Produk tampak depan penuh (packshot) hanya di segmen TERAKHIR — kalau
  //   muncul lebih awal, model menggabungkannya jadi satu freeze panjang.
  // - Logo, harga, CTA, endboard TIDAK PERNAH ditulis di prompt: teks di
  //   dalam video selalu berantakan (riwayat panjang QC-10 kita), jadi itu
  //   urusan overlay ffmpeg setelah render.
  // Beat map TVC. Perannya mengikuti framework seedance-tvc-director
  // (hook / dunia / pemicu / bukti / reaksi / hero+packshot) tapi ditulis
  // sebagai PERAN, bukan tabel timecode mati, supaya tetap benar di 15, 30,
  // maupun 45 detik. Shot pertama selalu HOOK, shot terakhir selalu HERO
  // (packshot tidak pernah muncul sebelum bagian akhir), sisanya diisi
  // berputar dari peran tengah.
  // Tiap beat membawa ARAHAN KAMERA sendiri dan LARANGAN GERAK sendiri.
  //
  // Dipelajari dari template "THE DROP" yang Brian kirim (2026-08-11): di
  // sana tiap modul menyebut gerak kameranya secara spesifik ("slow lateral
  // tracking", "very slow dolly-in", "locks off into a static hero packshot")
  // DAN menyebut apa yang tidak boleh terjadi ("no camera shake", "no jitter",
  // "no head bobbing"). Instruksi umum seperti "satu gerakan kamera" ternyata
  // jauh lebih lemah daripada menyebut geraknya — model butuh diberi tahu
  // gerak MANA, bukan sekadar berapa banyak.
  // Rute REAL-LIFE ("SEHARIAN"): produk diuji hari yang nyata, bukan dipuja
  // dalam makro. Tiap beat membawa TEMPO-nya sendiri — pelajaran baru dari
  // template kedua: TVC 1 hanya menyebut kamera, TVC 2 menyebut kecepatan
  // ("fast, on-beat" vs "half-speed relaxed"), dan tanpa itu semua beat
  // keluar dengan ritme yang sama datar.
  const TVC_REALLIFE_ROLES: { role: string; camera: string; avoid: string; pace: string }[] = [
    {
      role: `the first thing that tests the product — harsh midday heat outdoors, the person moving through it while the product visibly holds`,
      camera: `smooth tracking backward in front of them`,
      avoid: `no jitter, controlled shake only`,
      pace: `upbeat, purposeful`,
    },
    {
      role: `the second test, indoors and quieter — dry cold air, long hours, the product still holding where it matters`,
      camera: `steady push-in ending tight on the detail`,
      avoid: `no abrupt cuts, no drifting focus`,
      pace: `medium, settled`,
    },
    {
      role: `the third test at the end of the day — late light, dust, tiredness everywhere except in how the product performs`,
      camera: `static three-quarter close-up with a gentle natural sway`,
      avoid: `no exaggerated motion`,
      pace: `half-speed, relaxed`,
    },
    {
      role: `the realisation: catching sight of the result unexpectedly and reacting to it, a clear beat of pleasant surprise`,
      camera: `static frame holding on the reaction`,
      avoid: `no head bobbing, the surprise must read clearly`,
      pace: `snappy, not slow or atmospheric`,
    },
  ];


  // Rute KAIN (TVC 5 "KAIN YANG IKUT LARI", produksi Brian 12 Agustus 2026).
  //
  // Yang dijual BUKAN bajunya sebagai benda, tapi bajunya SAAT DIPAKAI
  // BERGERAK. Premisnya satu kalimat: baju bagus bukan yang cantik saat diam,
  // tapi yang tetap rapi saat kamu bergerak.
  //
  // DUA HAL DIBUANG DARI VERSI FINAL, dan keduanya jadi aturan di sini:
  // 1. Adegan koridor berjalan santai dibuang — Brian: "terasa seperti
  //    lookbook", persis yang harus dihindari kategori fashion. Jadi tiap beat
  //    di bawah menuntut gerakan yang punya SEBAB (menuruni tangga, menurunkan
  //    lengan), bukan berjalan untuk dipandangi.
  // 2. Packshot baju di hanger dibuang — Brian: "mematikan premis iklan:
  //    konsepnya kain yang bergerak, tapi penutupnya kain diam tak dipakai
  //    siapa pun". Penutup rute ini ditangani terpisah di bawah.
  const TVC_FABRIC_ROLES: { role: string; camera: string; avoid: string; pace: string }[] = [
    {
      role: `movement with a REASON, not a walk for the camera — descending stairs quickly, one hand light on the rail, the hem and fabric lifting and trailing with each step`,
      camera: `smooth tracking alongside the descent`,
      avoid: `no posing, no lookbook stroll, no pausing to be admired`,
      pace: `upbeat, purposeful`,
    },
    {
      role: `the garment correcting ITSELF after a real action — an arm raised to write or reach, then lowered, and the sleeve and body of the garment fall back into a clean line by themselves with no adjustment by hand`,
      camera: `steady medium shot, no movement`,
      avoid: `no hand smoothing the fabric, no visible adjusting`,
      pace: `calm, confident`,
    },
    {
      role: `extreme macro of the fabric itself: the weave breathes and lifts into a soft suspended wave, daylight glowing through the thinnest folds until it turns translucent`,
      camera: `drifting very slowly across the surface`,
      avoid: `no cuts, no snapping motion, nothing rigid`,
      pace: `slow, tactile, sensual`,
    },
    {
      role: `warm backlight and wind: the garment lifts and trails around the wearer while she stays composed, the whole silhouette readable head to toe`,
      camera: `slow steady approach`,
      avoid: `no cropping the garment, the full silhouette must stay in frame`,
      pace: `unhurried, cinematic`,
    },
  ];

  // Rute INTIM (TVC 6 "JAM TIGA PAGI", produksi Brian 12 Agustus 2026).
  //
  // Kategori bayi & ibu. Yang dijual ketenangan di jam yang tidak ada orang
  // lain melihatnya — bukan fitur produk. Produk baru muncul di tengah, dan
  // muncul sebagai bagian dari rutinitas, bukan sebagai pahlawan.
  //
  // TIGA ATURAN KERAS, semuanya dari kegagalan nyata di produksi Brian:
  // 1. WAJAH BAYI TIDAK PERNAH TAMPIL — hanya punggung kepala, tangan mungil,
  //    atau siluet. Ini aturan produksi, bukan selera.
  // 2. Anatomi ditulis POSITIF ("dia punya tepat dua tangan, keduanya terlihat
  //    jelas dan menempel wajar pada lengannya"), bukan negatif. Klip ini tiga
  //    kali dibuat: versi negatif menghasilkan TANGAN HANTU di detik 6.
  // 3. Kamera DIKUNCI DIAM di shot yang melibatkan menggendong. Kamera yang
  //    bergerak sambil model menggendong bayi adalah dua hal sulit sekaligus.
  const TVC_INTIMATE_ROLES: { role: string; camera: string; avoid: string; pace: string }[] = [
    {
      role: `stillness first — a dim room lit only by one small warm nightlight, nothing moving, then the smallest sign of someone waking: eyes opening, exhausted but instantly alert`,
      camera: `drifting very gently across the room`,
      avoid: `no bright light, no sudden movement, no music-video energy`,
      pace: `slow, quiet, intimate`,
    },
    {
      role: `the careful act: lifting and holding with visibly correct, safe handling — she has exactly two hands, both clearly visible and naturally attached to her own arms throughout the entire shot, one hand supporting behind the head and neck, the other arm supporting the back`,
      camera: `completely static and locked off, hands resting calmly before any movement begins`,
      avoid: `never show the infant's face — only the back of the head; no extra limbs, no hands entering frame from outside`,
      pace: `slow and deliberate`,
    },
    {
      role: `rhythm: a steady gentle repeated motion — swaying, patting — the kind that only works because it is boring, only the back of the small head visible`,
      camera: `moving in slowly toward the repeating hand`,
      avoid: `never show the infant's face; no jerky motion`,
      pace: `hypnotic, tender`,
    },
    {
      role: `the product enters the routine quietly: lifted from the bedside surface, opened, a small amount taken onto a fingertip — an ordinary step, not a reveal`,
      camera: `close and steady on the product`,
      avoid: `no dramatic lighting change, no hero framing`,
      pace: `careful, gentle`,
    },
  ];

  // Rute KOMEDI (TVC 3 "TERSANGKA GLOWING"): produk tidak dipuja, produk jadi
  // PUNCHLINE. Strukturnya tuduhan -> bukti -> jawaban -> pembalikan, dan yang
  // menjual adalah pembalikan itu: si penuduh diam-diam ikut memotret
  // produknya.
  //
  // SENGAJA DIRAMPINGKAN JADI DUA ORANG. Referensinya memakai enam orang
  // (tersangka + penuduh + empat juri), dan production log-nya sendiri menyebut
  // cast berubah wajah/posisi antar modul sebagai "risiko #1" — itu terjadi
  // PADAHAL mereka punya start/end frame dan master cast reference. Kita tidak
  // punya keduanya: satu shot = satu generate terpisah, dan penjaga identitas
  // (QC-03) justru menghukum wajah yang berubah. Meminta empat juri di sini
  // bukan ambisius, itu memesan kegagalan. Dua orang sudah cukup membawa
  // seluruh leluconnya.
  const TVC_COMEDY_ROLES: { role: string; camera: string; avoid: string; pace: string }[] = [
    {
      role: `the accusation: a second person points at the first with theatrical, playful suspicion, as if this were a courtroom and the product's result were evidence of something — the tone is sitcom, likeable and absurd, never menacing`,
      camera: `slow push-in from wide to medium on the accuser`,
      avoid: `maximum two people in frame and only one of them moving at a time, the room keeps exactly the same furniture, shape and layout as the other shots`,
      pace: `snappy, comic timing`,
    },
    {
      role: `the accused stays perfectly calm and unbothered while being accused, the contrast between the drama around them and their composure IS the joke`,
      camera: `static medium shot holding on the calm reaction`,
      avoid: `no exaggerated mugging, the calm must read as confidence, same room and same furniture as before`,
      pace: `held, deadpan`,
    },
    {
      role: `the answer: the accused calmly produces the product and places it down in the centre of frame in smooth slow motion, every other head turning to follow it — the music-stop moment`,
      camera: `slow dolly-in ending on the product as hero`,
      avoid: `no clutter around the product, nothing else moves while it settles, same room and same furniture`,
      pace: `reverent, comic gravitas`,
    },
    {
      role: `the reversal: the accuser is caught sheepishly photographing the product with their phone, glancing around to check whether anyone saw — the accusation collapses into wanting it too`,
      camera: `quick lateral pan then settle on the guilty expression`,
      avoid: `keep it warm and self-deprecating, same room and same furniture as the other shots`,
      pace: `quick, then a beat of stillness`,
    },
  ];

  const TVC_MIDDLE_ROLES: { role: string; camera: string; avoid: string; pace: string }[] = [
    {
      role: `establishes the world of the brand — the setting, the person it is for, and why this moment matters, staged and lit like a commercial`,
      camera: `slow lateral tracking across the scene`,
      avoid: `no jitter, no handheld sway`,
      pace: `unhurried, deliberate`,
    },
    {
      role: `the product enters the action deliberately: opened, poured, applied or switched on, with crisp material feedback captured in macro`,
      camera: `slow forward dolly moving closer to the action`,
      avoid: `no flicker, no sudden speed changes`,
      pace: `slow and continuous`,
    },
    {
      role: `the result the product produced, observed in a clean beauty-shot close-up — texture, finish or change, lit to be read instantly`,
      camera: `static frame with a subtle rack focus landing on the detail`,
      avoid: `no exaggerated motion, no focus hunting`,
      pace: `still, letting the detail be read`,
    },
    {
      role: `the payoff on the person: a directed, believable reaction caused by that result, framed as a portrait beat`,
      camera: `very slow dolly-in on the person`,
      avoid: `no head bobbing, no abrupt expression changes`,
      pace: `calm and intimate`,
    },
  ];

  // Varian tanpa model — cerminan modul M2/M3/M5 di template "THE DROP":
  // tekstur, mekanisme abstrak, lalu hasil yang diamati dekat. Tidak satu pun
  // menyebut orang, karena satu kata "person" saja sudah cukup memanggil
  // manusia ke frame yang seharusnya murni makro.
  const TVC_MIDDLE_ROLES_NO_MODEL: { role: string; camera: string; avoid: string; pace: string }[] = [
    {
      role: `the product's material in extreme macro — texture, viscosity, or surface catching the light, filling the frame`,
      camera: `slow lateral tracking across the surface`,
      avoid: `no people, no hands, no jitter`,
      pace: `unhurried, deliberate`,
    },
    {
      role: `an abstract visualisation of how it works: light, particles or structure suggesting the mechanism, dreamlike rather than literal`,
      camera: `slow forward dolly diving into the material`,
      avoid: `no people, no anatomy, no flicker`,
      pace: `slow and continuous`,
    },
    {
      role: `the result the product leaves behind, observed in a clean beauty-shot close-up, lit to be read instantly`,
      camera: `static frame with a subtle rack focus landing on the detail`,
      avoid: `no people, no exaggerated motion`,
      pace: `still, letting the detail be read`,
    },
    {
      role: `the product resting in an art-directed setting that suggests where it belongs, still the only subject in frame`,
      camera: `very slow push-in on the product`,
      avoid: `no people, no drift`,
      pace: `calm and composed`,
    },
  ];

  // Style-lock: kalimat penutup yang SAMA PERSIS di setiap shot.
  // Template referensi menegaskan jangan diubah antar modul — konsistensi
  // tampilan antar adegan justru datang dari kalimat yang tidak berubah ini,
  // bukan dari mendeskripsikan ulang gayanya dengan kata-kata berbeda tiap kali.
  // KUNCI GEOMETRI ikut di sini, dan itu pelajaran dari cacat nyata di TVC 3:
  // satu shot memakai meja lurus dan shot pasangannya meja bundar, jadi selama
  // lima detik modelnya memuaikan bentuk mejanya sendiri. Menyebut "ruangan dan
  // perabotnya sama persis" jauh lebih murah daripada menemukan meja meleleh
  // setelah rendernya dibayar.
  const TVC_STYLE_LOCK =
    `photorealistic, luxury commercial still, soft cinematic lighting, shallow depth of field, ` +
    `high detail texture, the room, its furniture and their exact shapes stay identical across every shot, ` +
    `nothing stretches or changes proportion, no text, no logo, no watermark`;
  // IDENTITY_INSTRUCTION ditulis untuk UGC dan memuat frasa "like a real phone
  // camera close-up". Di TVC itu bertabrakan dengan framing "never a phone-shot"
  // di kalimat yang sama, dan model akan menuruti salah satunya secara acak.
  // Aturan identitas produknya tetap sama persis — hanya alasan bokehnya yang
  // diganti ke lensa sinema.
  const TVC_IDENTITY = IDENTITY_INSTRUCTION.replace(
    "like a real phone camera close-up",
    "the way a cinema lens naturally renders at this focal depth"
  );
  // Mengembalikan teks BESERTA penanda ada-tidaknya orang, bukan teks saja.
  // Pemanggil butuh keduanya: kunci subjek tunggal tidak boleh dipasang pada
  // shot yang memang tanpa orang — itu persis kontradiksi yang menggandakan
  // orangnya. Menurunkan ulang penandanya di pemanggil berarti dua salinan
  // aturan yang sama, dan salinan kedua akan hanyut.
  const tvcBeat = (i: number): { teks: string; tanpaOrang: boolean } => {
    const from = Math.round(i * perShot);
    const to = Math.round((i + 1) * perShot);
    let role: string;
    let camera: string;
    let avoid: string;
    let pace: string;
    // Beat ini menampilkan orang atau tidak. DATA, bukan tebakan dari prosa.
    //
    // Ini akar cacat "dua perempuan di shot penutup" yang dua kali lolos:
    // beat penutup generik meminta PACKSHOT PRODUK SAJA ("the product
    // front-facing and centred... the packshot a brand would sign off on"),
    // tapi prompt tetap menambahkan "The same person, same face, same hair and
    // same outfit as the other shots" karena noModel bernilai false. Dua
    // perintah yang saling bertentangan dalam satu prompt, dan model
    // menyelesaikannya dengan komposisi simetris: orangnya DIGANDAKAN di kiri
    // dan kanan botol.
    //
    // Karena itu kunci subjek tunggal tidak pernah bisa menang di sana. Ia
    // bilang "tepat satu orang", beat bilang "tanpa orang", baris identitas
    // bilang "orang yang sama". Yang diminta memang tidak koheren — dan
    // memperkuat larangan tidak memperbaiki permintaan yang tidak koheren.
    // Terbukti: render kedua dengan kunci positif DAN negatif terpasang penuh
    // menghasilkan cacat yang sama persis, di detik yang sama.
    let tanpaOrang = input.noModel === true;
    // Rute dengan tabel sendiri memakai perannya SEJAK SHOT PERTAMA.
    //
    // Terukur di render bukti 2026-08-13: pembuka rute "fabric" yang
    // seharusnya "menuruni tangga, kain melayang" keluar sebagai botol di atas
    // meja, dan pembuka "intimate" yang seharusnya "kamar gelap jam 3 pagi"
    // keluar sama. Sebabnya bukan model — sebabnya `if (i === 0)` di bawah
    // memaksa SEMUA rute memakai hook generik "produk masuk ke frame", dan
    // tabel rutenya baru dipakai untuk shot tengah. Rute yang seluruh
    // premisnya adalah "produk BELUM muncul" jadi mustahil dijalankan.
    const tabelRute =
      input.tvcRoute === "fabric" ? TVC_FABRIC_ROLES
      : input.tvcRoute === "intimate" ? TVC_INTIMATE_ROLES
      : null;
    if (i === 0 && tabelRute && !input.noModel) {
      const m = tabelRute[0];
      role = m.role; camera = m.camera; avoid = m.avoid; pace = m.pace;
    } else if (i === 0) {
      role =
        `the opening hook — it starts ALREADY in motion, with "${input.productName}" arriving in frame. ` +
        `By the ${Math.min(3, to)}s mark the product reads clearly and something has visibly changed. ` +
        `No static hold, no slow logo push-in`;
      camera = `static macro with a slight tilt following the product`;
      avoid = `no camera shake, no whip pans`;
      pace = input.tvcRoute === "reallife" ? `fast, on-beat, no slow motion` : `unhurried, deliberate`;
    } else if (i === numShots - 1 && input.tvcRoute === "fabric") {
      // PENUTUP RUTE KAIN — sengaja BUKAN packshot.
      //
      // Brian membuang packshot tunik di hanger dari versi finalnya dengan
      // alasan yang telak: "mematikan premis iklan — konsepnya kain yang
      // bergerak, tapi penutupnya kain diam tak dipakai siapa pun". Penutup
      // generik kita adalah packshot produk diam di atas meja; menerapkannya
      // ke rute ini akan mengulang persis kesalahan yang sudah dia perbaiki.
      //
      // Penggantinya: bajunya tetap DIPAKAI dan tetap BERGERAK, lalu berhenti
      // dan jatuh rapi dengan sendirinya. Gerakan berhenti, produknya tidak
      // pernah jadi benda mati.
      role =
        `the closing shot — NOT a still packshot: the garment stays worn and in motion, ` +
        `walking toward camera in gentle slow motion with the fabric lifting and trailing, the whole garment ` +
        `visible head to toe, then coming to a stop so the fabric settles into a calm drape by itself`;
      camera = `slow steady approach, then locks off once she stops`;
      avoid = `never end on the garment hanging still on a hanger or laid flat — that kills the premise; do not crop the silhouette`;
      pace = `unhurried, cinematic`;
    } else if (i === numShots - 1) {
      // Packshot = PRODUK SAJA. Itu memang yang dilakukan TVC sungguhan di
      // lima detik terakhir, dan sekaligus menghapus prasyarat cacat
      // penggandaan: tidak ada orang untuk digandakan.
      tanpaOrang = true;
      role =
        `the hero shot: the product completely alone in frame, front-facing and centred on a clean, deliberately lit ` +
        `surface or seamless backdrop, filling roughly a third of frame — the packshot a brand would sign off on. ` +
        `No people, no hands, no body parts anywhere in the frame`;
      // Penutup dikunci diam. Referensi menyebutnya eksplisit ("hold the final
      // frame"), dan itu masuk akal: packshot yang masih bergeser di detik
      // terakhir membuat seluruh iklan terasa belum selesai.
      camera = `camera locks off into a static hero packshot and holds the final frame`;
      avoid = `completely stable ending, no drift, no residual motion`;
      pace = `calm and resolved`;
    } else {
      // Tanpa model mengalahkan rute: kalau tidak ada orang di layar, beat
      // "sehari penuh" yang seluruhnya tentang orang tidak bisa dipakai.
      const table = input.noModel
        ? TVC_MIDDLE_ROLES_NO_MODEL
        : input.tvcRoute === "reallife"
          ? TVC_REALLIFE_ROLES
          : input.tvcRoute === "comedy"
            ? TVC_COMEDY_ROLES
            : input.tvcRoute === "fabric"
              ? TVC_FABRIC_ROLES
              : input.tvcRoute === "intimate"
                ? TVC_INTIMATE_ROLES
                : TVC_MIDDLE_ROLES;
      const m = table[(i - 1) % table.length];
      role = m.role; camera = m.camera; avoid = m.avoid; pace = m.pace;
    }
    return { teks: (
      // TULANG CERITA. Arahan Brian 2026-08-11: "yang penting skenario dan
      // storytelling-nya clear". Sebelumnya tiap beat cuma menyebut FUNGSInya
      // (hook, bukti, hero) tanpa pernah menyebut apa yang BARU SAJA terjadi —
      // hasilnya 6 shot bagus yang tidak terasa satu cerita.
      //
      // Kedua template Brian melakukannya secara eksplisit: tiap modul
      // merujuk modul sebelumnya ("the same drop has just landed", "she has
      // walked several steps forward now"). Kalimat ini memberi model
      // konteks itu.
      `${i === 0
        ? `This is the OPENING shot of a continuous ${input.durationSec}-second story about "${input.productName}". `
        : i === numShots - 1
          ? `This is the FINAL shot, resolving everything the previous ${numShots - 1} shots built up. `
          : `This shot continues directly from the previous one — same world, same look, the story moving forward one step. `}` +
      `Beat ${i + 1} of ${numShots} in a broadcast television commercial (${from}-${to}s of ${input.durationSec}s): ${role}. ` +
      `Camera: ${camera}. Pace: ${pace}. ${avoid}. Lighting is designed, not found. ` +
      // Character-lock: pelajaran dari template kedua. Sekali orangnya
      // ditetapkan, deskripsinya TIDAK BOLEH berubah antar shot — itu yang
      // menjaga wajah tetap sama, bukan mendeskripsikan ulang orangnya dengan
      // kata berbeda di tiap beat. Hanya disebut bila memang ada orang.
      `${tanpaOrang ? `Not a single person appears in this shot — no face, no hands, no arms, no silhouette. ` : `The same person, same face, same hair and same outfit as the other shots. `}` +
      `${TVC_IDENTITY} ${TVC_STYLE_LOCK}`
    ), tanpaOrang };
  };

  const shots: ShotSpec[] = Array.from({ length: numShots }, (_, i) => {
    const isFirst = i === 0;
    // "Closing beat" cuma dipakai kalau shot terakhir BUKAN shot pertama juga
    // (numShots >= 3) — di 2-shot, shot kedua tetap "demonstrating" seperti
    // semula (perilaku lama tidak berubah).
    const isClosing = i === numShots - 1 && numShots >= 3;
    // Framing DI DEPAN prompt (posisi awal = penekanan lebih kuat): hands_only
    // melarang wajah, talking_head justru menekankan wajah terlihat.
    // FASHION = FULL BODY (2026-08-07, keputusan Brian): baju/hijab tidak bisa
    // dinilai dari close-up dada — presenter berdiri, outfit terlihat utuh.
    const fullBodyFashion = format === "talking_head" && (input.productCategory === "fashion" || input.productCategory === "muslim_fashion");
    // Gaya rekam menimpa framing bawaan — TAPI hanya kalau formatnya memang
    // cocok. Menerapkan "selfie" pada hands_only akan menaruh "face filling
    // the frame" tepat di sebelah HANDS_ONLY_NEGATIVE ("no face"): dua
    // perintah berlawanan dalam satu prompt, dan hasilnya render rusak yang
    // tetap dibayar penuh. Penyaringan ada di UI, penjagaan ada di sini —
    // dua-duanya, karena yang di UI bisa dilewati lewat panggilan API.
    const gaya = getRecordingStyle(input.recordStyle);
    const gayaBerlaku = gaya && gaya.framing && gaya.formats.includes(format as StyleFormat) ? gaya : null;
    const framing = gayaBerlaku
      ? `${gayaBerlaku.framing}. `
      : format === "tvc"
      ? `${TVC_FRAMING}. `
      : format === "hands_only"
      ? `${HANDS_ONLY_FRAMING}. ${HANDS_ONLY_HAND_LOCK}`
      : fullBodyFashion
        // r3 (Brian): fashion di DALAM KAMAR — suasana try-on paling relatable.
        ? "full body visible head to toe, presenter standing and showing the whole outfit like a mirror-check try-on video, " +
          "phone propped vertical framing, natural phone camera look, inside a cozy lived-in bedroom with a bed and " +
          "wardrobe visible, soft natural window light, muted authentic colors, candid everyday vibe. "
        : format === "talking_head" ? `${TALKING_HEAD_FRAMING}. `
        : format === "ads" ? `${ADS_FRAMING}. ` : "";
    // Wajah AI pakai promptSeed (deskripsi wajah/tipologi) + deliveryPrompt
    // (gaya pembawaan per kategori — genz energik, hijaber kalem anggun, ibu
    // menenangkan) sebagai subjek utama, bukan handsPrompt.
    // Tanpa model: subjeknya PRODUK, bukan orang. Memakai promptSeed persona
    // di sini akan tetap memanggil manusia ke frame walau beat-nya makro.
    const subject = input.noModel && format === "tvc"
      ? `"${input.productName}" itself as the sole subject, no people anywhere in frame`
      : format === "talking_head" || format === "tvc" || format === "ads"
      ? `${input.category.promptSeed}, ${input.category.deliveryPrompt}`
      : input.category.handsPrompt;
    const demoAction = DEMO_ACTION[input.productCategory] ?? DEMO_ACTION.default;
    // TANGGA SHOT TENGAH.
    //
    // Terukur 2026-08-11: sebelum ini SELURUH shot tengah membawa instruksi
    // yang sama persis — 3 beat unik dari 6 shot, artinya empat shot disuruh
    // melakukan hal yang identik. Pembuka dan penutupnya memang berbeda, tapi
    // bagian tengahnya (yang justru mayoritas durasi) tidak.
    //
    // Pelajaran dari 12 video pemenang yang Brian bedah: yang menahan
    // perhatian bukan shot bagus yang diulang, tapi shot yang BERGANTI TUGAS —
    // makro tekstur, produk dituang, hasil di kulit, produk di tempatnya.
    // Tangga ini memberi tugas berbeda tiap shot tengah sambil mempertahankan
    // semua batasan yang sudah terbukti: label tetap menghadap kamera, produk
    // sama dengan shot 1, dan instruksi identitas ikut di tiap beat.
    const midIdx = Math.max(0, i - 1);
    const HANDS_MIDDLE = [
      `Hands demonstrating the product in use, but the bottle stays angled so its label keeps facing the camera and stays legible throughout — fingers never cover the label, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up texture, natural phone camera movement`,
      `Macro close-up of the product's own texture and material filling most of the frame — the surface, the consistency, the detail a buyer wants to inspect before paying, the product body still partly visible with its label readable at the frame edge, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
      `Hands opening or dispensing the product so its contents become visible coming out, the amount clear, label kept facing the camera throughout, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up, natural phone camera movement`,
      `The product resting in the everyday place it would actually be used, hands entering frame to adjust or pick it up, the surroundings quietly telling the viewer where this belongs, label facing camera, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
    ];
    const HEAD_MIDDLE = [
      `Close cutaway on presenter's hands as she ${demoAction}, her face out of tight focus and NOT talking, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
      `Macro close-up of the product's texture where it has just been used, filling most of the frame, the presenter out of focus behind, NOT talking, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
      `Presenter looking down at the result with a genuinely pleased reaction, NOT talking, mouth relaxed and closed, the product held in frame with its label facing camera, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`,
      `Close cutaway on the presenter's hands slowly turning the product to show a different side of it, label kept readable throughout, her face out of tight focus and NOT talking, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
    ];
    // Beat template UGC. Menimpa beat generik HANYA untuk job yang memang
    // memakai salah satu dari 12 template format; job lain (dan seluruh
    // retail) tidak tersentuh karena ugcTemplate-nya null.
    //
    // Tetap memakai jalur framing/subject yang sama di bawah — yang diganti
    // cuma APA YANG TERJADI di tiap shot dan gerak kameranya, bukan gaya
    // gambarnya. Character-lock disebut ulang tiap shot karena itu yang
    // menjaga wajah tetap sama antar generate (pelajaran dari dokumen TVC).
    const ugcRoles = ugcRolesFor(input.ugcTemplate);
    /** Peran template untuk shot ke-i, sebagai OBJEK. Dipisah dari ugcBeat
     *  yang mengembalikan teks, supaya penanda withholdProduct bisa dibaca
     *  tanpa harus mengurai kalimatnya lagi. */
    const ugcPeran = (i: number) => {
      if (!ugcRoles || format === "tvc") return null;
      return i === 0 && ugcRoles.opening
        ? ugcRoles.opening
        : isLastShot(i, numShots) && ugcRoles.closing && numShots >= 2
          ? ugcRoles.closing
          : ugcRoles.middle[Math.max(0, i - (ugcRoles.opening ? 1 : 0)) % ugcRoles.middle.length];
    };

    /** Apakah shot ke-i menahan produk? Dari peran template, atau dari tabel
     *  rute TVC (yang perannya juga menandainya eksplisit). */
    const menahanProdukDiShot = (i: number): boolean => {
      if (ugcPeran(i)?.withholdProduct) return true;
      // Rute TVC: pembuka rute fabric/intimate memang menahan produk.
      if (format === "tvc" && i === 0 && (input.tvcRoute === "fabric" || input.tvcRoute === "intimate")) return true;
      return false;
    };

    const ugcBeat = (i: number): string | null => {
      // TVC tetap dikecualikan: dia punya tabel rute sendiri
      // (TVC_FABRIC_ROLES dkk) yang lebih spesifik daripada peran template.
      //
      // "ads" DULU ikut dikecualikan karena memang belum ada satu pun template
      // ads yang punya tabel peran — jadi pengecualiannya tidak pernah terasa.
      // Begitu "Meja Kosong" (format ads) dapat tabelnya 2026-08-13,
      // pengecualian itu berubah jadi bug diam: tabelnya ada, dibaca, lalu
      // dibuang. Sekarang yang menentukan adalah ADA-TIDAKNYA tabel, bukan
      // nama formatnya.
      if (!ugcRoles || format === "tvc") return null;
      const pick =
        i === 0 && ugcRoles.opening
          ? ugcRoles.opening
          : isLastShot(i, numShots) && ugcRoles.closing && numShots >= 2
            ? ugcRoles.closing
            : ugcRoles.middle[
                Math.max(0, i - (ugcRoles.opening ? 1 : 0)) % ugcRoles.middle.length
              ];
      if (!pick) return null;
      return (
        `${i === 0
          ? `This is the OPENING shot of a continuous ${input.durationSec}-second story about "${input.productName}". `
          : isLastShot(i, numShots)
            ? `This is the FINAL shot, resolving what the earlier shots built up. `
            : `This shot continues directly from the previous one — same place, same person, same look, one step further on. `}` +
        `Shot ${i + 1} of ${numShots}: ${pick.role}. Camera: ${pick.camera}. ` +
        `The same person, same face, same hair and same outfit as the other shots. ` +
        `${IDENTITY_INSTRUCTION}`
      );
    };
    // Tanpa-produk ditentukan KATEGORI, bukan format: iklan untuk barang fisik
    // tetap menampilkan barangnya. Lihat isServiceLike di lib/config/hooks.ts.
    const noPhysicalProduct = isServiceLike(input.productCategory);
    const beatTvc = format === "tvc" ? tvcBeat(i) : null;
    const beat =
      ugcBeat(i) ??
      (format === "ads" && noPhysicalProduct
        // Iklan jasa: yang diperagakan adalah MANFAAT, bukan benda. Presenter
        // tidak memegang apa pun — begitu diminta memegang sesuatu, model akan
        // mengarang produk yang tidak pernah ada, dan itu justru menyesatkan
        // calon pembeli jasa.
        ? isFirst
          ? `A person talking straight to camera about "${input.productName}", relaxed and convincing, hands free and gesturing naturally — holding no product of any kind. The place around them fits the business being described`
          : isLastShot(i, numShots)
            ? `The same person wrapping up, looking straight at camera with a warm inviting nod, hands open in a natural gesture — still holding nothing`
            : `The same person continuing, gesturing naturally to make a point, the surroundings quietly reinforcing what the business does — no product in hand at any moment`
      : format === "tvc"
        ? beatTvc!.teks
        : format === "talking_head" || format === "ads"
        ? lipSyncPresenter
          // Presenter/Lipsync (Super HQ, r7): bicara sungguhan ke kamera —
          // audio embedded asli dipertahankan, jadi sinkron mulut BENAR di
          // sini justru yang diinginkan (perilaku pra-r6).
          ? isFirst
            ? numShots === 1
              ? `Presenter holding "${input.productName}" up to the camera at chest height, product label facing camera, warm smile, then ${demoAction}, ending with a warm inviting smile to camera, ${IDENTITY_INSTRUCTION}`
              : `Presenter holding "${input.productName}" up to the camera at chest height, product label facing camera, warm smile, ${IDENTITY_INSTRUCTION}`
            : isClosing
              ? `Presenter smiling warmly, gesturing invitingly toward the camera as if wrapping up, product still clearly visible, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`
              : `Presenter ${demoAction}, still clearly in frame with her face, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`
          : isFirst
            ? numShots === 1
              // r6 (Brian 2026-08-07: "lipsync-nya ga dapat, banyakin voice over
              // aja") — VO Gemini TTS mengganti audio embedded sepenuhnya, jadi
              // mulut yang "bicara" ke kata tertentu SELALU meleset dari suara
              // final. Fix: gaya presenter-di-layar TAPI TIDAK BICARA (mulut
              // rileks/senyum tipis, bukan sinkron kata) — mayoritas durasi jadi
              // cutaway demo tangan/produk (mulut tak jadi fokus), seperti video
              // UGC editan asli yang memotong ke b-roll saat VO jalan.
              ? `Presenter holds "${input.productName}" up to the camera at chest height with a warm delighted reaction — NOT talking, mouth relaxed in a soft closed-lip smile, not synced to any words — product label facing camera, then the camera lingers on a close cutaway of her hands as she ${demoAction} (her face out of tight focus during this part), ending with her looking back up at the camera with a warm inviting smile and a small nod, still not talking, ${IDENTITY_INSTRUCTION}`
              : `Presenter holding "${input.productName}" up to the camera at chest height with a warm reaction, NOT talking, mouth relaxed and closed, ${IDENTITY_INSTRUCTION}`
            : isClosing
              ? `Presenter smiling warmly, NOT talking, gesturing invitingly toward the camera as if wrapping up, product still clearly visible, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`
              : HEAD_MIDDLE[midIdx % HEAD_MIDDLE.length]
        : isFirst
          // r13 (Brian 2026-08-07: "kenapa ada gambar Wardah di depan?" — shot
          // pembuka terlihat seperti foto produk diam sebelum tangan "masuk").
          // Motion eksplisit SEJAK FRAME PERTAMA supaya model tidak menganggur
          // di seed image yang statis di awal generate.
          ? `The video starts ALREADY in motion: hands are already gripping and gently rotating "${input.productName}" from the very first frame — NOT a static product photo, no frozen opening beat, product label facing camera, ${IDENTITY_INSTRUCTION}`
          : isClosing
            ? `Hands holding the product steady near the bottom of frame in a closing, inviting gesture, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`
            // r13 (Brian 2026-08-07, evidenced via render 45fe92ad): shot demo
            // tanpa instruksi label eksplisit -> model mengarahkan botol ke
            // sudut acak / label ketutup jari saat "in use", bikin QC-10 gagal
            // & identitas produk kelihatan beda dari shot 1. Label WAJIB
            // tetap menghadap kamera bahkan saat demo.
            : HANDS_MIDDLE[midIdx % HANDS_MIDDLE.length]);
    // Level gila: pembuka pattern-interrupt HANYA di shot pertama; vo_broll
    // (pan foto, tanpa model video) tidak punya jalur ini.
    const crazyOpener =
      isFirst && (format === "hands_only" || format === "talking_head")
        ? input.hookLevel === "gila"
          ? CRAZY_OPENER[format]
          // Level 4 ("agak gila"): produk tetap naik cepat ke tengah frame,
          // tapi tanpa gerakan kamera dramatis. Ini titik tengah yang NYATA
          // antara level 3 (tanpa pembuka sama sekali) dan level 5 — bukan
          // sekadar posisi slider tambahan.
          : input.hookLevel === "agak_gila"
            ? "opens with the product already moving quickly into the centre of frame, steady camera, "
            : ""
        : "";
    // URUTAN PENTING, dan ini diperbaiki setelah render bukti gagal
    // (2026-08-13). Dulu prompt selalu dibuka framing bawaan format, lalu
    // peran shot dari template menyusul ~400 karakter kemudian. Untuk template
    // yang komposisinya memang BEDA, hasilnya prompt yang membantah dirinya
    // sendiri: "presenter berbicara ke kamera di rumah" lebih dulu, baru "POV
    // dari DALAM kardus, produk belum terlihat". Model menuruti yang pertama —
    // terukur: ketiga UGC Ads baru keluar identik sebagai talking-head biasa,
    // "Meja Kosong" tanpa meja kosong dan "Unboxing" tanpa kardus.
    //
    // Kalau template memberi peran eksplisit untuk shot ini, PERANNYA yang
    // memimpin dan framing bawaan format tidak ikut sama sekali — persis
    // perlakuan yang sudah dipakai gaya rekam. Yang TETAP ikut: subject
    // (identitas persona) dan larangan format, karena keduanya bukan soal
    // komposisi melainkan soal siapa yang tampil dan apa yang dilarang.
    // TVC ikut aturan yang sama. Rute TVC punya tabel perannya sendiri
    // (TVC_FABRIC_ROLES dkk) yang TIDAK lewat ugcRoles, jadi tanpa baris ini
    // TVC tetap dibuka TVC_FRAMING dan perannya menyusul di belakang —
    // terukur di render bukti: shot pembuka rute "fabric" yang seharusnya
    // "menuruni tangga, kain melayang" keluar sebagai tangan memegang botol,
    // karena kalimat pertama prompt-nya berbunyi lain.
    //
    // "luxury" TIDAK ikut: itu perilaku bawaan TVC sejak awal, dan framing
    // sinematiknya memang yang memimpin di sana.
    const rutePunyaPeran = format === "tvc" && Boolean(input.tvcRoute) && input.tvcRoute !== "luxury";
    const punyaPeranTemplate = Boolean(ugcRoles) || rutePunyaPeran;
    // Kunci subjek tunggal ikut ke SETIAP shot yang menampilkan orang.
    //
    // TIDAK untuk hands_only (memang tanpa wajah, dan sudah punya larangannya
    // sendiri), TIDAK untuk noModel (tidak ada orang sama sekali), dan TIDAK
    // untuk rute TVC komedi — rute itu SENGAJA memakai dua tokoh, jadi
    // memaksakan satu orang di sana akan membatalkan leluconnya.
    // Kunci subjek tunggal TIDAK dipasang pada shot yang memang tanpa orang.
    // "Tepat satu orang" di shot yang perannya "produk sendirian" adalah
    // kontradiksi, dan model menyelesaikan kontradiksi dengan mengarang —
    // dalam kasus kita, dengan menggandakan orangnya.
    const perluSubjekTunggal =
      maksOrangPerFrame({ format, noModel: input.noModel, tvcRoute: input.tvcRoute }) === 1 &&
      !(beatTvc?.tanpaOrang ?? false);
    const kunciSubjek = perluSubjekTunggal ? SINGLE_SUBJECT_LOCK : "";

    const base = punyaPeranTemplate
      ? `${beat} ${kunciSubjek}${crazyOpener}${subject}. Shot ${i + 1} of ${numShots}. ${productDesc}${brandBrief}`
      : `${framing}${kunciSubjek}${crazyOpener}${subject}. Shot ${i + 1} of ${numShots}. ${productDesc}${brandBrief}${beat}`;

    if (!withAudio) {
      return { index: i, durationSec: perShot, prompt: base, imageRefPath: input.imageRefPath };
    }

    // Tier bersuara: dialog dalam tanda kutip; jeda & arahan di luar tanda kutip.
    // hands_only (Tangan + VO): dialog = NARASI VOICEOVER — insiden production
    // 2026-08-07 job a1192101: frasa "presenter speaks to camera" membuat model
    // menggambar WAJAH pembicara di format tanpa-wajah -> QC-09 menolak (benar).
    // r4 (Brian 2026-08-07): harga di dialog WAJIB terbilang — model membaca
    // "Rp299.000" ngaco. Hanya pola harga yang dikonversi (kode produk aman).
    const dialogue = hargaTerbilang(dialogueForShot(i).filter(Boolean).join(" "));
    const isLast = i === numShots - 1;
    // Bar kualitas suara (Brian 2026-08-07): "VO kayak real, tidak cepet, ada
    // pause/jeda" — tempo santai + jeda antar kalimat ditulis eksplisit.
    // r6 (Brian 2026-08-07): Gemini TTS menggantikan audio embedded utk SEMUA
    // format bersuara -> mulut yang disuruh sinkron ke kata tertentu pasti
    // meleset dari VO final. hands_only sudah aman (pembicara tak pernah
    // terlihat). talking_head: dialog dipakai HANYA sebagai konteks nada/
    // ekspresi (voice-over style, presenter di layar tapi tidak "bicara").
    const speech =
      // TVC punya register suaranya sendiri: suara brand yang tenang dan
      // berwibawa, bukan kreator yang lagi ngobrol. Memakai kalimat UGC di
      // sini persis yang membuat hasilnya terasa bukan iklan TV.
      format === "tvc"
        ? !dialogue.trim()
          ? `No voiceover lands on this beat — it plays on picture and sound design alone. `
          : input.noModel
            // Tanpa model, menyebut "any person on screen" justru memanggil
            // orang kembali ke frame yang seharusnya murni produk — kalimat
            // itu ditulis untuk kasus ADA presenter, dan di sini merugikan.
            ? `A composed, confident Indonesian brand voiceover is heard over this footage with measured pacing and clean articulation — the poised tone of a national television commercial, warm but never chatty or salesy. The narrator is never seen; nobody appears on screen: "${dialogue}". `
            : `A composed, confident Indonesian brand voiceover delivers the line over this footage with measured pacing and clean articulation — the poised tone of a national television commercial, warm but never chatty or salesy; any person on screen acts and reacts but is NOT lip-syncing these words: "${dialogue}". `
        : format === "hands_only"
        ? `A warm female VOICEOVER narrates in casual Indonesian at a relaxed, unhurried pace with natural pauses between sentences — like a real person chatting, never rushed (the speaker is NEVER visible — off-screen narration only, keep the shot strictly hands and product): "${dialogue}". `
        : lipSyncPresenter
          ? `The presenter speaks casually to camera in Indonesian at a relaxed, unhurried pace with natural pauses between sentences — like a real person chatting with a friend, never rushed or salesy, saying: "${dialogue}". `
          : `A warm female VOICEOVER narrates in casual Indonesian over this footage at a relaxed, unhurried pace with natural pauses, like a real person chatting with a friend — the on-screen presenter reacts and demonstrates naturally but her mouth is NOT moving in sync to any specific words (not talking to camera): "${dialogue}". `;
    const pacing =
      format === "tvc"
        ? !dialogue.trim()
          ? ``
          : isLast
          ? `The voiceover lands the final line cleanly and stops — one beat of silence on the hero shot, no trailing chatter. `
          : `A short, deliberate beat of silence separates this line from the next. `
        : format === "hands_only"
        ? `The narration pauses for a full second before the next line — the pause should be clearly noticeable, not rushed. `
        : isLast
          ? `She pauses for a full second, smiles warmly, then ends with a friendly inviting tone — the pause should be clearly noticeable, not rushed. `
          : `She pauses for a full second, taking a visible breath, before showing the product closer — the pause should be clearly noticeable, not rushed. `;
    const prompt =
      format === "talking_head" && !lipSyncPresenter
        ? `${base}. ${speech}${pacing}Natural warm reactive expression throughout, mouth relaxed and not talking to camera.`
        : `${base}. ${speech}${pacing}Enunciate clearly the words "${input.productName}" and "${pain.replace(/nya$/, "")}". Natural conversational Indonesian, not a newsreader.`;
    // Penanda menahan-produk ikut sebagai DATA. Sumbernya peran template
    // (ugcRoles) atau tabel rute TVC — keduanya menandainya eksplisit.
    return {
      index: i, durationSec: perShot, prompt, imageRefPath: input.imageRefPath,
      ...(menahanProdukDiShot(i) ? { withholdProduct: true } : {}),
    };
  });

  // Negative prompt per-format: hands_only melarang wajah sepenuhnya (bukan sekadar
  // "no face distortion"); format lain memakai negative kategori apa adanya.
  let negativePrompt = input.category.negativePrompt;
  // r8: larangan bersama (format ber-video-AI saja — vo_broll pakai FOTO ASLI
  // user, tidak ada model video sama sekali, jadi tak relevan & tak diubah).
  // Model jangan "mencoba" merender teks kecil label sebagai tajam lalu gagal
  // jadi gibberish (lihat IDENTITY_INSTRUCTION).
  if (format !== "vo_broll") {
    negativePrompt = `${negativePrompt}, no garbled small print, no illegible fine text, no attempted sharp small text that is wrong or gibberish`;
  }
  if (format === "talking_head") {
    // Anti AI-slop (bar Brian 2026-08-07: "smooth, tidak ada AI slop, realisme")
    // r3: + anti tangan-ganda (temuan Brian: tangan kanan kedua muncul pegang
    // muka) dan anti label-kedip (tulisan produk hilang-muncul).
    negativePrompt = `${negativePrompt}, no morphing, no warping, no uncanny artificial look, no oversmoothed skin, no flickering, ` +
      "no extra hands, no third hand, no duplicated limbs, exactly two hands, no flickering or disappearing product label text, " +
      "no deformed packaging, no duplicated caps or droppers, no floating parts";
    if (!lipSyncPresenter) {
      // r6: semua kombinasi KECUALI Presenter/Lipsync (Super HQ) punya audio
      // embedded diganti Gemini TTS -> mulut yang "bicara" ke teks asli pasti
      // tak sinkron dengan VO final; larang mouth-flapping.
      negativePrompt += ", no mouth flapping or exaggerated talking motion, no lip-sync to any specific words";
    }
  }
  // TVC dan ads SELAMA INI TIDAK PUNYA larangan anatomi sama sekali — hanya
  // talking_head yang punya. Video yang gagal (dua perempuan, empat tangan)
  // justru format TVC.
  if ((format === "tvc" || format === "ads") && !input.noModel && input.tvcRoute !== "comedy") {
    negativePrompt = `${negativePrompt}, ${SINGLE_SUBJECT_NEGATIVE}, no morphing, no warping, no duplicated limbs`;
  }
  if (format === "talking_head" && input.tvcRoute !== "comedy") {
    negativePrompt = `${negativePrompt}, ${SINGLE_SUBJECT_NEGATIVE}`;
  }
  if (format === "hands_only") {
    negativePrompt = negativePrompt
      .replace(/no face distortion,?\s*/i, "") // kontradiktif untuk hands_only — diganti larangan total
      .replace(/,\s*,/g, ",")
      .trim();
    negativePrompt = `${negativePrompt}, ${HANDS_ONLY_NEGATIVE}`;
  }

  // Rute TVC yang premisnya menahan produk di awal. Dipisah jadi variabel
  // supaya alasannya bisa dibaca di satu tempat, bukan tersembunyi di dalam
  // ekspresi panjang.
  const menahanProduk = format === "tvc" && (input.tvcRoute === "fabric" || input.tvcRoute === "intimate");

  return {
    jobId: input.jobId,
    width: 720,
    height: 1280,
    shots,
    maxPeople: maksOrangPerFrame({ format, noModel: input.noModel, tvcRoute: input.tvcRoute }),
    negativePrompt, // tetap mengandung MANDATORY_NEGATIVE_PROMPT dari kategori
    qualityTier: tier,
    generateAudio: withAudio, // konsisten dengan tier — ditegakkan juga di registry
    extraReferenceImagePaths: input.extraImageRefPaths?.slice(0, 7), // r13: 4->7 (+1 primer = 8 total)
    // Iklan jasa: visual bisnis dipakai sebagai REFERENSI, bukan frame
    // pertama — kalau tidak, hasilnya video tentang logo, bukan orang yang
    // berbicara. Lihat catatan referenceOnlyImages di lib/providers/types.ts.
    // Mode REFERENSI, bukan frame-pertama.
    //
    // Mode i2v membuat foto yang dikirim jadi FRAME PERTAMA PERSIS. Untuk
    // kebanyakan format itu benar — videonya memang harus berangkat dari
    // produk aslinya. Tapi untuk rute TVC "fabric" dan "intimate", seluruh
    // premisnya justru produk BELUM muncul di awal: satu dibuka orang menuruni
    // tangga, satu dibuka kamar gelap jam 3 pagi.
    //
    // Terukur 2026-08-13 lewat tiga putaran render: setelah tabel rute dipakai
    // sejak shot pertama, adegan tangganya MUNCUL — tapi botolnya tetap
    // terpaku di depan frame, karena foto itu memang frame pertamanya. Selama
    // i2v dipakai, rute yang menahan produk mustahil dijalankan.
    //
    // BELUM DIVERIFIKASI LEWAT RENDER. Perubahan ini menyusul temuan di atas
    // dan alasannya kuat, tapi jangan diklaim terbukti sebelum ada rekamannya.
    referenceOnlyImages: format === "ads" || menahanProduk,
    ratio: input.ratio ?? "9:16",
  };
}

export { HANDS_ONLY_FRAMING, HANDS_ONLY_NEGATIVE, IDENTITY_INSTRUCTION, MANDATORY_NEGATIVE_PROMPT };
