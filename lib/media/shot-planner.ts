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

export interface ShotPlanInput {
  jobId: string;
  durationSec: number;
  segments: SegmentDraft[];
  category: CreatorCategory;
  productName: string;
  productCategory: string;
  /** Deskripsi visual produk dari user (opsional) — memperkuat konsistensi identitas. */
  productVisualDesc?: string | null;
  imageRefPath: string; // foto produk asli (absolut)
  /** Foto produk ke-2..5 (absolut) — referensi identitas tambahan untuk model
   * yang mendukung r2v (Seedance 2.0 / tier bersuara). Lihat VisualSpec. */
  extraImageRefPaths?: string[];
  qualityTier: QualityTier;
  format?: "hands_only" | "vo_broll" | "talking_head";
  /** Level hook S3. HANYA "gila" yang mengubah visual: shot 1 dapat pembuka
   * pattern-interrupt PRODUCT-SAFE (gerakan kamera dramatis + produk naik cepat
   * ke tengah frame) — BUKAN adegan bahaya/kacau: aksi ekstrem berisiko kena
   * moderasi platform, merusak konsistensi identitas produk (QC-03), dan
   * silhouette guard QC-02. Berani = teks saja, visual tidak berubah. */
  hookLevel?: "normal" | "berani" | "gila";
}

// r9 (Brian 2026-08-07): durasi klip FOTO ASLI produk yang disisipkan worker
// di ujung video Wajah AI — lihat product-proof-insert.ts + planShots di bawah.
export const PRODUCT_PROOF_INSERT_SEC = 1.5;

const HANDS_ONLY_FRAMING =
  "hands and forearms only, face and body NOT visible, cropped below shoulders, " +
  "close-up POV hands-only shot, camera focused on hands and product";

const HANDS_ONLY_NEGATIVE =
  "no face, no visible face, no head in frame, no person facing camera";

// Wajah AI (v1, 2026-08-03): opposite intent of hands_only — face IS the
// point, framed like a normal UGC talking-head selfie, not hands-only POV.
// + estetika candid (2026-08-07, dari referensi visual Brian — grid UGC yang
// menang terlihat seperti foto iPhone sehari-hari: cahaya jendela natural,
// warna kalem, setting rumah yang hidup — BUKAN studio terang/polished).
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
const IDENTITY_INSTRUCTION =
  "the exact same product from the reference image, identical packaging, identical label, " +
  "do not redesign or replace the product, the packaging stays physically intact and correct " +
  "(one cap, one dropper, nothing floating or duplicated). The ENTIRE bottle and its full label " +
  "stay completely inside the frame at all times, with visible margin on every side — never cropped " +
  "or cut off by the frame edges, camera framed wide enough that no part of the bottle ever leaves " +
  "frame. The large bold brand name on the label stays sharp, steady and perfectly legible the whole " +
  "time, reproduced with the EXACT same letters and spelling as the reference image (do not alter, " +
  "add, drop, or misspell any letter); any smaller printed text below it is realistically soft and " +
  "out of focus from natural macro shallow depth of field, like a real phone camera close-up — not " +
  "an attempt at sharp illegible lettering";

// Aksi demo per KATEGORI PRODUK (2026-08-07, dipelajari dari akun UGC tim +
// referensi visual Brian): "memegang kemasan" hanya benar untuk sebagian
// kategori — fashion harus TRY-ON (baju dipakai/ditempel ke badan), beauty
// harus swatch/aplikasi, food harus dicicipi. Konten UGC yang menang terlihat
// seperti orang sungguhan MEMAKAI produk, bukan model memegang paket.
const DEMO_ACTION: Record<string, string> = {
  // beauty: swatch di PUNGGUNG TANGAN — bukan wajah (r3, temuan Brian: pegang
  // produk + sentuh muka memicu tangan ganda / AI slop anatomi).
  beauty: "dropping or swatching a little of the product onto the BACK of her other hand to show its texture, both hands clearly accounted for",
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
  const numShots = format === "talking_head"
    ? Math.max(1, Math.ceil(input.durationSec / 15))
    : Math.max(2, Math.ceil(input.durationSec / 15));
  // r9 (Brian 2026-08-07, screenshot label gibberish berulang: "kamu harus
  // perbanyak referensi" — sudah diuji: 3 foto TIDAK menyelesaikan, limitasi
  // model). Jaminan matematis, bukan probabilistik: sisakan PRODUCT_PROOF_SEC
  // di ujung video Wajah AI utk klip FOTO ASLI produk (worker yang
  // menambahkannya setelah generate — lihat product-proof-insert.ts). AI clip
  // diminta lebih pendek supaya total tetap pas durationSec, bukan terpotong.
  // r15 (Brian 2026-08-08, "tulisannya masih jelek, ganti model?" — riset:
  // limitasi label-text di video-gen AI berlaku LINTAS SEMUA model besar
  // 2026 (Kling/Veo/Seedance), bukan spesifik BytePlus; ganti provider tidak
  // akan menyelesaikan). Perluas jaminan matematis product-proof ke
  // hands_only juga — hands_only SELALU >=2 shot (lihat komentar di atas)
  // jadi TIDAK direstriksi numShots===1 seperti talking_head (yang dibatasi
  // krn identitas presenter, bukan krn matematika durasi).
  const reserveProof = format === "talking_head" ? numShots === 1 : format === "hands_only";
  const perShot = reserveProof ? (input.durationSec - PRODUCT_PROOF_INSERT_SEC) / numShots : input.durationSec / numShots;
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

  // Dialog per shot (tier bersuara): 1 shot (Wajah AI 15 dtk) = seluruh skrip
  // dalam satu tarikan; 2 shot = [hook+demo] lalu [cta] (perilaku lama, tak
  // berubah). >=3 shot (45 dtk) = 1 segmen penuh per shot — pas karena tiap
  // shot sudah 15 dtk penuh, gak perlu digabung lagi.
  const dialogueForShot = (i: number): string[] =>
    numShots === 1
      ? [segText("hook"), segText("demo"), segText("cta")]
      : numShots >= 3
        ? i === 0 ? [segText("hook")] : i === 1 ? [segText("demo")] : [segText("cta")]
        : i === 0 ? [segText("hook"), segText("demo")] : [segText("cta")];

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
    const framing = format === "hands_only"
      ? `${HANDS_ONLY_FRAMING}. `
      : fullBodyFashion
        // r3 (Brian): fashion di DALAM KAMAR — suasana try-on paling relatable.
        ? "full body visible head to toe, presenter standing and showing the whole outfit like a mirror-check try-on video, " +
          "phone propped vertical framing, natural phone camera look, inside a cozy lived-in bedroom with a bed and " +
          "wardrobe visible, soft natural window light, muted authentic colors, candid everyday vibe. "
        : format === "talking_head" ? `${TALKING_HEAD_FRAMING}. ` : "";
    // Wajah AI pakai promptSeed (deskripsi wajah/tipologi) + deliveryPrompt
    // (gaya pembawaan per kategori — genz energik, hijaber kalem anggun, ibu
    // menenangkan) sebagai subjek utama, bukan handsPrompt.
    const subject = format === "talking_head"
      ? `${input.category.promptSeed}, ${input.category.deliveryPrompt}`
      : input.category.handsPrompt;
    const demoAction = DEMO_ACTION[input.productCategory] ?? DEMO_ACTION.default;
    const beat =
      format === "talking_head"
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
              : `Close cutaway on presenter's hands as she ${demoAction}, her face out of tight focus and NOT talking, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, natural phone camera movement`
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
            : `Hands demonstrating the product in use, but the bottle stays angled so its label keeps facing the camera and stays legible throughout — fingers never cover the label, the same product as in shot 1 and the reference image, ${IDENTITY_INSTRUCTION}, close-up texture, natural phone camera movement`;
    // Level gila: pembuka pattern-interrupt HANYA di shot pertama; vo_broll
    // (pan foto, tanpa model video) tidak punya jalur ini.
    const crazyOpener =
      input.hookLevel === "gila" && isFirst && format !== "vo_broll" ? CRAZY_OPENER[format] : "";
    const base = `${framing}${crazyOpener}${subject}. Shot ${i + 1} of ${numShots}. ${productDesc}${beat}`;

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
      format === "hands_only"
        ? `A warm female VOICEOVER narrates in casual Indonesian at a relaxed, unhurried pace with natural pauses between sentences — like a real person chatting, never rushed (the speaker is NEVER visible — off-screen narration only, keep the shot strictly hands and product): "${dialogue}". `
        : lipSyncPresenter
          ? `The presenter speaks casually to camera in Indonesian at a relaxed, unhurried pace with natural pauses between sentences — like a real person chatting with a friend, never rushed or salesy, saying: "${dialogue}". `
          : `A warm female VOICEOVER narrates in casual Indonesian over this footage at a relaxed, unhurried pace with natural pauses, like a real person chatting with a friend — the on-screen presenter reacts and demonstrates naturally but her mouth is NOT moving in sync to any specific words (not talking to camera): "${dialogue}". `;
    const pacing =
      format === "hands_only"
        ? `The narration pauses for a full second before the next line — the pause should be clearly noticeable, not rushed. `
        : isLast
          ? `She pauses for a full second, smiles warmly, then ends with a friendly inviting tone — the pause should be clearly noticeable, not rushed. `
          : `She pauses for a full second, taking a visible breath, before showing the product closer — the pause should be clearly noticeable, not rushed. `;
    const prompt =
      format === "talking_head" && !lipSyncPresenter
        ? `${base}. ${speech}${pacing}Natural warm reactive expression throughout, mouth relaxed and not talking to camera.`
        : `${base}. ${speech}${pacing}Enunciate clearly the words "${input.productName}" and "${pain.replace(/nya$/, "")}". Natural conversational Indonesian, not a newsreader.`;
    return { index: i, durationSec: perShot, prompt, imageRefPath: input.imageRefPath };
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
  if (format === "hands_only") {
    negativePrompt = negativePrompt
      .replace(/no face distortion,?\s*/i, "") // kontradiktif untuk hands_only — diganti larangan total
      .replace(/,\s*,/g, ",")
      .trim();
    negativePrompt = `${negativePrompt}, ${HANDS_ONLY_NEGATIVE}`;
  }

  return {
    jobId: input.jobId,
    width: 720,
    height: 1280,
    shots,
    negativePrompt, // tetap mengandung MANDATORY_NEGATIVE_PROMPT dari kategori
    qualityTier: tier,
    generateAudio: withAudio, // konsisten dengan tier — ditegakkan juga di registry
    extraReferenceImagePaths: input.extraImageRefPaths?.slice(0, 7), // r13: 4->7 (+1 primer = 8 total)
    hasProofInsert: reserveProof,
  };
}

export { HANDS_ONLY_FRAMING, HANDS_ONLY_NEGATIVE, IDENTITY_INSTRUCTION, MANDATORY_NEGATIVE_PROMPT };
