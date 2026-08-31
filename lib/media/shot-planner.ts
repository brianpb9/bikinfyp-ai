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

import { config } from "../config";
import type { VisualSpec, ShotSpec, QualityTier } from "../providers/types";
import { latarUntukTemplate } from "./latar-template";
import { getCreatorCategory, type CreatorCategory } from "../personas";
import type { SegmentDraft } from "../script-engine/templates";
import { CATEGORY_NOUN, CATEGORY_PAIN } from "../config/hooks";
import { hargaTerbilang } from "../script-engine/terbilang";
import { MANDATORY_NEGATIVE_PROMPT } from "../config/compliance";
import { ugcRolesFor } from "./ugc-template-roles";
import { isServiceLike } from "../config/hooks";
import { getRecordingStyle, type StyleFormat } from "./recording-styles";
import { blokKontrakMode, framingUntukMode, modeDikenal } from "./mode-kamera";
import { formatById } from "../script-engine/format-katalog";
import { stripDeliveryTags } from "../script-engine/delivery-tags";
import { bridgeStoryAdsTerbukti, isStructuredStoryAds, temuanBridgeStoryAds, temuanHookSenyapAds, temuanStrukturStoryAds } from "../script-engine/story-os-ads";
import {
  isNeutralStoryAdsTemplate,
  NEUTRAL_PROP_SIZE_LOCK,
  neutralStoryAdsActionContradictions,
  neutralStoryAdsPromptContradictions,
  neutralStoryAdsUntrustedFieldContradictions,
  neutralStoryAdsUntrustedNumericContradictions,
} from "../script-engine/ads-visual-contract";

export interface ShotPlanInput {
  jobId: string;
  durationSec: number;
  segments: SegmentDraft[];
  category: CreatorCategory;
  productName: string;
  productCategory: string;
  productPriceIdr?: number | null;
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
  /** Exact reviewed evidence only: collapse a <=15s hands-only plan to one
   * provider request. The provider contract independently rejects every job
   * except the immutable JJ GLOW candidate. */
  reviewedEvidenceSinglePost?: boolean;
  /**
   * Format IDE terpilih (knowledge/formats/*.json) — beda sumbu dari `format`
   * di atas, yang menentukan jenis produksi (hands_only/talking_head/...).
   *
   * Slice 3 (20 Agu): sampai kini format ide hanya mewarnai prompt Idea Stage
   * dan penulis; kamera tidak pernah tahu. Format yang tidak sampai ke kamera
   * adalah nama, bukan format. Id yang tidak dikenal DIABAIKAN — bukan
   * diteruskan mentah, karena model memperlakukan kata asing sebagai gaya
   * visual dan hasilnya tak bisa ditebak.
   */
  ideaFormat?: string | null;
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
  /** Genre otoritatif dari snapshot admisi; jangan diturunkan dari label beat. */
  contentType?: "affiliate" | "ads" | null;
  /** Gaya rekam (lib/media/recording-styles.ts) — sumbu "bagaimana direkam",
   *  terpisah dari "apa yang dijual". NULL / "standar" = perilaku lama persis.
   *
   *  Hanya berlaku untuk hands_only / talking_head / ads. TVC SENGAJA tidak
   *  ikut: TVC punya TVC_STYLE_LOCK demi konsistensi antar-shot, dan menimpanya
   *  membatalkan alasan kunci itu ada. */
  recordStyle?: string | null;
}

// DITULIS POSITIF (reviewer A5, 18 Agu). Versi lama berbunyi "face and body
// NOT visible" — negasi tentang ORANG di dalam prompt POSITIF, yang memicu
// penyaring penyedia dan sekaligus melanggar L-21 kita sendiri. Ironisnya
// justru frasa yang kita wajibkan.
//
// Batasnya sekarang dinyatakan sebagai BINGKAI, bukan larangan: menyebut di
// mana kamera berhenti mencapai hal yang sama tanpa menyebut wajah sama sekali.
const HANDS_ONLY_FRAMING =
  "hands and forearms only, framing cropped at the wrists and elbows and stopping below the collarbone, " +
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
  "The SAME hand that holds the bottle also operates it, keeping its grip the whole time. " +
  "The second hand does only one thing: receive the product or show the result. " +
  "The frame stays at exactly two hands from the first frame to the last, at every edge. ";

// FRASA BENDA TELANJANG, tanpa kata "no" (reviewer A5).
//
// Field negative prompt artinya memang "hindari ini" — kata "no" di dalamnya
// tidak menambah makna apa pun bagi model, tapi menambah token negasi yang
// dibaca penyaring konten dan detektor L-21 kita. Isinya sama, tokennya bersih.
const HANDS_ONLY_NEGATIVE =
  "face, visible face, head in frame, person facing camera, " +
  "third hand, extra hands, second pair of hands, disembodied hand entering frame";

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
  "commercial shot entirely on stabilised cinema rigs, every frame composed and locked";

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
  "EXACTLY ONE person is present in the entire frame from start to finish — she is alone in the shot " +
  "and appears a single time. That one person has exactly two hands, " +
  "both clearly visible and naturally attached to her own arms, and only those two hands ever touch " +
  "the product. ";
const NEUTRAL_SINGLE_SUBJECT_LOCK =
  "EXACTLY ONE person is present in the entire frame from start to finish — she is alone in the shot " +
  "and appears a single time. That one person has exactly two hands, both clearly visible and naturally " +
  "attached to her own arms, and only those two hands ever touch the staged blank props. ";

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

// FRASA BENDA TELANJANG (reviewer A5): field negative sudah berarti "hindari
// ini", jadi kata "no" hanya menambah token negasi-tentang-orang yang dibaca
// penyaring penyedia.
//
// "exactly two hands" DIBUANG dari sini (reviewer ronde 3). Dulu dipertahankan
// dengan alasan ia menyatakan JUMLAH yang benar — tapi tempatnya salah:
// BytePlus mengirim field ini sebagai "Negative: ..., exactly two hands"
// (lib/providers/stubs/byteplus.ts), jadi kami menyuruh model MENGHINDARI
// kondisi yang justru kami inginkan. Pernyataan positifnya sudah ada di
// SINGLE_SUBJECT_LOCK, di tempat yang memang membacanya sebagai perintah.
const SINGLE_SUBJECT_NEGATIVE =
  "second person, duplicate of the same person, twin, extra people in frame, " +
  "extra hands, third hand, disembodied hands";

/**
 * Negative prompt = DAFTAR HAL YANG DIHINDARI. Dua cacat yang lahir dari lupa
 * itu, dan keduanya nyata:
 *
 *   1. "no face" di daftar hindari berarti "hindari ketiadaan wajah" — persis
 *      kebalikan dari maksudnya. Setiap "no X" di sini adalah negasi ganda.
 *   2. Kondisi yang DIINGINKAN ("exactly two hands") tidak boleh ada di daftar
 *      hindari sama sekali.
 *
 * Dijalankan sekali di ujung penyusunan, bukan dijaga manual di sepuluh tempat
 * yang menambahkan potongan — disiplin yang harus diingat berulang kali adalah
 * disiplin yang cepat atau lambat terlewat, dan memang sudah terlewat.
 */
export function frasaNegatifBersih(negatif: string): string {
  const keluar: string[] = [];
  for (const mentah of negatif.split(",").map((x) => x.trim()).filter(Boolean)) {
    // Kondisi yang diinginkan, bukan larangan.
    if (/^(exactly|tepat)\b/i.test(mentah)) continue;
    const telanjang = mentah.replace(/^(?:no|not|never|without|tanpa|tidak|nggak)\s+/i, "").trim();
    if (!telanjang) continue;
    if (!keluar.some((x) => x.toLowerCase() === telanjang.toLowerCase())) keluar.push(telanjang);
  }
  return keluar.join(", ");
}

const TALKING_HEAD_FRAMING =
  // "framed from the chest up" adalah bawaan (STANDAR 10/10 baris 8): batas
  // framing yang ditulis POSITIF sekaligus menutup penekanan tubuh tanpa perlu
  // satu pun larangan.
  "framed from the chest up, face and upper body clearly visible, warm friendly UGC presenter speaking directly to camera, " +
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
// Percobaan 3 (render berbayar 20 Agu, test_output/adu_koreografi): masih
// mengarang — "jddpgeer", "SOMSONG", "PAL Q3" pada label botol yang diambil
// dekat. Tiga putaran prompt, tiga kali gagal, di dua model berbeda.
//
// KEPUTUSAN Brian 20 Agu: jalan keluar A — produk diambil cukup jauh sehingga
// TIDAK ADA teks pada label yang pernah ter-resolve jadi huruf, termasuk nama
// mereknya. Alasannya sederhana: huruf yang tidak pernah dirender tidak bisa
// salah, sedangkan tiga putaran membuktikan huruf yang dirender selalu salah.
//
// Konsekuensi yang TIDAK disembunyikan: di bawah kebijakan ini QC-10 ("label
// produk terbaca") tidak akan pernah PASS dari klip generasi — ia hanya bisa
// menangkap salah eja yang terlanjur terbaca. Baris standar 10/10 "label
// terbaca di >=2 titik" karena itu hanya bisa dipenuhi lewat packshot foto
// asli (jalan keluar B), dan itu keputusan terpisah yang belum diambil.
const IDENTITY_INSTRUCTION =
  "the exact same product from the reference image, identical packaging, identical label, " +
  "do not redesign or replace the product, the packaging stays physically intact and correct " +
  "(one cap, one dropper, nothing floating or duplicated). The ENTIRE bottle and its full label " +
  "stay completely inside the frame at all times, with visible margin on every side — never cropped " +
  "or cut off by the frame edges, camera framed wide enough that no part of the bottle ever leaves " +
  "frame. The camera stays at a normal arm's-length viewing distance from the product, so " +
  "ALL printed text on the label — the brand name included — reads only as fine printed " +
  "TEXTURE: visible as faint lines and blocks of print, with no individual letter, word, or number " +
  "resolved anywhere in any frame. The label keeps its exact colours, layout and proportions from " +
  "the reference image. Never render invented words, invented ingredient names, or " +
  "invented volume figures on the label";

// Aksi demo per KATEGORI PRODUK (2026-08-07, dipelajari dari akun UGC tim +
// referensi visual Brian): "memegang kemasan" hanya benar untuk sebagian
// kategori — fashion harus TRY-ON (baju dipakai/ditempel ke badan), beauty
// harus swatch/aplikasi, food harus dicicipi. Konten UGC yang menang terlihat
// seperti orang sungguhan MEMAKAI produk, bukan model memegang paket.

/** BENTUK produk: padat, bisa dituang, atau tidak diketahui.
 *
 * Aksi demo per kategori mengandaikan produk BISA DITUANG — beauty menyuruh
 * "dropping a little of the product", body_care menyuruh "pumping a dollop".
 * Untuk sabun BATANG dua-duanya mustahil, dan model menuruti aksinya lalu
 * mengarang sabun cair. Terlihat 16 Agu 2026 pada JJ Glow Gluta Pink Barsoap:
 * deskripsi produk jelas menyebut "Barsoap", tapi videonya keluar sabun cair.
 *
 * Ini pola yang sama untuk keenam kalinya di repo ini — prompt yang
 * bertentangan dengan dirinya sendiri, bukan larangan yang kurang keras.
 *
 * "cair" diperiksa LEBIH DULU: "sabun cair" memuat kata "sabun" dan akan salah
 * tertangkap sebagai padat kalau urutannya dibalik.
 */
export type BentukProduk =
  | "sabun_batang"   // sabun/shampoo batang — dibasahi lalu digosok sampai berbusa
  | "oles_padat"     // stick, balm, serum stick — DIPUTAR naik lalu digeser
  | "batang_gosok"   // lotion/body bar — digosok langsung, TANPA mekanisme putar
  | "roll_on"        // deodoran roll-on — bolanya menggelinding, tidak diputar naik
  | "bubuk_padat"    // compact, blush, eyeshadow — ditekan/disapu, TIDAK basah
  | "cushion"        // alas bedak cair di dalam spons — ditekan, BUKAN bedak
  | "lipstik"        // lipstik/lip crayon — diputar keluar lalu di-swatch
  | "tuang"          // cairan/krim — dituang atau dipompa
  | "tidak diketahui";

// Kata BENTUK menang atas kata ZAT, dan itu bukan detail urutan.
//
// Versi pertama memeriksa kata zat lebih dulu, jadi "Shampoo Bar", "Lotion
// Bar", "Serum Stick", dan "Cream Stick" semuanya pulang sebagai "tuang" —
// padahal keempatnya benda padat. Sebabnya: "shampoo" menyebut ISI-nya, "bar"
// menyebut BENTUKNYA. Yang menentukan apa yang bisa dilakukan tangan adalah
// bentuknya.
//
// TAPI PERBAIKAN ITU BELUM SELESAI, dan audit putaran ketiga benar soal ini:
// menggabungkan semua benda padat jadi satu label "padat" membuat Serum Stick,
// lipstik, dan compact powder SEMUANYA mendapat aksi sabun — "dibasahi lalu
// digosok sampai berbusa". Labelnya benar, promptnya tetap salah. Yang
// dibutuhkan bukan tahu benda itu padat, melainkan tahu APA YANG DILAKUKAN
// TANGAN terhadapnya. Karena itu bentuknya sekarang spesifik.
const KATA_CAIR_TEGAS = /\b(cair|liquid)\b/i;
// HANYA yang benar-benar berbusa. "Lotion Bar" dan "Body Bar" TIDAK: keduanya
// batangan padat yang DIGOSOK LANGSUNG ke kulit dan meleleh oleh suhu badan,
// tidak dibasahi dan tidak berbuih. Menyuruhnya berbusa memperagakan produk
// yang salah.
const KATA_SABUN_BATANG = /\b(sabun|soap|barsoap|shampoo|shampo)\b[^.]{0,24}\b(batang|bar|padat|solid)\b|\b(barsoap|bar soap|shampoo bar|shampo batang)\b|\b(batang|bar)\b[^.]{0,16}\b(sabun|soap|shampoo|shampo)\b/i;
const KATA_LIPSTIK = /\b(lipstik|lipstick|lip crayon|lip stick)\b/i;
// Cushion DIKELUARKAN: isinya alas bedak CAIR yang diserap spons di dalam
// wadahnya, bukan bedak padat. Menyebutnya "powder pan" salah secara harfiah.
const KATA_BUBUK_PADAT = /\b(compact|bedak padat|pressed powder|blush on|blush|eyeshadow|eye shadow|highlighter|two way cake)\b/i;
const KATA_CUSHION = /\b(cushion)\b/i;
// Roll-on DIKELUARKAN dari sini: bolanya diputar menggelinding di kulit, tidak
// ada batang yang dinaikkan dengan memutar pangkalnya.
const KATA_ROLL_ON = /\b(roll on|roll-on|rollon)\b/i;
const KATA_OLES_PADAT = /\b(stick|balm|deodoran|deodorant|batangan)\b/i;
// Lotion/body bar TIDAK punya mekanisme putar-naik. Ia batangan telanjang yang
// digosok langsung ke kulit dan meleleh oleh suhu badan. Menyuruhnya "twisting
// its base" sama mustahilnya dengan menyuruh sabun batang dituang — aksi fisik
// yang tidak ada, dan model akan mengarang kemasan yang punya mekanisme itu.
const KATA_BATANG_GOSOK = /\b(lotion bar|body bar|massage bar)\b/i;
/** Kata bentuk padat umum — dipakai kalau tidak ada petunjuk yang lebih spesifik. */
const KATA_PADAT_UMUM = /\b(batang|bar|padat|solid)\b/i;
/** Zat yang LAZIMNYA cair — dipakai hanya kalau tidak ada kata bentuk. */
const KATA_ZAT_CAIR = /\b(serum|toner|essence|lotion|losion|gel|minyak|oil|ampoule|mist|spray|shampoo|sampo|conditioner|krim|cream)\b/i;

export function bentukProduk(nama: string, deskripsi?: string | null): BentukProduk {
  const teks = `${nama} ${deskripsi ?? ""}`;

  // "cair"/"liquid" MENANG ATAS SEGALANYA, termasuk atas kata benda bentuk.
  //
  // "Liquid Lipstick" sempat pulang sebagai padat karena "lipstick" diperiksa
  // lebih dulu — lalu di-demo seperti lipstik putar, padahal ia dioles pakai
  // aplikator. Kalau penjual menulis "liquid" secara eksplisit, itu koreksi
  // sadar terhadap bentuk yang biasanya diasumsikan orang, dan koreksi sadar
  // selalu menang atas tebakan kita.
  if (KATA_CAIR_TEGAS.test(teks)) return "tuang";

  if (KATA_SABUN_BATANG.test(teks)) return "sabun_batang";
  if (KATA_LIPSTIK.test(teks)) return "lipstik";
  // Cushion & roll-on diperiksa SEBELUM pola yang lebih longgar di bawahnya,
  // karena keduanya sering ditulis bersama kata yang akan salah menangkapnya
  // ("Cushion Compact", "Roll On Deodorant Stick").
  if (KATA_CUSHION.test(teks)) return "cushion";
  if (KATA_ROLL_ON.test(teks)) return "roll_on";
  if (KATA_BUBUK_PADAT.test(teks)) return "bubuk_padat";
  if (KATA_BATANG_GOSOK.test(teks)) return "batang_gosok";
  if (KATA_OLES_PADAT.test(teks)) return "oles_padat";
  // Padat tapi tidak jelas jenisnya. "Shampoo Bar" mendarat di sini kalau pola
  // sabun di atas tidak kena — dan itu benar: ia memang dibasahi dan berbusa.
  // Batangan yang zatnya lazim cair (shampoo bar, conditioner bar) memang
  // berbusa. Batangan lain jatuh ke aksi gosok, BUKAN aksi putar-naik: kalau
  // bentuk pastinya tidak jelas, menggosok benar untuk hampir semua batangan
  // sementara memutar hanya benar untuk yang berkemasan khusus.
  if (KATA_PADAT_UMUM.test(teks)) return KATA_ZAT_CAIR.test(teks) ? "sabun_batang" : "batang_gosok";
  if (KATA_ZAT_CAIR.test(teks)) return "tuang";
  return "tidak diketahui";
}

/** Kategori yang aksi demonya MENGANDAIKAN produk bisa dituang/dipompa.
 *
 *  Untuk kategori ini, bentuk yang tidak diketahui TIDAK boleh jatuh ke aksi
 *  kategori — menebak "tuangkan sedikit" pada barang yang ternyata padat
 *  menghasilkan persis cacat yang sedang diperbaiki. Kategori lain (fashion,
 *  food, gadget) aksinya tidak bergantung bentuk, jadi tetap dipakai. */
const KATEGORI_ANDAIKAN_TUANG = new Set(["beauty", "body_care"]);

/** Aksi per BENTUK, bukan per kategori.
 *
 *  Inilah inti perbaikannya: yang menentukan gerakan tangan adalah bentuk
 *  bendanya, bukan rak tempat ia dijual. Sabun berbusa, stick dioles, bedak
 *  ditekan, lipstik diputar — menyamakan keempatnya menghasilkan video yang
 *  memperagakan produk yang salah dengan sangat meyakinkan. */
const AKSI_PER_BENTUK: Record<Exclude<BentukProduk, "tuang" | "tidak diketahui">, string> = {
  sabun_batang:
    "wetting the solid bar under running water and rubbing it between both palms until a rich lather builds, showing the foam on her hands",
  oles_padat:
    "uncapping the solid stick, twisting its base so a little product rises, then gliding it in one smooth stroke along the BACK of her other hand and showing the satin trace it leaves, both hands clearly accounted for",
  bubuk_padat:
    "opening the compact, pressing a sponge lightly onto the powder so the pan surface shows, then tapping it onto the BACK of her other hand to reveal the colour, keeping the pan facing camera, both hands clearly accounted for",
  lipstik:
    "twisting the lipstick bullet up so its shaped tip is clearly visible to camera, then drawing one clean swatch stripe on the BACK of her other hand to show the true colour, both hands clearly accounted for",
  batang_gosok:
    "warming the bare solid bar between her fingers then gliding it directly along the BACK of her other hand, leaving a soft satin sheen as it melts on contact — the bar has no cap and no twist-up base, it is held and rubbed as-is, both hands clearly accounted for",
  roll_on:
    "uncapping the roll-on and rolling its ball smoothly along the BACK of her other hand so the wet trail it leaves is visible, the ball never twisted or pushed up, both hands clearly accounted for",
  cushion:
    "pressing the cushion puff onto the soaked sponge inside the case so it picks up liquid foundation, then patting it onto the BACK of her other hand where it blends into a dewy patch, the open case facing camera, both hands clearly accounted for",
};

const AKSI_NETRAL = "holding the product close to the camera and turning it slowly so its surface and texture read clearly, both hands visible";

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
/** DETIK PERTAMA — berlaku untuk SETIAP shot pembuka, level hook apa pun.
 *
 *  Temuan review kreatif 2026-08-14: shot pembuka format hands_only sudah
 *  punya aturan "starts ALREADY in motion", tapi talking_head dan ads TIDAK.
 *  Hasilnya pembuka yang secara harfiah statis — presenter memegang produk
 *  setinggi dada sambil tersenyum. Di FYP, satu detik diam adalah satu detik
 *  yang dipakai jempol untuk menggeser.
 *
 *  Ini BUKAN level "gila": tidak ada gerakan kamera dramatis, tidak ada
 *  pattern-interrupt. Yang dituntut cuma satu hal — sesuatu HARUS berubah
 *  sebelum detik pertama habis. Itu berlaku sama untuk iklan paling kalem.
 *
 *  Ditulis positif dan spesifik. "Buat menarik" bukan instruksi; "sudah
 *  bergerak sejak frame pertama, tanpa jeda diam di awal" bisa dikerjakan. */
const DETIK_PERTAMA =
  "The very first frame is ALREADY mid-action — the shot never opens on a held pose or a static " +
  "product. Within the first second something visibly changes: the subject is already moving, " +
  "turning, reaching, or reacting, and the camera is already drifting. No frozen opening beat. ";
const DETIK_PERTAMA_NETRAL =
  "The very first frame is ALREADY mid-action — the shot opens on the blank prop already moving within " +
  "the staged action. Within the first second something visibly changes: the subject is already moving, " +
  "turning, reaching, or reacting, and the camera is already drifting. No frozen opening beat. ";

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

/**
 * Kunci UKURAN ASLI produk (standar 10/10 §C.10).
 *
 * Ditulis positif dan disematkan di TIAP shot, bukan sekali di header: cacat
 * yang diperbaikinya nyata dan sudah terjadi — foto referensi ikut dibaca
 * sebagai objek adegan lalu ditempel jadi bidang depan raksasa (sepertiga
 * layar terisi kotak seukuran meja). Larangan negatif tidak dipakai karena
 * negasi justru memanggil objeknya kembali.
 */
function kunciUkuranAsli(namaProduk: string): string {
  return (
    `Every "${namaProduk}" in frame is at its true small size, about the width of a hand, ` +
    `resting on a surface or held in her hand, and the camera keeps a normal conversational distance from it.`
  );
}

/**
 * Padanan kunci ukuran untuk visual netral yang memang tidak boleh membawa
 * nama, foto, atau identitas produk. Gerbang akhir tetap keras pada skala dan
 * jarak kamera, tetapi subjeknya adalah properti polos yang aman.
 */
function kunciUkuranPropertiNetral(): string {
  return NEUTRAL_PROP_SIZE_LOCK;
}

/**
 * Kunci BAHASA 4 lapis (standar 10/10 baris 9).
 *
 * Empat lapis karena satu kalimat tidak cukup: bukti produksi menunjukkan
 * model tetap menyelipkan ucapan Inggris kalau bahasanya hanya disebut sekali
 * di tengah prompt panjang. Lapis 3 (label dialog) dirakit di tempat dialog
 * disusun; tiga lapis lain di sini.
 *
 * "no English speech" SENGAJA di prompt positif, bukan negative: frasaNegatifBersih()
 * membuang awalan "no " di blok negatif, sehingga kalimat ini justru akan
 * berubah menjadi perintah "English speech" kalau ditaruh di sana.
 */
function kunciBahasa(mode: "presenter" | "voiceover"): { header: string; perShot: string; penutup: string } {
  return {
    header: "Every spoken word is Indonesian.",
    perShot:
      mode === "presenter"
        ? "She speaks Indonesian (Bahasa Indonesia)."
        : "The voiceover is spoken in Indonesian (Bahasa Indonesia).",
    penutup: "no English speech.",
  };
}

/**
 * SINEMATOGRAFI PENULIS untuk satu shot (board review 20 Agu).
 *
 * Penulis LLM menghasilkan framing/angle/camera/action per segmen, dan
 * keSegmentDraft() sudah menyimpannya utuh — tapi perencana shot tidak pernah
 * membacanya. Akibatnya koreografi selalu datang dari tabel beat tetap, jadi
 * setiap video dengan format sama mendapat tiga beat identik. Video yang bisa
 * ditukar satu sama lain adalah definisi AI-slop, dan ia lahir di sini.
 *
 * Yang MENANG: aksi penulis mengganti beat tabel — itu inti koreografinya.
 * Yang DITAMBAHKAN, bukan menggantikan: framing/angle/camera, karena framing
 * bawaan membawa kunci keselamatan filter (dada ke atas, satu orang) yang
 * tidak boleh hilang hanya karena penulis menulis "wide".
 */
/**
 * Pengikat kehadiran produk untuk aksi penulis.
 *
 * Dari render adu 20 Agu (test_output/adu_koreografi, dibayar): aksi penulis
 * berbunyi "camera sweeps left to right across the mess, THEN pauses on the
 * serum bottle". Model menurutinya secara harfiah — botol baru masuk frame di
 * detik ~2,5 dari klip 5 detik, padahal prompt yang sama juga memuat kunci
 * "the ENTIRE bottle stays completely inside the frame at all times".
 *
 * Jadi dua aturan bertabrakan di satu prompt dan yang menang adalah kalimat
 * yang berbentuk koreografi, bukan kalimat yang berbentuk batasan. Untuk hook
 * afiliasi 5 detik, setengah durasi tanpa produk adalah kerugian konversi yang
 * nyata — bukan selera.
 *
 * Perbaikannya menyatakan kehadiran produk sebagai KEADAAN AWAL aksi itu
 * sendiri, sehingga tidak ada lagi dua aturan yang berlomba. Kategori jasa
 * dikecualikan: di sana memang tidak ada benda yang boleh muncul.
 *
 * TERUKUR DAN BELUM CUKUP (render verifikasi 20 Agu, V1-hook): dengan pengikat
 * ini terpasang, botol TETAP baru masuk frame di detik ~2 dari 5. Aksi penulis
 * berbunyi "...THEN pauses on the serum bottle" dan kalimat berbentuk
 * koreografi itu tetap menang atas prefiks berbentuk batasan.
 *
 * Kesimpulan jujur: ini menolong, tapi akar masalahnya di HULU — penulis tidak
 * seharusnya menulis aksi yang menunda kemunculan produk pada shot pembuka.
 * Menambal di perakit prompt berarti melawan kalimat penulis dengan kalimat
 * lain di prompt yang sama, dan putaran ini membuktikan siapa yang menang.
 * Jangan klaim cacat ini beres sampai ada render yang menunjukkan sebaliknya.
 */
const praAksiHadir = (nama: string) =>
  `"${nama}" is already fully inside the frame from the very first frame and never leaves it; ` +
  `within that frame, `;

/**
 * Framing penulis yang mendekat ke label, ditumpulkan.
 *
 * Kebijakan jarak (A, 20 Agu) tidak ada gunanya kalau kalimat berikutnya di
 * prompt yang sama berbunyi "tight macro" — dan penulis memang menulis begitu
 * pada shot CTA, karena secara sinematik itu benar. Yang salah bukan seleranya,
 * melainkan bahwa model tidak bisa menulis huruf: begitu label mengisi frame,
 * hurufnya ter-resolve dan jadi karangan.
 *
 * Jadi macro diturunkan ke close biasa HANYA untuk produk berlabel. Framing
 * penulis yang lain lewat apa adanya.
 */
const MACRO = /\b(tight\s+)?macro\b|extreme close|extreme wide|super close/gi;
function tumpulkanMacro(kamera: string, adaLabel: boolean): string {
  return adaLabel ? kamera.replace(MACRO, "close, at arm's-length viewing distance") : kamera;
}

function sinematografiPenulis(
  segs: SegmentDraft[],
  adaLabel: boolean,
  gunakanKomposisiPenulis = true
): { aksi: string; kamera: string; tanpaWajah: boolean } | null {
  const beraksi = segs
    .filter((sg) => (sg.action ?? "").trim().length > 12)
    .slice()
    .sort((a, b) => a.start - b.start);
  const utama = beraksi[0];
  if (!utama) return null;
  // Neutral Story Ads hanya mempercayai aksi yang lolos grammar blank-prop.
  // Framing/angle/camera/expression LLM tidak pernah mencapai prompt; dunia
  // dan komposisinya selalu berasal dari tabel role netral yang dikurasi.
  const kamera = gunakanKomposisiPenulis ? tumpulkanMacro(
    [utama.framing, utama.angle, utama.camera]
      .map((x) => (x ?? "").trim())
      .filter(Boolean)
      .join(", "),
    adaLabel
  ) : "";
  const aksi = beraksi.length === 1
    ? String(utama.action).trim()
    : `single-shot timed progression: ${beraksi.map((sg, index) => {
        const label = sg.label ?? sg.role.toUpperCase();
        const transisi = index === 0 ? "at" : "then at";
        return `${transisi} ${sg.start}-${sg.end} seconds [${label}], ${String(sg.action).trim()}`;
      }).join("; ")}`;
  return {
    aksi,
    kamera,
    // Penulis menandai sendiri bahwa wajah tidak terlihat di beat ini. Sebelum
    // ini penandanya diabaikan dan kamera memanggil wajah kembali ke frame —
    // persis konfigurasi yang catatan filter kita beri 0 dari 3 kelulusan.
    tanpaWajah: gunakanKomposisiPenulis && /not visible|tidak terlihat|off camera/i.test(utama.expression ?? ""),
  };
}

/**
 * Kalimat kamera+aksi dari format ide, atau "" bila formatnya tidak dikenal.
 *
 * Dibaca dari knowledge/formats/*.json (field `planner`), bukan disalin ke
 * kode: tabel yang disalin adalah tabel yang akan berpisah dari dokumennya.
 */
function petunjukFormatIde(id: string | null | undefined): string {
  if (!id) return "";
  const f = formatById(String(id));
  if (!f?.planner) return "";
  const bagian = [f.planner.kamera, f.planner.aksi].filter(Boolean).join(". ");
  return bagian ? `Format ${f.id}: ${bagian}.` : "";
}

export function planShots(input: ShotPlanInput): VisualSpec {
  // Kategori kreator WAJIB objek utuh, bukan id.
  //
  // Tanpa pemeriksaan ini, pemanggil yang mengoper string (mis. "hijaber")
  // menghasilkan `input.category.promptSeed === undefined`, dan kata literal
  // "undefined" ikut terkirim ke penyedia BERBAYAR tanpa satu pun kegagalan
  // terlihat. Ditemukan saat audit 19 Agu — di harness audit itu sendiri,
  // bukan di jalur produksi, dan justru itu sebabnya ia layak dijaga: jalur
  // yang gagal diam-diam menunggu pemanggil berikutnya.
  const kategori = input.category as Partial<CreatorCategory> | string | null | undefined;
  if (!kategori || typeof kategori !== "object" || !kategori.promptSeed || !kategori.handsPrompt || !kategori.negativePrompt) {
    throw new TypeError(
      `planShots: kategori kreator tidak sah (butuh objek CreatorCategory utuh, dapat ${typeof kategori}) — prompt tidak dirakit.`
    );
  }
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
  // MODUL ~5 DETIK UNTUK SEMUA FORMAT TANPA WAJAH, bukan potongan 15 detik.
  //
  // hands_only dulu memakai ceil(durasi/15): video 20 detik keluar sebagai DUA
  // shot 10 detik. Padahal tangga beat di bawah (HANDS_MIDDLE) punya empat anak
  // tangga dengan tugas berbeda-beda, dan komentar tangga itu sendiri berbunyi
  // "yang menahan perhatian bukan shot bagus yang diulang, tapi shot yang
  // BERGANTI TUGAS" — lalu kita cuma pernah memberinya dua tugas. Naskah
  // rujukan produksi memakai 15s→3, 20s→4, 30s→5-6 segmen, masing-masing 4-6
  // detik, dan itu memang yang membuat videonya terasa bergerak.
  //
  // Biaya TIDAK naik: provider menagih PER DETIK video (byteplus estimateCost
  // menjumlahkan durasi shot), jadi 4x5 detik sama mahalnya dengan 2x10 detik.
  //
  // talking_head SENGAJA DIKECUALIKAN dan tetap 15 detik per shot. Tiap shot
  // adalah generate TERPISAH dan model tidak menjamin identitas antar generate
  // — insiden produksi 7 Agu 2026: video 15 detik yang dipecah dua shot
  // menghasilkan DUA KARAKTER BERBEDA. Tangan tidak punya masalah itu, wajah
  // punya. Jadi penghalusan segmen berhenti di batas wajah.
  // DURASI PER SHOT WAJIB BULAT.
  //
  // BytePlus MEMBULATKAN NAIK durasi klip, jadi pembagian berpecahan
  // memanjangkan videonya diam-diam: 45 detik dibagi 6 = 7,5 detik per shot,
  // dibulatkan jadi 8, dan hasil akhirnya 48 detik padahal pengguna meminta 45.
  // Karena itu jumlah shot diturunkan sampai ia membagi habis durasinya.
  function modulRapi(durasi: number, minimal: number): number {
    const ideal = Math.min(6, Math.max(minimal, Math.round(durasi / 5)));
    for (let n = ideal; n >= minimal; n--) {
      if (durasi % n === 0 && durasi / n >= MIN_SHOT_SEC && durasi / n <= 15) return n;
    }
    return minimal;
  }
  // WAJAH TIDAK BOLEH DIPECAH selama Seedance menolak referensi berwajah.
  //
  // Tiap shot adalah generate TERPISAH; tanpa referensi wajah, identitas hanya
  // dibawa deskripsi teks — dan itu tidak cukup. Terbukti dua kali: insiden 7
  // Agu (15 detik dipecah dua shot -> DUA KARAKTER BERBEDA) dan jalankan STEP 2
  // 17 Agu (tiga segmen -> tiga orang, pakaian ikut berganti).
  //
  // Ini menutup lubang yang tersisa: shotCountOverride bisa memaksa
  // talking_head jadi 2-6 shot, melewati aturan ceil(durasi/15) di bawahnya.
  // Overridenya diabaikan untuk format berwajah, bukan dihormati diam-diam —
  // menghormatinya berarti menjual video yang orangnya berganti di tengah.
  //
  // Batas jujurnya: durasi >15 detik TETAP harus dipecah, karena satu klip
  // Seedance maksimal 15 detik. Di atas 15 detik, talking_head memang belum
  // punya jaminan identitas — itu yang harus dikatakan ke pengguna, bukan
  // ditutupi.
  const neutralStoryAds = isNeutralStoryAdsTemplate(input.ugcTemplate);
  // Story Ads membutuhkan shot pembuka provider yang benar-benar senyap.
  // Karena itu override modulnya tetap dihormati meski format presenter;
  // persona netral terkurasi menjaga identitas tanpa referensi pengguna.
  const wajahTerkunci = format === "talking_head" && !config.seedanceFaceRef && !neutralStoryAds;
  if (input.reviewedEvidenceSinglePost && (format !== "hands_only" || input.durationSec > 15)) {
    throw new Error("REVIEWED_EVIDENCE_SINGLE_POST_SHAPE_INVALID");
  }
  const numShots = input.reviewedEvidenceSinglePost ? 1 : wajahTerkunci
    ? Math.max(1, Math.ceil(input.durationSec / 15))
    : requested !== null ? requested : format === "talking_head"
      ? Math.max(1, Math.ceil(input.durationSec / 15))
      : modulRapi(input.durationSec, format === "tvc" ? 3 : 2);
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
  // Sejalan dengan worker: presenter yang TERLIHAT sekarang benar-benar
  // berbicara (audio native Seedance), bukan diam sambil ditimpa VO. Larangan
  // "no lip-sync to any specific words" karena itu tidak lagi dipasang untuk
  // format berpresenter — larangan itu ada semata karena VO-nya dulu diganti.
  const lipSyncPresenter = format === "talking_head" || format === "tvc";

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
  /**
   * Tiap segmen jatuh ke TEPAT SATU shot: yang irisan waktunya paling besar.
   *
   * Menyaring "segmen yang beririsan" saja tidak cukup — segmen demo 9 detik
   * beririsan dengan tiga shot 5 detik sekaligus, dan kalimatnya akan
   * diucapkan tiga kali. Yang benar: satu kalimat, satu shot, dan shot lain di
   * rentang itu jadi beat visual TANPA dialog. Justru itu yang memberi ruang
   * bernapas untuk beat sensorik (busa, tuang, tekstur) — bukan kekurangan.
   */
  const segmenMilikShot = (i: number) =>
    input.segments.filter((sg) => {
      let terbaik = -1;
      let irisanTerbesar = 0;
      for (let k = 0; k < numShots; k++) {
        const irisan = Math.min(sg.end, (k + 1) * perShot) - Math.max(sg.start, k * perShot);
        if (irisan > irisanTerbesar) { irisanTerbesar = irisan; terbaik = k; }
      }
      return terbaik === i;
    });

  const trustedNumericScaffoldsForShot = (i: number, shotLabelOccurrences = 1): string[] => [
    `${input.durationSec}-second`,
    ...Array.from({ length: shotLabelOccurrences }, () => `Shot ${i + 1} of ${numShots}`),
    ...segmenMilikShot(i).map((sg, index) =>
      `${index === 0 ? "at" : "then at"} ${sg.start}-${sg.end} seconds`
    ),
  ];

  const dialogueForShot = (i: number): string[] =>
    // TVC dipecah jadi 3-6 modul, jadi tangga "hook / demo / sisanya CTA" di
    // bawah tidak bisa dipakai: shot 3,4,5 semuanya akan kebagian kalimat
    // penutup dan mengulang CTA empat kali. Segmen skrip punya start/end
    // sungguhan, jadi tiap shot mengambil kalimat yang jendela waktunya
    // memang beririsan dengan shot itu. Shot tanpa irisan sengaja dibiarkan
    // tanpa dialog — beat visual murni, dan VO final tetap dirakit utuh oleh
    // Gemini TTS di atas video, bukan dari teks per-shot ini.
    // JENDELA WAKTU untuk SEMUA format bershot banyak, bukan cuma TVC.
    //
    // Tangga "hook / demo / sisanya CTA" hanya benar saat shotnya tepat tiga.
    // Sejak format tanpa wajah memakai modul 5 detik (17 Agu), video 20 detik
    // jadi EMPAT shot — dan tangga itu memberi kalimat CTA ke shot 2 DAN 3.
    // Penutupnya diucapkan dua kali, dan model diminta memeragakan CTA dua
    // kali. Komentar di jalur TVC sudah memperingatkan pola ini; kesalahannya
    // adalah memakai jalur berbeda untuk masalah yang sama.
    //
    // Segmen skrip punya start/end sungguhan, jadi tiap shot mengambil kalimat
    // yang jendela waktunya memang beririsan dengannya. Shot tanpa irisan
    // sengaja dibiarkan TANPA dialog — beat visual murni, dan itu justru yang
    // membuat beat sensorik (busa, tuang, tekstur) punya ruang bernapas.
    neutralStoryAds && i === 0
      ? []
      : numShots === 1
      // Satu klip talking-head tetap memuat SELURUH timeline. Story OS Ads
      // punya dua beat role="story" (FRICTION kedua + SPIKE); menyusun dialog
      // dari tiga nama role lama membuang keduanya dari performance prompt
      // sementara TTS final tetap mengucapkannya.
      ? input.segments.slice().sort((a, b) => a.start - b.start).map((sg) => stripDeliveryTags(sg.text))
      : segmenMilikShot(i).map((sg) => stripDeliveryTags(sg.text));

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
      avoid: `her head stays steady so the surprise reads clearly`,
      pace: `snappy and brisk, energy kept high throughout`,
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
      role: `the garment correcting ITSELF after a real action — an arm raised to write or reach, then lowered, and the sleeve and body of the garment fall back into a clean line entirely by themselves, untouched`,
      camera: `steady medium shot, no movement`,
      avoid: `the fabric settles on its own, untouched`,
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
      avoid: `the infant is seen strictly from behind, only the back of the head visible; the only limbs in frame are her own two hands`,
      pace: `slow and deliberate`,
    },
    {
      role: `rhythm: a steady gentle repeated motion — swaying, patting — the kind that only works because it is boring, only the back of the small head visible`,
      camera: `moving in slowly toward the repeating hand`,
      avoid: `the infant stays seen from behind, and the motion stays smooth throughout`,
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
      avoid: `her head stays steady and her expression shifts gradually`,
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
      avoid: `a product-only frame, held locked and steady`,
      pace: `unhurried, deliberate`,
    },
    {
      role: `an abstract visualisation of how it works: light, particles or structure suggesting the mechanism, dreamlike rather than literal`,
      camera: `slow forward dolly diving into the material`,
      avoid: `a product-only frame with steady exposure`,
      pace: `slow and continuous`,
    },
    {
      role: `the result the product leaves behind, observed in a clean beauty-shot close-up, lit to be read instantly`,
      camera: `static frame with a subtle rack focus landing on the detail`,
      avoid: `a product-only frame with restrained motion`,
      pace: `still, letting the detail be read`,
    },
    {
      role: `the product resting in an art-directed setting that suggests where it belongs, still the only subject in frame`,
      camera: `very slow push-in on the product`,
      avoid: `a product-only frame with the camera locked off`,
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
    `photorealistic, luxury commercial still, framed from the chest up whenever a person is in frame, soft cinematic lighting, shallow depth of field, ` +
    `high detail texture, the room, its furniture and their exact shapes stay identical across every shot, ` +
    // Titik di ujung BUKAN kosmetik: tanpa itu kalimat berikutnya menempel
    // langsung ("...no watermark EXACTLY ONE person is present..."), dan yang
    // dibaca model — juga detektor kita — adalah "no watermark EXACTLY ONE
    // person". Satu tanda baca yang hilang mengubah larangan watermark jadi
    // negasi tentang orang di 23 shot.
    `nothing stretches or changes proportion, no text, no logo, no watermark.`;
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
      avoid = `the garment is still moving as the shot ends — in motion on the body, rather than resting on a hanger or laid flat — and the full silhouette stays inside the frame`;
      pace = `unhurried, cinematic`;
    } else if (i === numShots - 1) {
      // Packshot = PRODUK SAJA. Itu memang yang dilakukan TVC sungguhan di
      // lima detik terakhir, dan sekaligus menghapus prasyarat cacat
      // penggandaan: tidak ada orang untuk digandakan.
      tanpaOrang = true;
      role =
        `the hero shot: the product completely alone in frame, front-facing and centred on a clean, deliberately lit ` +
        `surface or seamless backdrop, filling roughly a third of frame — the packshot a brand would sign off on. ` +
        `The frame holds only the product and the surface it rests on`;
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
      `${tanpaOrang ? `This shot is product-only: the frame holds just the product, its surface, and the light on it. ` : `This is the SAME woman from the earlier shots, seen at a LATER MOMENT — same face, same hair, same outfit. She exists only ONCE inside this frame: the continuity runs across time between shots, never as a side-by-side comparison within a single frame. `}` +
      `${TVC_IDENTITY} ${TVC_STYLE_LOCK}`
    ), tanpaOrang };
  };

  const curatedNeutralCategory = neutralStoryAds ? getCreatorCategory(input.category.id) : null;
  if (neutralStoryAds && !curatedNeutralCategory) {
    throw new Error(`Kontrak neutral Story Ads: persona "${input.category.id}" tidak ada di allowlist terkurasi.`);
  }
  const visualCategory = curatedNeutralCategory ?? input.category;
  if (isStructuredStoryAds({ contentType: input.contentType, templateId: input.ugcTemplate })) {
    const records = input.segments as Array<SegmentDraft & Record<string, unknown>>;
    const storyFindings = [
      ...temuanHookSenyapAds(records),
      ...temuanStrukturStoryAds(records).map((finding) => `${finding.gerbang}: ${finding.pesan}`),
      ...temuanBridgeStoryAds(records, {
        contentType: input.contentType, templateId: input.ugcTemplate,
        productName: input.productName, productCategory: input.productCategory, productPriceIdr: input.productPriceIdr,
      }).map((finding) => `${finding.gerbang}: ${finding.pesan}`),
    ];
    if (storyFindings.length > 0) {
      throw new Error(`Kontrak Story Ads dilanggar sebelum prompt provider: ${storyFindings.join(", ")}`);
    }
  }
  if (neutralStoryAds) {
    for (const segment of input.segments) {
      if (segment.action) {
        const contradictions = neutralStoryAdsActionContradictions(segment.action, {
          productName: input.productName,
          productCategory: input.productCategory,
        });
        if (contradictions.length > 0) {
          throw new Error(`Kontrak visual neutral Story Ads dilanggar sebelum prompt final: ${contradictions.join(", ")}`);
        }
      }
      for (const [fieldName, field] of Object.entries({
        role: segment.role,
        label: segment.label,
        mode: segment.mode,
        saksi: segment.saksi,
      })) {
        if (!field) continue;
        const findings = neutralStoryAdsUntrustedNumericContradictions(String(field));
        if (findings.length > 0) {
          throw new Error(`Kontrak chunk ${fieldName} neutral Story Ads dilanggar: ${findings.join(", ")}`);
        }
      }
      for (const [fieldName, field] of Object.entries({
        visual_direction: segment.visual_direction,
        start_state: segment.start_state,
        framing: segment.framing,
        angle: segment.angle,
        camera: segment.camera,
        expression: segment.expression,
      })) {
        if (!field) continue;
        const fieldFindings = neutralStoryAdsUntrustedFieldContradictions(field, {
          productName: input.productName,
          productCategory: input.productCategory,
        });
        if (fieldFindings.length > 0) {
          throw new Error(`Kontrak field ${fieldName} neutral Story Ads dilanggar: ${fieldFindings.join(", ")}`);
        }
      }
    }
  }
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
    // STANDAR-10 §E (9 render nyata 18 Agu): SEMUA yang lolos NSFW membuka
    // tanpa wajah; SEMUA yang wajahnya tampil di shot 1 ditolak. Standarnya
    // eksplisit: "Jadikan ini default, bukan pilihan." Maka multi-shot
    // talking_head membuka dengan tangan + produk; wajah presenter masuk
    // mulai shot 2. Pengecualian yang DISENGAJA, bukan lupa:
    //  - numShots 1: talking_head 15 dtk sengaja tak dipecah (kontinuitas
    //    wajah antar klip) — tanpa wajah ia bukan talking_head lagi;
    //  - fashion full-body: produknya DIPAKAI presenter, mustahil tanpa orang;
    //  - gaya rekam & peran template opening: pilihan sadar pengguna/katalog.
    // Ini perubahan level PROMPT — bukti piksel menyusul di canary berikutnya.
    // SHOT 1 TANPA WAJAH — kini berlaku untuk ads dan tvc juga (board review
    // 20 Agu). Bukan preferensi gaya: standard-10.md §E mencatat dari 9 render
    // nyata bahwa SEMUA klip yang lolos filter penyedia membuka tanpa wajah,
    // dan 0 dari 3 yang membuka dengan wajah lolos. Dokumennya sendiri menulis
    // "jadikan ini default, bukan pilihan" — tapi kodenya hanya memberlakukannya
    // pada talking_head, sehingga format ads dikirim ke antrean berbayar
    // dengan konfigurasi yang catatan kita sendiri beri 0% kelulusan.
    const sinema = sinematografiPenulis(
      segmenMilikShot(i),
      !isServiceLike(input.productCategory),
      !neutralStoryAds
    );
    const formatBukaTanpaWajah = format === "talking_head" || format === "ads" || format === "tvc";
    const bukaTanpaWajah =
      // Penanda penulis "expression: not visible" ikut memutuskan, bukan cuma
      // format dan urutan shot.
      ((isFirst && numShots >= 2 && formatBukaTanpaWajah) || (sinema?.tanpaWajah ?? false)) &&
      !input.noModel && !fullBodyFashion && !gayaBerlaku && !ugcRolesFor(input.ugcTemplate)?.opening;
    // SUMBU MODE (slice 1, 19 Agu). Mode segmen — sampai kini cuma label
    // metadata — kini menentukan kontrak kamera shot, sesuai modes.md:
    // "Any segment whose camera contradicts its governing mode fails the gate".
    //
    // Urutan kalah-menangnya sengaja: shot pembuka tanpa wajah tetap menang
    // (ia menjaga lolos filter, bukan sekadar gaya), lalu gaya rekam yang
    // dipilih brand secara eksplisit di dashboard, baru mode dari naskah.
    // Mode tak dikenal = diabaikan, bukan diteruskan (lihat kontrakMode).
    const modeShot = segmenMilikShot(i).map((sg) => sg.mode).find((m) => modeDikenal(m)) ?? null;
    const framingMode = !bukaTanpaWajah && !gayaBerlaku ? framingUntukMode(modeShot) : null;
    const framing = bukaTanpaWajah
      ? `${HANDS_ONLY_FRAMING}. ${HANDS_ONLY_HAND_LOCK}`
      : gayaBerlaku
      ? `${gayaBerlaku.framing}. `
      : framingMode
      ? `${framingMode}. `
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
      ? `"${input.productName}" itself as the sole subject, the frame belonging entirely to the product`
      // Shot pembuka tanpa wajah: subjeknya TANGAN, bukan persona — promptSeed
      // mendeskripsikan wajah, dan menyebutnya di sini memanggil wajah ke frame.
      : bukaTanpaWajah
      ? visualCategory.handsPrompt
      : format === "talking_head" || format === "tvc" || format === "ads"
      ? `${visualCategory.promptSeed}, ${visualCategory.deliveryPrompt}`
      : visualCategory.handsPrompt;
    // Bentuk produk mengalahkan kategori: kategori tahu JENIS-nya, bentuk tahu
    // apa yang FISIKNYA MUNGKIN. Kategori beauty untuk sabun batang tetap
    // beauty, tapi "menuangkan sedikit produk" tidak pernah bisa benar.
    const bentuk = bentukProduk(input.productName, input.productVisualDesc);
    const demoAction =
      // Bentuk spesifik punya aksinya sendiri, dan aksi itu MENGALAHKAN aksi
      // kategori. Sabun berbusa, stick dioles, bedak ditekan, lipstik diputar
      // — dulu keempatnya memakai satu aksi sabun karena semuanya cuma diberi
      // label "padat".
      bentuk !== "tuang" && bentuk !== "tidak diketahui"
        ? AKSI_PER_BENTUK[bentuk]
        // Bentuk tidak diketahui + kategori yang mengandaikan bisa dituang =
        // aksi netral. Menebak "tuangkan sedikit" pada barang yang ternyata
        // padat menghasilkan cacat yang sedang diperbaiki; aksi netral benar
        // untuk keduanya.
        : bentuk === "tidak diketahui" && KATEGORI_ANDAIKAN_TUANG.has(input.productCategory)
          ? AKSI_NETRAL
          : (DEMO_ACTION[input.productCategory] ?? DEMO_ACTION.default);
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
    // JALUR TANGAN HARUS IKUT SADAR BENTUK — dan sampai sekarang TIDAK.
    //
    // Ini akar yang tersisa dari cacat JJ Glow, dan ia bertahan melewati dua
    // putaran perbaikan karena tidak ada yang memeriksa prompt AKHIR-nya.
    // demoAction (yang membawa seluruh taksonomi bentuk) hanya dipakai
    // HEAD_MIDDLE, yaitu format Wajah AI. Untuk hands_only — format retail
    // paling umum — beat tengahnya generik, dan slot ketiganya bahkan
    // menyuruh "mengeluarkan isinya" ke produk APA PUN. Untuk sabun batang,
    // stick, bedak, atau lipstik itu mustahil, jadi model mengarang bentuk
    // produk yang bisa dikeluarkan isinya. Persis mekanisme yang sama dengan
    // insiden aslinya, cuma di beat yang berbeda.
    //
    // Slot 0 sekarang membawa aksi bentuknya, dan slot 2 punya versi padat
    // yang tidak menjanjikan isi yang bisa keluar.
    const bentukPadat = bentuk !== "tuang" && bentuk !== "tidak diketahui";
    const HANDS_MIDDLE = [
      `Close-up of hands as she ${demoAction}, the product kept angled so its label keeps facing the camera and stays legible throughout — fingers never cover the label, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up texture, natural phone camera movement`,
      `Macro close-up of the product's own texture and material filling most of the frame — the surface, the consistency, the detail a buyer wants to inspect before paying, the product body still partly visible with its label readable at the frame edge, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
      bentukPadat
        ? `Hands turning the product slowly so a different side of its solid body comes into view, the shape and edges reading clearly, nothing poured and nothing dispensed, label kept facing the camera throughout, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up, natural phone camera movement`
        : `Hands opening or dispensing the product so its contents become visible coming out, the amount clear, label kept facing the camera throughout, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up, natural phone camera movement`,
      `The product resting in the everyday place it would actually be used, hands entering frame to adjust or pick it up, the surroundings quietly telling the viewer where this belongs, label facing camera, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
    ];
    const HEAD_MIDDLE = [
      `Close cutaway on presenter's hands as she ${demoAction}, her face softly out of focus and her lips closed and relaxed, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
      `Macro close-up of the product's texture where it has just been used, filling most of the frame, the presenter softly out of focus behind with her lips closed and relaxed, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
      `Presenter looking down at the result with a genuinely pleased reaction, lips closed and relaxed throughout — listening rather than speaking, the product held in frame with its label facing camera, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`,
      `Close cutaway on the presenter's hands slowly turning the product to show a different side of it, label kept readable throughout, her face softly out of focus and her lips closed and relaxed, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`,
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
    const noPhysicalProduct = isServiceLike(input.productCategory);
    const neutralVisual = neutralStoryAds || noPhysicalProduct;
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
      // Penulis naskah menang atas peran template. Kalau LLM menulis produknya
      // belum tampil, shot-nya TIDAK boleh berangkat dari foto produk — kalau
      // tidak, model diberi barang yang diperintahkan disembunyikan, dan detik
      // pertamanya kembali jadi pack shot.
      //
      // Yang dibaca hanya segmen PALING AWAL di shot ini, bukan semuanya.
      // withholdProduct mengatur FRAME PERTAMA, sementara satu shot bisa
      // memuat beberapa segmen — talking_head 15 dtk sengaja tidak dipecah
      // (wajahnya bergeser antar klip), jadi hook, demo, dan CTA-nya berada di
      // klip yang sama. Membaca "ada yang hidden" akan membuat hook menahan
      // produk sepanjang video, termasuk CTA yang justru harus hero.
      const awal = segmenMilikShot(i).slice().sort((a, b) => a.start - b.start)[0];
      if (awal?.product_state === "hidden") return true;
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
          ? neutralVisual
            ? `This is the OPENING shot of a continuous ${input.durationSec}-second staged story using only neutral blank props. `
            : `This is the OPENING shot of a continuous ${input.durationSec}-second story about "${input.productName}". `
          : isLastShot(i, numShots)
            ? `This is the FINAL shot, resolving what the earlier shots built up. `
            : `This shot continues directly from the previous one — same place, same person, same look, one step further on. `}` +
        `Shot ${i + 1} of ${numShots}: ${pick.role}. Camera: ${pick.camera}. ` +
        `This is the SAME woman from the earlier shots, seen at a LATER MOMENT — same face, same hair, same outfit. She exists only ONCE inside this frame: the continuity runs across time between shots, never as a side-by-side comparison within a single frame. ` +
        `${neutralVisual ? "All generated props remain unprinted and non-factual." : IDENTITY_INSTRUCTION}`
      );
    };
    // Tanpa-produk ditentukan KATEGORI, bukan format: iklan untuk barang fisik
    // tetap menampilkan barangnya. Lihat isServiceLike di lib/config/hooks.ts.
    const beatTvc = format === "tvc" ? tvcBeat(i) : null;
    // AKSI PENULIS MENANG atas tabel beat (board review 20 Agu). Kalimatnya
    // dirakit dengan kunci identitas produk supaya presisi koreografi tidak
    // menukar presisi identitas — keduanya harus ada, bukan salah satu.
    const aksiPenulis = sinema
      ? neutralVisual
        ? sinema.aksi
        : `${praAksiHadir(input.productName)}${sinema.aksi}, ${IDENTITY_INSTRUCTION}`
      : null;
    const peranTemplate = ugcBeat(i);
    const beat =
      (peranTemplate && aksiPenulis
        // Peran template memegang dunia, komposisi, dan kesinambungan yang
        // sudah dibuktikan render; aksi terstruktur penulis tetap menang pada
        // koreografi DI DALAM dunia itu. Membuang salah satunya membuat Ads
        // kembali generik atau kehilangan jangkarnya.
        ? `${peranTemplate} Scripted action inside that exact setup: ${aksiPenulis}`
        : aksiPenulis ?? peranTemplate) ??
      (format === "ads" && noPhysicalProduct
        // Iklan jasa: yang diperagakan adalah MANFAAT, bukan benda. Presenter
        // tidak memegang apa pun — begitu diminta memegang sesuatu, model akan
        // mengarang produk yang tidak pernah ada, dan itu justru menyesatkan
        // calon pembeli jasa.
        ? isFirst
          ? `A person presenting a service concept straight to camera, relaxed and convincing, hands free and gesturing naturally. The place around them fits the business being described`
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
              : bukaTanpaWajah
                ? `Hands lifting "${input.productName}" up into center frame in one quick confident motion, product label facing camera, the framing staying on hands and product for this whole opening shot, ${IDENTITY_INSTRUCTION}, natural phone camera movement`
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
              ? `Presenter holds "${input.productName}" up to the camera at chest height with a warm delighted reaction — lips closed and relaxed in a soft closed-lip smile, listening rather than speaking — product label facing camera, then the camera lingers on a close cutaway of her hands as she ${demoAction} (her face softly out of focus during this part), ending with her looking back up at the camera with a warm inviting smile and a small nod, lips still closed, ${IDENTITY_INSTRUCTION}`
              : bukaTanpaWajah
                ? `Hands lifting "${input.productName}" up into center frame in one quick confident motion, product label facing camera, the framing staying on hands and product for this whole opening shot, ${IDENTITY_INSTRUCTION}, natural phone camera movement`
                : `Presenter holding "${input.productName}" up to the camera at chest height with a warm reaction, lips closed and relaxed, listening rather than speaking, ${IDENTITY_INSTRUCTION}`
            : isClosing
              ? `Presenter smiling warmly with her lips closed and relaxed, gesturing invitingly toward the camera as if wrapping up, product still clearly visible, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}`
              : HEAD_MIDDLE[midIdx % HEAD_MIDDLE.length]
        : isFirst
          // r13 (Brian 2026-08-07: "kenapa ada gambar Wardah di depan?" — shot
          // pembuka terlihat seperti foto produk diam sebelum tangan "masuk").
          // Motion eksplisit SEJAK FRAME PERTAMA supaya model tidak menganggur
          // di seed image yang statis di awal generate.
          //
          // TAPI GERAKANNYA BUKAN LAGI MEMEGANG PRODUK.
          //
          // Versi sebelumnya membuka dengan produk sudah di tangan dan label
          // menghadap kamera — itu pack shot, dan naskah rujukan produksi
          // melarangnya tegas: "Never open on a pack shot. First frame = face,
          // motion, or object anomaly." Produk boleh TERLIHAT sejak awal, tapi
          // DIAM; tangan baru menyentuhnya di detik 3-5.
          //
          // Alasannya dramaturgi, bukan selera: kalau label sudah dipamerkan di
          // frame pertama, tidak ada lagi yang ditunggu penonton, dan CTA yang
          // seharusnya jadi puncak kehilangan bobotnya. Busur produk
          // idle -> partial -> hero itu yang membuat beat terakhir terasa
          // seperti penutup, bukan pengulangan.
          ? `The video starts ALREADY in motion, with her hands busy in the space beside the product — reaching, resting, or adjusting something near it: "${input.productName}" is already sitting in frame, still and untouched, and stays put for the first beats before being picked up later. The frame keeps moving from the very first instant, and the product stays idle in the background of the action, its label still turned away from camera, ${IDENTITY_INSTRUCTION}`
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
      !neutralVisual && isFirst && (format === "hands_only" || format === "talking_head")
        ? input.hookLevel === "gila"
          ? CRAZY_OPENER[bukaTanpaWajah ? "hands_only" : format]
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
    const kunciSubjek = perluSubjekTunggal
      ? neutralVisual ? NEUTRAL_SINGLE_SUBJECT_LOCK : SINGLE_SUBJECT_LOCK
      : "";

    // LATAR per template — hanya untuk template yang beat-nya BELUM menentukan
    // tempat. Template dengan tabel peran sendiri sudah menyebut ruangannya,
    // dan menambahkan latar kedua di sana mengulang persis kesalahan yang sudah
    // lima kali diperbaiki hari ini: dua perintah yang tak bisa benar bersamaan.
    //
    // Tanpa ini, 33 template keluar dengan meja putih dan dinding beige yang
    // sama — brand yang memesan lima template menerima lima video yang terlihat
    // satu shooting.
    // Detik pertama: hanya untuk shot PEMBUKA, dan hanya bila promptnya belum
    // membawa aturannya sendiri. hands_only sudah punya ("starts ALREADY in
    // motion"), dan menumpuk dua kalimat yang menyuruh hal sama membuat
    // promptnya panjang tanpa menambah apa pun.
    // Detik pertama untuk SEMUA shot pembuka, termasuk yang punya tabel peran —
    // tes menemukan 12 template "format" yang pembukanya memang statis.
    //
    // Dikecualikan hanya yang kediamannya DISENGAJA, ditandai sebagai data:
    // peran ber-pembukaDiam (ruangan sunyi sebelum pintu didobrak) dan rute
    // TVC intimate (kamar jam tiga pagi, premisnya justru keheningan).
    // hands_only dikecualikan HANYA bila ia memakai pembuka generiknya, yang
    // sudah memuat "starts ALREADY in motion". Template hands_only yang punya
    // tabel peran sendiri (t06, t11) memakai teks perannya, dan teks itu tidak
    // menuntut gerak apa pun — dua template itulah yang ditemukan tes.
    const kediamanDisengaja =
      input.tvcRoute === "intimate" || (i === 0 && ugcRoles?.opening?.pembukaDiam === true);
    const pakaiPembukaGenerikHandsOnly = format === "hands_only" && !punyaPeranTemplate;
    const detikPertama =
      i === 0 && !pakaiPembukaGenerikHandsOnly && !kediamanDisengaja
        ? neutralVisual ? DETIK_PERTAMA_NETRAL : DETIK_PERTAMA
        : "";

    const latar = !punyaPeranTemplate && input.ugcTemplate
      ? `${latarUntukTemplate(input.ugcTemplate).teks}. `
      : "";

    // ---- LAPISAN PANGGUNG (start state / busur produk / ekspresi) ----
    //
    // Prompt kita selama ini berat di LARANGAN dan tipis di PANGGUNG: 2.500
    // karakter batasan (identitas, label, negative) dengan satu kalimat aksi
    // tenggelam di tengahnya. Semua batasan itu lahir dari kegagalan produksi
    // nyata dan tetap dipertahankan — yang ditambahkan di sini bagian yang
    // hilang, bukan pengganti.
    //
    // Tiga field ini datang dari naskah rujukan produksi yang terbukti, dan
    // masing-masing menutup satu kelemahan yang bisa diukur:
    //
    //   Start state  — model bergerak MENUJU prompt, jadi yang kita tulis tiba
    //                  di AKHIR klip. Tanpa menyatakan kondisi awal, model
    //                  MENGARANG pembukaannya sendiri.
    //   Product state— busur idle -> partial -> hero. Kalau label sudah
    //                  dipamerkan sejak frame pertama, CTA kehilangan bobot.
    //   Expression   — beat yang tidak menyebut ekspresi keluar datar.
    const busur = numShots <= 1 ? "hero" : isFirst ? "idle" : isLastShot(i, numShots) ? "hero" : "partial";
    const produkAkhir = neutralStoryAds
      ? busur === "idle"
        ? `Prop state at the end of this shot: the same plain unprinted colour card or swatch remains in the staged scene without being presented as merchandise.`
        : busur === "partial"
          ? `Prop state at the end of this shot: the same blank colour card or swatch has moved within the staged action; its surface remains plain and non-factual.`
          : `Prop state at the end of this shot: the same blank colour card or swatch settles as the compositional focus, still without letters, numbers, logos, labels, prices, names, categories, or readable marks.`
      : noPhysicalProduct
        ? `Service state at the end of this shot: the presenter and setting carry the idea through natural gestures; no physical merchandise is introduced.`
      : busur === "idle"
        ? `Product state at the end of this shot: still idle — present in frame but not yet held up or presented, its label not turned to camera.`
        : busur === "partial"
          ? `Product state at the end of this shot: partially revealed — in her hands and clearly in use, but not yet held up as a hero shot.`
          : `Product state at the end of this shot: hero — held up, label squarely readable to camera, and held still for the final second.`;
    const mulaiDari = isFirst
      ? `Start state: the first frame is already mid-action, not a posed opening.`
      : neutralStoryAds
        ? `Start state: this shot begins exactly where the previous one ended, with the same blank prop already moving in the staged action.`
      : noPhysicalProduct
        ? `Start state: this shot begins exactly where the previous one ended, with the same presenter and setting continuing naturally.`
      : `Start state: this shot begins exactly where the previous one ended — ${
          busur === "hero"
            ? `the product is already in her hands from the very first frame, so no time is spent picking it up`
            : `her hands are already engaged with the product, continuing without a visible restart`
        }.`;
    // Video SATU shot itu hook DAN penutup sekaligus. Memeriksa isFirst lebih
    // dulu membuatnya mewarisi ekspresi pembuka ("curious and a little
    // unimpressed") padahal kalimat beat-nya sendiri sudah menyuruh "warm
    // delighted reaction" — prompt yang bertengkar dengan dirinya sendiri,
    // dan model akan memilih salah satunya secara acak. Untuk satu shot,
    // penutupnya yang menang: itu yang cocok dengan busur produk "hero".
    const ekspresi = numShots <= 1
      ? `Expression: warm and genuinely pleased throughout — an unhurried, friendly delivery.`
      : isFirst
      ? `Expression: curious and a little unimpressed, like someone about to show you something.`
      : isLastShot(i, numShots)
        ? `Expression: warm, settled and sure — an unhurried close, not a hard sell.`
        : `Expression: absorbed in what her hands are doing, quietly pleased.`;
    // Titik ganda ".." muncul karena blok ini ditempel di belakang teks yang
    // kadang sudah berakhir titik dan kadang tidak. Dinormalkan di satu tempat
    // supaya tidak perlu diingat di tiap cabang perakitan.
    const panggung = ` ${mulaiDari} ${produkAkhir} ${ekspresi}`.replace(/\s+/g, " ");
    const rapikan = (t: string) => t.replace(/\.\.+(?=\s|$)/g, ".").replace(/\s+([.,])/g, "$1").trim();

    // Kunci ukuran asli (§C.10) di TIAP shot — termasuk shot tanpa suara, yang
    // punya cacat produk-raksasa yang sama.
    const ukuran = neutralVisual
      ? ` ${kunciUkuranPropertiNetral()}`
      : ` ${kunciUkuranAsli(input.productName)}`;
    // Kontrak talent mode ikut, terpisah dari framing: framing mengatur KAMERA,
    // kalimat ini mengatur apa yang dilakukan orangnya.
    const kontrak = framingMode ? ` ${blokKontrakMode(modeShot)}` : "";
    // Framing penulis DITAMBAHKAN, bukan menggantikan: framing bawaan membawa
    // kunci keselamatan filter (dada ke atas, satu orang) yang tidak boleh
    // hilang hanya karena penulis menulis "wide". Kalau keduanya bertentangan,
    // gerbang prompt akhir yang memutuskan — dan kosakata berisiko di situ
    // sekarang KERAS.
    const kameraPenulis = sinema?.kamera ? ` Shot composition: ${sinema.kamera}.` : "";
    // Format ide -> kamera (slice 3). Larangan format ditulis sebagai kalimat
    // POSITIF: "hindari" di katalog menyebut apa yang merusak, dan menyalinnya
    // apa adanya akan memanggil balik hal yang dilarang (pelajaran negasi yang
    // sama dengan pemicu penyaring).
    const petunjukFormat = petunjukFormatIde(input.ideaFormat);
    const blokFormat = petunjukFormat ? ` ${petunjukFormat}` : "";

    const visualProductDesc = neutralVisual ? "" : productDesc;
    const visualBrandBrief = neutralVisual ? "" : brandBrief;
    const base = rapikan(punyaPeranTemplate
      ? `${beat} ${kunciSubjek}${detikPertama}${crazyOpener}${subject}. Shot ${i + 1} of ${numShots}.${kameraPenulis} ${visualProductDesc}${visualBrandBrief}${panggung}${kontrak}${blokFormat}${ukuran}`
      : `${framing}${kunciSubjek}${detikPertama}${crazyOpener}${subject}. ${latar}Shot ${i + 1} of ${numShots}.${kameraPenulis} ${visualProductDesc}${visualBrandBrief}${beat}${panggung}${kontrak}${blokFormat}${ukuran}`);

    if (!withAudio) {
      return {
        index: i, durationSec: perShot, prompt: base,
        ...(!neutralStoryAds ? { imageRefPath: input.imageRefPath } : {}),
        ...(neutralStoryAds ? { trustedNumericScaffolds: trustedNumericScaffoldsForShot(i, punyaPeranTemplate ? 2 : 1) } : {}),
      };
    }

    // Kunci bahasa 4 lapis. Lapis "perShot" mengikuti siapa yang terdengar:
    // presenter yang bicara ke kamera, atau narator di luar layar — menyebut
    // "she speaks" pada shot tanpa wajah memanggil wajah ke frame (preseden
    // job a1192101).
    const modeBicara: "presenter" | "voiceover" =
      format === "talking_head" && lipSyncPresenter && !bukaTanpaWajah ? "presenter" : "voiceover";
    const bahasa = kunciBahasa(modeBicara);

    // Tier bersuara: dialog dalam tanda kutip; jeda & arahan di luar tanda kutip.
    // hands_only (Tangan + VO): dialog = NARASI VOICEOVER — insiden production
    // 2026-08-07 job a1192101: frasa "presenter speaks to camera" membuat model
    // menggambar WAJAH pembicara di format tanpa-wajah -> QC-09 menolak (benar).
    // r4 (Brian 2026-08-07): harga di dialog WAJIB terbilang — model membaca
    // "Rp299.000" ngaco. Hanya pola harga yang dikonversi (kode produk aman).
    const dialogue = neutralStoryAds ? "" : hargaTerbilang(dialogueForShot(i).filter(Boolean).join(" "));
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
            // Ditulis positif: menyebut "nobody appears on screen" justru
            // memanggil orang ke frame yang seharusnya murni produk.
            ? `A composed, confident Indonesian brand voiceover is heard over this footage with measured pacing and clean articulation — the poised tone of a national television commercial, warm and composed. The narration stays entirely off-screen while the frame keeps to the product: "${dialogue}". `
            : `A composed, confident Indonesian brand voiceover delivers the line over this footage with measured pacing and clean articulation — the poised tone of a national television commercial, warm and composed; the voice comes from off-screen while anyone in frame keeps their lips closed and simply acts and reacts: "${dialogue}". `
        : format === "hands_only"
        ? `A warm female VOICEOVER narrates in casual Indonesian at a relaxed, unhurried pace with natural pauses between sentences, enunciating every word completely with clear separation between words — like a real person chatting, at an easy conversational speed (the narration stays entirely off-screen; the shot keeps to ${neutralVisual ? "the staged action and blank props" : "hands and product"}): "${dialogue}". `
        : lipSyncPresenter
          ? bukaTanpaWajah
            // Preseden job a1192101: frasa "presenter speaks to camera" membuat
            // model MENGGAMBAR wajah pembicara di shot yang harus tanpa wajah.
            // Shot pembuka memakai kalimat VO hands_only; presenter bicara ke
            // kamera baru mulai shot 2.
            ? `A warm female VOICEOVER speaks in casual Indonesian at a relaxed, unhurried pace with natural pauses between sentences, enunciating every word completely with clear separation between words (the speaker stays entirely off-screen in this opening shot; the frame keeps to ${neutralVisual ? "the staged action and blank props" : "hands and product"}): "${dialogue}". `
            : `The presenter speaks casually to camera in Indonesian at a relaxed, unhurried pace with natural pauses between sentences, enunciating every word completely with clear separation between words — like a real person chatting with a friend, easy and unsalesy, saying: "${dialogue}". `
          : bukaTanpaWajah
          ? `A warm female VOICEOVER narrates in casual Indonesian at a relaxed, unhurried pace with natural pauses, enunciating every word completely with clear separation between words (the narration stays entirely off-screen in this opening shot; the frame keeps to ${neutralVisual ? "the staged action and blank props" : "hands and product"}): "${dialogue}". `
          : `A warm female VOICEOVER narrates in casual Indonesian over this footage at a relaxed, unhurried pace with natural pauses, enunciating every word completely with clear separation between words, like a real person chatting with a friend — the on-screen presenter reacts and demonstrates naturally with her lips closed and relaxed throughout, listening rather than speaking: "${dialogue}". `;
    const pacing =
      format === "tvc"
        ? !dialogue.trim()
          ? ``
          : isLast
          ? `The voiceover lands the final line cleanly and stops — one beat of silence on the hero shot, no trailing chatter. `
          : `A short, deliberate beat of silence separates this line from the next. `
        : format === "hands_only"
        ? `The narration pauses for a full second before the next line — the pause should be clearly noticeable, not rushed. `
        : bukaTanpaWajah
        // Shot pembuka tanpa wajah: "taking a visible breath" menyebut tubuh
        // yang justru tidak boleh tampil — pakai jeda narasi gaya hands_only.
        ? `The narration pauses for a full second before the next line — the pause should be clearly noticeable, not rushed. `
        : isLast
          ? `She pauses for a full second, smiles warmly, then ends with a friendly inviting tone — the pause should be clearly noticeable, not rushed. `
          : neutralVisual
            ? `She pauses for a full second, taking a visible breath, before continuing the staged blank-prop action — the pause should be clearly noticeable, not rushed. `
            : `She pauses for a full second, taking a visible breath, before showing the product closer — the pause should be clearly noticeable, not rushed. `;
    // rapikan() dipakai di prompt AKHIR, bukan cuma di base: titik gandanya
    // justru lahir DI SINI, saat `${base}. ` menempel pada base yang sudah
    // berakhir titik. Menormalkan potongannya saja meninggalkan cacat yang
    // sama di keluaran nyata — dan keluaran nyata itu yang dikirim ke model.
    // Lapis 3 (label dialog) ditempel tepat di depan kalimat berdialog, dan
    // lapis 1/2/4 mengapit blok ucapan — bukan disebar acak: yang terbukti
    // menahan ucapan Inggris adalah bahasa yang disebut DEKAT teks dialognya.
    // Shot TANPA kata ditandai eksplisit, bukan dibiarkan merakit klausa narasi
    // dengan kutipan kosong. Dua alasan: (1) standar §E memang meminta shot
    // pembuka terbaca tanpa dialog, jadi bentuk ini normal, bukan cacat;
    // (2) gerbang prompt akhir perlu cara ANDAL membedakan "tidak berdialog"
    // dari "lupa label dialog" — sebelum ini ia menebak dari tanda kutip, dan
    // nama produk yang memang ditulis dalam kutip membuatnya salah tebak.
    const speechBerlabel = dialogue.trim()
      ? `Indonesian dialogue, spoken exactly as written. ${speech}`
      : `No spoken words in this shot — it plays on picture and sound design alone. `;
    const prompt = rapikan(
      format === "talking_head" && !lipSyncPresenter && !bukaTanpaWajah
        ? `${base}. ${bahasa.header} ${bahasa.perShot} ${speechBerlabel}${pacing}Natural warm reactive expression throughout, with her lips closed and relaxed as she listens. ${bahasa.penutup}`
        : neutralVisual
          ? `${base}. ${bahasa.header} ${bahasa.perShot} ${speechBerlabel}${pacing}Natural conversational Indonesian, not a newsreader. ${bahasa.penutup}`
          : `${base}. ${bahasa.header} ${bahasa.perShot} ${speechBerlabel}${pacing}Enunciate clearly the words "${input.productName}" and "${pain.replace(/nya$/, "")}". Natural conversational Indonesian, not a newsreader. ${bahasa.penutup}`
    );
    // Penanda menahan-produk ikut sebagai DATA. Sumbernya peran template
    // (ugcRoles) atau tabel rute TVC — keduanya menandainya eksplisit.
    // start_state segmen paling awal di shot ini — kalimat yang menggambarkan
    // apa yang SUDAH benar sebelum ada yang bergerak. Dipakai membangun frame
    // pertama; prompt shot menggambarkan gerakannya, bukan keadaan awalnya.
    const awalShot = segmenMilikShot(i).slice().sort((a, b) => a.start - b.start)[0];
    return {
      index: i, durationSec: perShot, prompt,
      ...(!neutralStoryAds ? { imageRefPath: input.imageRefPath } : {}),
      ...(neutralStoryAds ? { trustedNumericScaffolds: trustedNumericScaffoldsForShot(i, punyaPeranTemplate ? 2 : 1) } : {}),
      ...(menahanProdukDiShot(i) ? { withholdProduct: true } : {}),
      ...(beatTvc?.tanpaOrang ? { tanpaOrang: true } : {}),
      ...(awalShot?.start_state ? { startState: awalShot.start_state } : {}),
    };
  });

  // Negative prompt per-format: hands_only melarang wajah sepenuhnya (bukan sekadar
  // "no face distortion"); format lain memakai negative kategori apa adanya.
  let negativePrompt = visualCategory.negativePrompt;
  // r8: larangan bersama (format ber-video-AI saja — vo_broll pakai FOTO ASLI
  // user, tidak ada model video sama sekali, jadi tak relevan & tak diubah).
  // Model jangan "mencoba" merender teks kecil label sebagai tajam lalu gagal
  // jadi gibberish (lihat IDENTITY_INSTRUCTION).
  if (format !== "vo_broll") {
    // DIHAPUS 2026-08-15 bersama perbaikan MANDATORY_NEGATIVE_PROMPT: tiga
    // frasa ini juga menekan tulisan produk, dan bukti berpasangan menunjukkan
    // label justru KELUAR BENAR begitu larangan tulisan dilepas. Melarang
    // "teks kecil yang salah" ternyata cara paling efektif menghasilkan teks
    // kecil yang salah.
    negativePrompt = `${negativePrompt}, no distorted packaging, no melted plastic`;
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
  // SATU pembersih di ujung, bukan disiplin yang harus diingat di sepuluh
  // tempat penyusunan di atas. Lihat frasaNegatifBersih.
  negativePrompt = frasaNegatifBersih(negativePrompt);

  // Rute TVC yang premisnya menahan produk di awal. Dipisah jadi variabel
  // supaya alasannya bisa dibaca di satu tempat, bukan tersembunyi di dalam
  // ekspresi panjang.
  const menahanProduk = format === "tvc" && (input.tvcRoute === "fabric" || input.tvcRoute === "intimate");

  const spec: VisualSpec = {
    jobId: input.jobId,
    width: 720,
    height: 1280,
    shots,
    maxPeople: maksOrangPerFrame({ format, noModel: input.noModel, tvcRoute: input.tvcRoute }),
    negativePrompt, // tetap mengandung MANDATORY_NEGATIVE_PROMPT dari kategori
    qualityTier: tier,
    generateAudio: withAudio, // konsisten dengan tier — ditegakkan juga di registry
    ...(!neutralStoryAds && input.extraImageRefPaths?.length
      ? { extraReferenceImagePaths: input.extraImageRefPaths.slice(0, 7) }
      : {}), // neutral Story Ads = text-to-video; foto produk tidak boleh bocor
    ...(neutralStoryAds ? { visualSubjectPolicy: "neutral_story_ads" as const } : {}),
    ...(neutralStoryAds ? { storyBridgeSources: bridgeStoryAdsTerbukti(
      input.segments as Array<SegmentDraft & Record<string, unknown>>,
      { productName: input.productName, productCategory: input.productCategory, productPriceIdr: input.productPriceIdr }
    ) } : {}),
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
  if (neutralStoryAds) {
    for (const shot of spec.shots) {
      const contradictions = neutralStoryAdsPromptContradictions(shot.prompt, {
        productName: input.productName,
        productCategory: input.productCategory,
      }, shot.trustedNumericScaffolds);
      if (contradictions.length > 0) {
        throw new Error(`Kontrak prompt final neutral Story Ads dilanggar: ${contradictions.join(", ")}`);
      }
    }
  }
  return spec;
}

export { HANDS_ONLY_FRAMING, HANDS_ONLY_NEGATIVE, IDENTITY_INSTRUCTION, MANDATORY_NEGATIVE_PROMPT };
