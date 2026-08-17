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
import { z } from "zod";
import { config } from "../config";
import { memakaiPerangkat } from "./hook-devices";
import {
  ideGenerik, urutkanMekanik, KATEGORI_JENUH, MEKANIK_BY_ID,
  type IdMekanik,
} from "./idea-mechanics";
import { LlmTidakTersedia, ambilObjekJson } from "./llm";

const ENDPOINT = "https://api.anthropic.com/v1/messages";
const VERSI_API = "2023-06-01";

export const SkemaIde = z.object({
  one_liner: z.string().min(10).max(160),
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
  const data = (await res.json()) as { content?: { type: string; text?: string }[] };
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
}

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
    "- The one_liner must be ONE sentence. If it needs two, the idea is not found yet.",
    "- An idea whose one_liner would work for a different product unchanged is GENERIC and will be thrown away.",
    "- Each of the five candidates must use a DIFFERENT mechanic.",
    "- story must be a real setup -> tension -> payoff. Tension means a question the viewer cannot answer yet.",
    "- brand_fidelity_plan must name at least TWO moments where the label is readable, one of them a static hero.",
    "- Never invent claims. Only what is visible on camera or clearly subjective.",
    "- Write one_liner, why_stop, story and product_role in Indonesian. Everything else in English.",
    "",
    "OUTPUT SHAPE — exact field names, no others:",
    '{"ideas":[{"one_liner":"","mechanic":"","hook_device":"","hook_level":"",',
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

/** Hasilkan kandidat ide, buang yang generik dan yang mekaniknya tidak dikenal. */
export async function usulkanIde(r: PermintaanIde): Promise<Ide[]> {
  const teks = await panggil(blokPengetahuan(r), blokTugasIde(r), 4000);
  const parsed = SkemaDaftarIde.parse(JSON.parse(ambilObjekJson(teks)));
  const terpakai = new Set<string>();
  return parsed.ideas.filter((ide) => {
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

export async function nilaiIde(ide: Ide, konteks: { productName: string; productCategory: string }): Promise<HasilNilai> {
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
  return hitungNilai(parsed.scores, parsed.reason);
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
    const kandidat = await usulkanIde({ ...r, mekanikDilarang: [...dilarang] });
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
      // L-19 di tahap ide: hook tanpa perangkat retoris yang bisa dikenali
      // gagal otomatis, TANPA dinilai model. Ini yang akhirnya membuat
      // hook-devices.ts hidup di produksi — sampai sekarang ia cuma ada di
      // berkas. Sekalian menghemat satu panggilan untuk kandidat yang sudah
      // pasti gugur.
      if (!memakaiPerangkat(ide.one_liner)) {
        semua.push({
          ide,
          nilai: { total: 0, perDimensi: {}, lulus: false, sebabGagal: ["hook tanpa perangkat retoris"], alasan: "" },
        });
        continue;
      }
      const nilai = await nilaiIde(ide, { productName: r.productName, productCategory: r.productCategory });
      semua.push({ ide, nilai });
      if (!nilai.lulus) dilarang.add(ide.mechanic as IdMekanik);
    }
    const peringkat = peringkatkan(semua);
    const menang = peringkat.find((p) => p.nilai.lulus);
    if (menang) return { ide: menang.ide, nilai: menang.nilai, peringkat, putaran };
  }
  const peringkat = peringkatkan(semua);
  if (peringkat.length === 0) throw new LlmTidakTersedia("Idea Stage tidak menghasilkan satu pun kandidat sah");
  return { ide: peringkat[0].ide, nilai: peringkat[0].nilai, peringkat, putaran: MAKS_PUTARAN_IDE };
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
