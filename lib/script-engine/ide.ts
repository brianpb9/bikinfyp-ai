/**
 * IDEA STAGE + FYP GATE (PATCH 4, STEP 3).
 *
 * Gerbang ketiga dari standar produk. Gate 1 menjaga kesetiaan merek, Gate 2
 * menjaga video tidak terlihat AI-slop — keduanya NEGATIF: mereka melarang.
 * Gate 3 satu-satunya yang bertanya "kenapa orang berhenti scroll?".
 *
 * Urutannya penting dan sengaja dibalik dari pipeline lama: ide dipilih SEBELUM
 * format dan mode. Format adalah KONSEKUENSI ide, bukan pilihan awal. Memilih
 * format duluan berarti idenya harus muat ke cetakan yang sudah ada — dan itu
 * persis bagaimana kita sampai pada 33 template yang semuanya terasa sama.
 *
 * Modelnya kelas atas dan dipanggil SEKALI per naskah/batch, bukan per varian:
 * ide adalah keputusan paling menentukan di seluruh pipeline dan paling jarang
 * diulang, jadi di sinilah anggaran model paling layak dibelanjakan.
 */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { config } from "../config";
import {
  ideGenerik, situasiManusiawi, urutkanMekanik,
  BATAS_NATIVENESS_CGI, KATEGORI_JENUH, LEVEL_TONTONAN, MEKANIK_BUTUH_CGI, MEKANIK_BY_ID,
  type IdMekanik,
} from "./idea-mechanics";
import { LlmTidakTersedia, ambilObjekJson } from "./llm";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSI_API = "2023-06-01";

export const SkemaIde = z.object({
  one_liner: z.string().min(10).max(160),
  /**
   * Situasi MANUSIA tempat ide ini berdiri: orang, momen, atau ketegangan
   * sosial — bukan benda.
   *
   * Wajib, dan itu koreksi berdasar bukti. Jalankan Scarlett 17 Agu
   * menghasilkan sepuluh kandidat yang SEMUANYA tentang bendanya: botol,
   * tetesan, pipet, harga. Skor distinctiveness-nya 3-6 semua, dan jurinya
   * mengulang kalimat yang sama — "bisa ditiru siapa pun besok". Memang bisa:
   * kompetitor punya botol juga. Yang tidak bisa mereka tiru adalah momen
   * manusianya.
   */
  human_situation: z.string().min(15),
  mechanic: z.string().min(3),
  hook_device: z.string().min(3),
  hook_level: z.string().min(2),
  why_stop: z.string().min(10),
  story: z.object({
    setup: z.string().min(5),
    tension: z.string().min(5),
    payoff: z.string().min(5),
  }),
  product_role: z.string().min(5),
  claim_safety: z.string().min(5),
  suggested_mode: z.string().min(3),
  suggested_format: z.string().min(3),
  brand_fidelity_plan: z.string().min(10),
  risk: z.string().min(5),
});
export type Ide = z.infer<typeof SkemaIde>;

export const SkemaDaftarIde = z.object({ ideas: z.array(SkemaIde).min(3).max(8) });

/** Bobot dan ambang FYP Gate — PATCH 4 §6, angkanya milik Brian. */
export const DIMENSI_FYP = [
  { id: "scroll_stop", bobot: 30, ambang: 7, tanya: "Kalau ini muncul di antara 20 video sejenis, apakah kamu berhenti di detik pertama? Kenapa?" },
  { id: "distinctiveness", bobot: 20, ambang: 7, tanya: "Bisa dibedakan dari 100 video kompetitor? Apa yang tidak bisa mereka tiru besok?" },
  { id: "story_pull", bobot: 20, ambang: 7, tanya: "Ada pertanyaan yang belum terjawab sampai detik terakhir?" },
  { id: "payoff", bobot: 10, ambang: 7, tanya: "Ada satu momen yang terasa worth it? Produknya terlibat di momen itu?" },
  { id: "brand_fidelity_plan", bobot: 10, ambang: 8, tanya: "Label terbaca di minimal dua titik, hero statis minimal satu detik, peran produk tidak berubah?" },
  { id: "nativeness", bobot: 10, ambang: 7, tanya: "Terasa direkam spontan, bukan dirakit?" },
] as const;

export type IdDimensi = (typeof DIMENSI_FYP)[number]["id"];

export const SkemaNilai = z.object({
  scores: z.record(z.string(), z.number().min(0).max(10)),
  reason: z.string().min(10),
});

/** Ambang total. Di bawah ini, atau satu dimensi di bawah ambangnya, ide DIGANTI. */
export const AMBANG_TOTAL = 75;

export interface HasilNilai {
  total: number;
  perDimensi: Record<string, number>;
  lulus: boolean;
  /** Kenapa gagal, siap dibaca manusia. Kosong kalau lulus. */
  sebabGagal: string[];
  alasan: string;
}

/**
 * Hitung total berbobot dan tentukan lolos.
 *
 * DUA syarat, bukan satu. Total >= 75 saja tidak cukup: satu dimensi boleh
 * jeblok sementara bobot besar menutupinya, dan itu persis cara "scroll-stop 4"
 * bisa lolos dengan brand fidelity 10. Ambang per dimensi ada supaya kelemahan
 * kritis tidak bisa dirata-ratakan sampai hilang.
 */
export function hitungNilai(scores: Record<string, number>, alasan = ""): HasilNilai {
  const perDimensi: Record<string, number> = {};
  let total = 0;
  const sebabGagal: string[] = [];
  for (const d of DIMENSI_FYP) {
    // Dimensi yang tidak dinilai dianggap NOL, bukan diabaikan. Penilai yang
    // melewatkan satu dimensi tidak boleh menghasilkan skor yang terlihat baik.
    const n = Number.isFinite(scores[d.id]) ? scores[d.id] : 0;
    perDimensi[d.id] = n;
    total += (n * d.bobot) / 10;
    if (n < d.ambang) sebabGagal.push(`${d.id} ${n} (ambang ${d.ambang})`);
  }
  total = Math.round(total * 10) / 10;
  if (total < AMBANG_TOTAL) sebabGagal.unshift(`total ${total} (ambang ${AMBANG_TOTAL})`);
  return { total, perDimensi, lulus: sebabGagal.length === 0, sebabGagal, alasan };
}

/**
 * Jawaban yang TERPOTONG harus mengaku terpotong.
 *
 * Jalankan pertama 17 Agu: lima ide selengkap ini butuh ~6-8k token, dan batas
 * 4000 memotongnya di tengah ide keempat. Yang muncul ke permukaan cuma
 * "Unterminated string in JSON at position 6163" — pesan yang menuduh format
 * jawaban model padahal batas kitalah yang kekecilan, dan itu mengarahkan
 * pembedahan ke tempat yang salah.
 */
class JawabanTerpotong extends LlmTidakTersedia {
  constructor(maxTokens: number) {
    super(
      `jawaban terpotong di batas ${maxTokens} token — bukan format jawaban yang salah, ` +
        `melainkan batasnya kekecilan untuk jumlah kandidat yang diminta`
    );
    this.name = "JawabanTerpotong";
  }
}

async function panggil(system: string, user: string, maxTokens: number): Promise<string> {
  if (!config.scriptLlmEnabled || config.anthropicApiKey === "") {
    throw new LlmTidakTersedia("Idea Stage butuh ANTHROPIC_API_KEY dan SCRIPT_LLM aktif");
  }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-api-key": config.anthropicApiKey,
      "anthropic-version": VERSI_API,
    },
    body: JSON.stringify({
      model: config.anthropicModelIdeas,
      max_tokens: maxTokens,
      temperature: 1,
      system: [{ type: "text", text: system, cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: user }],
    }),
    signal: AbortSignal.timeout(180_000),
  });
  if (!res.ok) {
    throw new LlmTidakTersedia(`HTTP ${res.status}: ${(await res.text().catch(() => "")).slice(0, 200)}`);
  }
  const data = (await res.json()) as { content?: { type: string; text?: string }[]; stop_reason?: string };
  if (data.stop_reason === "max_tokens") throw new JawabanTerpotong(maxTokens);
  return (data.content ?? []).filter((c) => c.type === "text").map((c) => c.text ?? "").join("");
}

export interface PermintaanIde {
  productName: string;
  productCategory: string;
  /** Kata benda kategori, mis. "skincare" — dipakai menilai keumuman one-liner. */
  kategoriNoun: string;
  priceIdr: number;
  durationSec: number;
  contentType: "affiliate" | "ads";
  register: string;
  /** Klaim yang BOLEH disebut. Kosong = tidak ada klaim yang boleh. */
  klaim?: string[];
  /** Mekanik yang sudah dipakai merek ini <30 hari — diturunkan prioritasnya. */
  mekanikBaruDipakai?: IdMekanik[];
  /** Mekanik yang DILARANG di putaran ini (putaran kedua setelah gagal gate). */
  mekanikDilarang?: IdMekanik[];
  /** Format render. Menentukan apakah mekanik ber-CGI masih masuk akal. */
  format?: string;
  /** Level hook. Mekanik ber-CGI hanya milik level tontonan (agak_gila/gila). */
  hookLevel?: string;
  /** Putaran penambal: SEMUA kandidat harus berangkat dari situasi manusia. */
  wajibSemuaManusiawi?: boolean;
}

/**
 * Berapa kandidat per putaran yang WAJIB berangkat dari situasi manusia.
 *
 * Tiga dari lima. Bukan lima dari lima: mekanik yang berangkat dari benda
 * (transformation, time_compression) kadang memang jawaban yang benar, dan
 * melarangnya total akan membuang separuh bank mekanik. Tapi tiga dari lima
 * membalik bawaannya — dan bawaan itulah yang bermasalah, bukan pengecualiannya.
 *
 * Dari jalankan Scarlett 17 Agu: 10 dari 10 kandidat berangkat dari bendanya
 * (botol, tetesan, pipet, harga), dan distinctiveness-nya 3-6 semua.
 */
export const MIN_MANUSIAWI_PER_PUTARAN = 3;

function blokPengetahuan(r: PermintaanIde): string {
  const daftar = urutkanMekanik(r.mekanikBaruDipakai ?? [])
    .filter((m) => !(r.mekanikDilarang ?? []).includes(m.id))
    .map((m) => `- ${m.id}: ${m.mekanik} (contoh: ${m.contoh}; cocok: ${m.cocok})`)
    .join("\n");
  return [
    "You invent ONE IDEA that makes a short-form Indonesian product video worth watching.",
    "",
    "The winning videos in our library are good because each has ONE idea — a handheld fan in a lava field,",
    "an unboxing filmed from INSIDE the box, studio equipment vanishing one by one. The product merely rides",
    "on the idea. They are NOT good because the sentences are tidy.",
    "",
    "MECHANIC BANK — every idea must pick EXACTLY ONE. Listed best-first for this brand:",
    daftar,
    "",
    "RULES:",
    "- START FROM A HUMAN SITUATION, not from the object.",
    `  At least ${MIN_MANUSIAWI_PER_PUTARAN} of your 5 candidates must begin with a person, a moment, or a social tension —`,
    "  someone hiding something, someone asked a question they cannot answer, someone late, someone caught.",
    "  The product only TAGS ALONG in those. A competitor also owns a bottle; they do not own your moment.",
    "  Ideas that begin with the object (the bottle, the drop, the pipette, the price) all score alike and",
    "  all get the same verdict: anyone could copy this tomorrow.",
    "- The one_liner must be ONE sentence of AT MOST 160 characters. Count them.",
    "  If the idea does not fit in 160 characters, the idea is not found yet — that compression IS the test.",
    "  Put the staging detail in story/brand_fidelity_plan, not in the one_liner.",
    "- An idea whose one_liner would work for a different product unchanged is GENERIC and will be thrown away.",
    "- Each of the five candidates must use a DIFFERENT mechanic.",
    "- story must be a real setup -> tension -> payoff. Tension means a question the viewer cannot answer yet.",
    "- brand_fidelity_plan must name at least TWO moments where the label is readable, one of them a static hero.",
    "- Never invent claims. Only what is visible on camera or clearly subjective.",
    "- human_situation: one line naming WHO is in the scene and what is happening to them, in Indonesian.",
    "  If you cannot fill it without describing the product, the idea started from the wrong end.",
    "- Write one_liner, why_stop, story and product_role in Indonesian. Everything else in English.",
    "",
    "OUTPUT SHAPE — exact field names, no others:",
    '{"ideas":[{"one_liner":"","human_situation":"","mechanic":"","hook_device":"","hook_level":"",',
    '"why_stop":"","story":{"setup":"","tension":"","payoff":""},"product_role":"","claim_safety":"",',
    '"suggested_mode":"","suggested_format":"","brand_fidelity_plan":"","risk":""}]}',
  ].join("\n");
}

function blokTugasIde(r: PermintaanIde): string {
  const jenuh = KATEGORI_JENUH.has(r.productCategory);
  return [
    `PRODUCT: ${r.productName} (${r.productCategory}), price ${r.priceIdr} rupiah.`,
    `VIDEO: ${r.durationSec} seconds, ${r.contentType}, register ${r.register}.`,
    r.klaim?.length ? `ALLOWED CLAIMS (nothing beyond these): ${r.klaim.join("; ")}` : "ALLOWED CLAIMS: none.",
    r.wajibSemuaManusiawi
      ? "EVERY candidate this round must start from a human situation. Not one may start from the object."
      : "",
    jenuh
      ? `SATURATED CATEGORY. A plain everyday-complaint hook with no twist is FORBIDDEN as the sole mechanic — the feed is already full of it.`
      : "",
    (r.mekanikDilarang ?? []).length
      ? `FORBIDDEN MECHANICS this round (they already failed the gate): ${(r.mekanikDilarang ?? []).join(", ")}.`
      : "",
    "",
    "Give exactly 5 candidates, each with a different mechanic. JSON only.",
  ].filter(Boolean).join("\n");
}

/**
 * Hasilkan kandidat, lalu PASTIKAN kuota situasi manusia terpenuhi.
 *
 * Kalau kurang, diminta SEKALI lagi khusus kandidat manusiawi — bukan seluruh
 * putaran diulang. Membuang kandidat yang sudah ada karena kuotanya kurang
 * berarti membayar panggilan termahal di pipeline lalu membuang hasilnya;
 * menambal kekurangannya jauh lebih murah dan hasilnya sama.
 */
export async function usulkanIdeBerkuota(r: PermintaanIde): Promise<Ide[]> {
  const awal = await usulkanIde(r);
  const manusiawi = awal.filter((i) => situasiManusiawi(i.human_situation));
  const kurang = MIN_MANUSIAWI_PER_PUTARAN - manusiawi.length;
  if (kurang <= 0) return awal;

  console.warn(
    `[idea] baru ${manusiawi.length}/${MIN_MANUSIAWI_PER_PUTARAN} kandidat berangkat dari situasi manusia — meminta ${kurang} tambahan`
  );
  try {
    const tambahan = await usulkanIde({
      ...r,
      // Mekanik yang sudah terpakai dilarang, supaya tambahannya benar-benar
      // sudut baru dan bukan tulis-ulang kandidat yang sama.
      mekanikDilarang: [...(r.mekanikDilarang ?? []), ...awal.map((i) => i.mechanic as IdMekanik)],
      wajibSemuaManusiawi: true,
    });
    // Disaring DI SINI, bukan sekadar dilarang di prompt. Larangan yang tidak
    // ditegakkan kode bukan larangan: pada uji dengan model yang mengabaikannya,
    // penambalan mengembalikan mekanik yang sama dan peringkatnya berisi
    // "forbidden" dua kali — yaitu satu ide yang dihitung dua kali.
    const sudahAda = new Set(awal.map((i) => i.mechanic));
    return [
      ...awal,
      ...tambahan.filter((i) => situasiManusiawi(i.human_situation) && !sudahAda.has(i.mechanic)),
    ];
  } catch (err) {
    // Gagal menambal bukan alasan membuang kandidat yang sudah ada.
    console.warn(`[idea] penambalan kuota manusia gagal, lanjut dengan yang ada: ${(err as Error).message}`);
    return awal;
  }
}

/** Hasilkan kandidat ide, buang yang generik dan yang mekaniknya tidak dikenal. */
export async function usulkanIde(r: PermintaanIde): Promise<Ide[]> {
  // 12000, bukan 4000. Terukur 17 Agu: lima ide selengkap yang diminta
  // spesifikasi memakan ~6-8k token, dan 4000 memotongnya di tengah kandidat
  // keempat. Batas dinaikkan, BUKAN idenya yang disuruh lebih pendek —
  // kedalaman itulah yang membedakannya dari template.
  const teks = await panggil(blokPengetahuan(r), blokTugasIde(r), 12000);
  const mentah = JSON.parse(ambilObjekJson(teks)) as { ideas?: unknown[] };
  // Divalidasi SATU PER SATU, bukan sebagai satu daftar.
  //
  // Sekali jalankan menghasilkan lima kandidat; satu di antaranya menulis
  // one_liner 180 karakter dan skema daftar menolak SELURUH batch — empat ide
  // bagus ikut terbuang, dan panggilan model termahal di pipeline dibayar untuk
  // tidak menghasilkan apa pun. Kandidat cacat dijatuhkan sendiri-sendiri.
  const sah: Ide[] = [];
  for (const kandidat of mentah.ideas ?? []) {
    const hasil = SkemaIde.safeParse(kandidat);
    if (hasil.success) sah.push(hasil.data);
    else {
      const soal = hasil.error.issues[0];
      console.warn(`[idea] satu kandidat dijatuhkan: ${soal.path.join(".")} — ${soal.message}`);
    }
  }
  if (sah.length === 0) throw new LlmTidakTersedia("tidak ada kandidat ide yang sesuai skema");
  const terpakai = new Set<string>();
  return sah.filter((ide) => {
    if (!(ide.mechanic in MEKANIK_BY_ID)) return false;
    // Mekanik yang sama dua kali berarti kandidatnya bukan lima pilihan
    // berbeda, cuma satu ide yang ditulis ulang lima kali.
    if (terpakai.has(ide.mechanic)) return false;
    if (ideGenerik(ide.one_liner, { productName: r.productName, kategoriNoun: r.kategoriNoun })) return false;
    terpakai.add(ide.mechanic);
    return true;
  });
}

function blokPenilai(): string {
  return [
    "You are the FYP gate. You judge whether a video idea deserves to stop a thumb, by imagining a feed",
    "already full of similar videos in that category. You are not judging politeness or correctness —",
    "other gates already do that, and everything they pass is still forgettable.",
    "",
    "Score each dimension 0-10. Be strict: 7 means 'yes, clearly'. 5 means 'maybe'. Most ideas are 4-6.",
    ...DIMENSI_FYP.map((d) => `- ${d.id}: ${d.tanya}`),
    "",
    'OUTPUT: {"scores":{"scroll_stop":0,"distinctiveness":0,"story_pull":0,"payoff":0,"brand_fidelity_plan":0,"nativeness":0},"reason":"<=40 words"}',
  ].join("\n");
}

/**
 * Turunkan nativeness untuk mekanik yang menuntut CGI di format sehari-hari.
 *
 * Dipasang SETELAH model menilai, bukan sebagai instruksi ke model. Alasannya:
 * ini batas produksi kita, bukan penilaian rasa. Model boleh saja menganggap
 * "kamera di dasar botol" terasa segar — tetap saja kita tidak bisa merekamnya
 * dengan satu talent dan satu HP, dan hasilnya akan terasa dirakit.
 *
 * Batasnya di BAWAH ambang, jadi mekanik ini benar-benar tidak bisa lolos di
 * level normal. Itu memang maksud Brian: mereka milik level tontonan.
 */
export function penaltiCgi(
  ide: Ide,
  konteks: { format?: string; hookLevel?: string }
): { berlaku: boolean; sebab: string } {
  if (!MEKANIK_BUTUH_CGI.has(ide.mechanic as IdMekanik)) return { berlaku: false, sebab: "" };
  if (LEVEL_TONTONAN.has(konteks.hookLevel ?? "normal")) return { berlaku: false, sebab: "" };
  // Format sinematik (tvc) memang dirakit dan penonton tahu itu.
  if (konteks.format === "tvc") return { berlaku: false, sebab: "" };
  return {
    berlaku: true,
    sebab: `mekanik ${ide.mechanic} butuh CGI/kamera mustahil — di format ${konteks.format ?? "sehari-hari"} level ${konteks.hookLevel ?? "normal"} ia tidak bisa terasa spontan`,
  };
}

export async function nilaiIde(
  ide: Ide,
  konteks: { productName: string; productCategory: string; format?: string; hookLevel?: string }
): Promise<HasilNilai> {
  const user = [
    `CATEGORY: ${konteks.productCategory}. PRODUCT: ${konteks.productName}.`,
    `IDEA: ${ide.one_liner}`,
    `MECHANIC: ${ide.mechanic} — ${MEKANIK_BY_ID[ide.mechanic as IdMekanik]?.mekanik ?? ide.mechanic}`,
    `WHY IT STOPS: ${ide.why_stop}`,
    `STORY: setup=${ide.story.setup} | tension=${ide.story.tension} | payoff=${ide.story.payoff}`,
    `PRODUCT ROLE: ${ide.product_role}`,
    `BRAND FIDELITY PLAN: ${ide.brand_fidelity_plan}`,
    `RISK: ${ide.risk}`,
    "",
    "JSON only.",
  ].join("\n");
  const teks = await panggil(blokPenilai(), user, 800);
  const parsed = SkemaNilai.parse(JSON.parse(ambilObjekJson(teks)));
  const cgi = penaltiCgi(ide, konteks);
  const scores = cgi.berlaku
    ? { ...parsed.scores, nativeness: Math.min(parsed.scores.nativeness ?? 0, BATAS_NATIVENESS_CGI) }
    : parsed.scores;
  const alasan = cgi.berlaku ? `${parsed.reason} [nativeness dibatasi: ${cgi.sebab}]` : parsed.reason;
  return hitungNilai(scores, alasan);
}

export interface IdeTerpilih {
  ide: Ide;
  nilai: HasilNilai;
  /** Semua kandidat yang dinilai, urut skor turun — dipakai kalau gate gagal. */
  peringkat: { ide: Ide; nilai: HasilNilai }[];
  putaran: number;
}

/**
 * Jalankan Idea Stage sampai ada ide yang LULUS gate, maksimal dua putaran.
 *
 * Kalau gagal: TIDAK dirender diam-diam. Fungsi ini mengembalikan tiga ide
 * terbaik beserta skornya supaya pemanggil bisa meminta pengguna memilih.
 * Merender ide yang gagal gate sambil pura-pura tidak tahu adalah cara paling
 * cepat mengembalikan kondisi "benar tapi datar" — kali ini dengan bukti
 * tertulis bahwa kita sudah tahu.
 *
 * Dua putaran, bukan lima: putaran kedua sudah tahu mekanik mana yang gagal dan
 * melarangnya. Kalau dua putaran tetap gagal, yang salah biasanya bukan
 * kandidatnya melainkan produknya sedang tidak punya sudut kuat — dan itu
 * keputusan manusia, bukan keputusan yang layak diborong ulang berbayar.
 */
export const MAKS_PUTARAN_IDE = 2;

export async function pilihIde(r: PermintaanIde): Promise<IdeTerpilih> {
  const semua: { ide: Ide; nilai: HasilNilai }[] = [];
  const dilarang = new Set<IdMekanik>(r.mekanikDilarang ?? []);

  for (let putaran = 1; putaran <= MAKS_PUTARAN_IDE; putaran++) {
    const kandidat = await usulkanIdeBerkuota({ ...r, mekanikDilarang: [...dilarang] });
    // SEMUA kandidat dinilai, tidak berhenti di yang pertama lulus.
    //
    // Berhenti lebih awal memang lebih murah — dan salah. Peringkatnya dipakai
    // membagi sudut ke tiap varian naskah (varian ke-i dapat ide peringkat
    // ke-i), jadi peringkat yang cuma berisi satu entri membuat tiga varian
    // memakai ide yang sama persis. Itu kembali menjadikan layar "pilih naskah"
    // pilihan palsu, yang justru salah satu sebab keluaran terasa datar.
    //
    // Biayanya wajar: satu panggilan pembuat ide, lalu beberapa panggilan
    // penilai yang pendek (800 token) — bukan lima kali ongkos pembuat ide.
    for (const ide of kandidat) {
      // TIDAK ADA pemeriksaan perangkat retoris di sini, dan itu KOREKSI.
      //
      // Versi pertama menjatuhkan kandidat yang one_liner-nya tidak cocok
      // POLA_PERANGKAT. Salah artefak: POLA_PERANGKAT mengukur bentuk KALIMAT
      // YANG DIUCAPKAN (pertanyaan, negasi, sebut harga, kata ganti orang),
      // sedangkan one_liner adalah DESKRIPSI ide.
      //
      // Akibatnya terukur pada jalankan Scarlett 17 Agu: 4 dari 10 kandidat
      // dibunuh tanpa dinilai, termasuk "Botol setinggi pintu kos" dan "satu
      // botol dioper enam anak kos" — keduanya ide yang justru kuat. Aturan
      // yang membunuh ide bagus karena mengukur benda yang salah lebih
      // berbahaya daripada tidak ada aturan.
      //
      // Tempat aturan ini yang benar adalah validator naskah (L-19), pada teks
      // segmen HOOK yang memang diucapkan. Lihat catatan L-19 di validator.ts.
      const nilai = await nilaiIde(ide, {
        productName: r.productName, productCategory: r.productCategory,
        format: r.format, hookLevel: r.hookLevel,
      });
      semua.push({ ide, nilai });
      if (!nilai.lulus) dilarang.add(ide.mechanic as IdMekanik);
    }
    const peringkat = peringkatkan(semua);
    const menang = peringkat.find((p) => p.nilai.lulus);
    if (menang) {
      catat(r, { ide: menang.ide, nilai: menang.nilai, peringkat, putaran });
      return { ide: menang.ide, nilai: menang.nilai, peringkat, putaran };
    }
  }
  const peringkat = peringkatkan(semua);
  if (peringkat.length === 0) throw new LlmTidakTersedia("Idea Stage tidak menghasilkan satu pun kandidat sah");
  const hasil = { ide: peringkat[0].ide, nilai: peringkat[0].nilai, peringkat, putaran: MAKS_PUTARAN_IDE };
  catat(r, hasil);
  return hasil;
}

function catat(r: PermintaanIde, hasil: IdeTerpilih): void {
  catatSkorGate({
    productName: r.productName, productCategory: r.productCategory,
    mechanic: hasil.ide.mechanic, total: hasil.nilai.total, lulus: hasil.nilai.lulus,
    putaran: hasil.putaran, jumlahKandidat: hasil.peringkat.length,
    manusiawi: hasil.peringkat.filter((p) => situasiManusiawi(p.ide.human_situation)).length,
    waktu: new Date().toISOString(),
  });
  console.log(
    `[idea] gate "${r.productName}": tertinggi ${hasil.nilai.total} (${hasil.ide.mechanic}) · ` +
      `${hasil.nilai.lulus ? "LULUS" : "gagal"} · ${hasil.peringkat.length} kandidat, ` +
      `${hasil.peringkat.filter((p) => situasiManusiawi(p.ide.human_situation)).length} berangkat dari situasi manusia`
  );
}

function peringkatkan(semua: { ide: Ide; nilai: HasilNilai }[]) {
  return [...semua].sort((a, b) => b.nilai.total - a.nilai.total);
}

/** Ringkas ide jadi petunjuk untuk penulis adegan — inilah yang dilayani naskah. */
export function petunjukNaskah(ide: Ide): string {
  return [
    `THE IDEA (every segment must serve it): ${ide.one_liner}`,
    `MECHANIC: ${ide.mechanic}. WHY IT STOPS: ${ide.why_stop}`,
    `STORY — setup: ${ide.story.setup} | tension: ${ide.story.tension} | payoff: ${ide.story.payoff}`,
    `PRODUCT ROLE: ${ide.product_role}`,
    `BRAND FIDELITY PLAN (product_state must follow this): ${ide.brand_fidelity_plan}`,
    `MODE: ${ide.suggested_mode}`,
    `Each segment's "why" must name which of setup/tension/payoff it serves, in THIS story.`,
  ].join("\n");
}

/**
 * Catat skor tertinggi tiap jalankan gate.
 *
 * Ambang 75 TIDAK diturunkan (keputusan Brian 17 Agu), dan justru karena itu
 * angkanya harus dikumpulkan: kalau setelah 20+ produk tidak ada yang pernah
 * mendekati 75, yang perlu ditinjau adalah penilainya atau bank mekaniknya —
 * bukan ambangnya. Tanpa catatan, peninjauan itu cuma jadi soal ingatan.
 *
 * JSONL di storage, bukan tabel: ini catatan penelitian, bukan bagian produk,
 * dan kegagalan menulisnya tidak boleh menggagalkan apa pun.
 */
export function catatSkorGate(baris: {
  productName: string;
  productCategory: string;
  mechanic: string;
  total: number;
  lulus: boolean;
  putaran: number;
  jumlahKandidat: number;
  manusiawi: number;
  waktu: string;
}): void {
  try {
    const file = path.join(config.storageDir, "fyp-gate-log.jsonl");
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, JSON.stringify(baris) + "\n");
  } catch (err) {
    console.warn(`[idea] skor gate gagal dicatat (diabaikan): ${(err as Error).message}`);
  }
}
