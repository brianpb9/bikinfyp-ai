// Jalankan rantai penuh untuk SATU produk dan cetak semuanya apa adanya:
// naskah template (perilaku sebelum STEP 1) -> 5 kandidat ide + skor FYP per
// dimensi -> ide terpilih -> naskah 3 segmen yang melayani ide itu.
//
// Dipakai membandingkan hook SEBELUM vs SESUDAH Gate 3, dan untuk memeriksa
// mutu penilainya sendiri — skor yang tidak pernah dilihat manusia pelan-pelan
// jadi angka hiasan.
//
//   SCRIPT_LLM=1 npx tsx scripts/coba-idea-stage.ts
//
// Idea Stage dipanggil SEKALI di sini (bukan lewat generateScripts, yang akan
// memanggilnya lagi) supaya naskah yang dicetak benar-benar melayani ide yang
// dicetak di atasnya. Sisanya memakai fungsi produksi yang sama persis.
import { pilihIde, petunjukNaskah } from "../lib/script-engine/ide";
import { MEKANIK_BY_ID } from "../lib/script-engine/idea-mechanics";
import { keSegmentDraft, tulisNaskah } from "../lib/script-engine/llm";
import { compileDeliveryText } from "../lib/script-engine/delivery-tags";
import { jendelaKata, validateScript } from "../lib/script-engine/validator";
import { renderSegmentsForTier, type SegmentDraft } from "../lib/script-engine/templates";
import { REGISTERS } from "../lib/script-engine/registers";
import { CATEGORY_NOUN, CATEGORY_PAIN, CATEGORY_PROOF } from "../lib/config/hooks";

const produk = { name: "Scarlett Acne Serum", category: "beauty", priceIdr: 75000 };
const durasi = 15;
const tier = "high_quality" as const;
const register = "bestie";
const cartLabel = "keranjang kuning";

// ---------- A. Naskah template: perilaku SEBELUM STEP 1 ----------
const ctx = {
  reg: REGISTERS.bestie, harga: "75 ribu", produk: produk.name,
  noun: CATEGORY_NOUN.beauty, pain: CATEGORY_PAIN.beauty, proof: CATEGORY_PROOF.beauty,
  space: "Meja skincare", aktivitas: "skincare-an malem", identitas: "tim glowing",
} as never;

console.log("=".repeat(78));
console.log("A. NASKAH TEMPLATE — perilaku sebelum STEP 1");
console.log("=".repeat(78));
for (const s of renderSegmentsForTier("H1", ctx, tier, durasi, cartLabel)) {
  console.log(`  [${s.start}-${s.end}s] ${s.role.toUpperCase().padEnd(4)} "${s.text}"`);
}

// ---------- B. Idea Stage + FYP Gate ----------
const ide = await pilihIde({
  productName: produk.name, productCategory: produk.category, kategoriNoun: CATEGORY_NOUN.beauty,
  priceIdr: produk.priceIdr, durationSec: durasi, contentType: "affiliate", register,
  klaim: ["teksturnya ringan", "cepat meresap"],
  format: "hands_only", hookLevel: "normal",
});

console.log("\n" + "=".repeat(78));
console.log(`B. KANDIDAT IDE — ${ide.peringkat.length} dinilai, ${ide.putaran} putaran`);
console.log("=".repeat(78));
for (const p of ide.peringkat) {
  const d = p.nilai.perDimensi;
  console.log(`\n[${String(p.nilai.total).padStart(5)}] ${p.ide.mechanic.padEnd(17)} ${p.nilai.lulus ? "LULUS" : "gagal"}`);
  console.log(`        one-liner : "${p.ide.one_liner}"`);
  console.log(`        situasi   : ${p.ide.human_situation}`);
  console.log(`        perangkat : ${p.ide.hook_device}  (level ${p.ide.hook_level})`);
  console.log(
    `        skor      : scroll-stop ${d.scroll_stop ?? "-"} · beda ${d.distinctiveness ?? "-"} · ` +
      `cerita ${d.story_pull ?? "-"} · payoff ${d.payoff ?? "-"} · label ${d.brand_fidelity_plan ?? "-"} · ` +
      `natural ${d.nativeness ?? "-"}`
  );
  if (!p.nilai.lulus) console.log(`        sebab     : ${p.nilai.sebabGagal.join(", ")}`);
  if (p.nilai.alasan) console.log(`        juri      : ${p.nilai.alasan}`);
}

console.log("\n" + "=".repeat(78));
console.log(`C. IDE TERPILIH — skor ${ide.nilai.total}, ${ide.nilai.lulus ? "LULUS gate" : "TIDAK lulus gate"}`);
console.log("=".repeat(78));
console.log(`mekanik   : ${ide.ide.mechanic} — ${MEKANIK_BY_ID[ide.ide.mechanic as keyof typeof MEKANIK_BY_ID]?.mekanik}`);
console.log(`one-liner : ${ide.ide.one_liner}`);
console.log(`perangkat : ${ide.ide.hook_device}`);
console.log(`kenapa    : ${ide.ide.why_stop}`);
console.log(`setup     : ${ide.ide.story.setup}`);
console.log(`tension   : ${ide.ide.story.tension}`);
console.log(`payoff    : ${ide.ide.story.payoff}`);
console.log(`peran prd : ${ide.ide.product_role}`);
console.log(`label     : ${ide.ide.brand_fidelity_plan}`);
console.log(`risiko    : ${ide.ide.risk}`);

// ---------- D. Naskah yang MELAYANI ide itu ----------
const { minWc, maxWc } = jendelaKata({ qualityTier: tier, durationSec: durasi, productName: produk.name });
const nilai = (segs: SegmentDraft[]) =>
  validateScript({
    hook_family: "H1", register, segments: segs, productName: produk.name,
    priceIdr: produk.priceIdr, qualityTier: tier, durationSec: durasi,
  } as never, "strict");

if (!ide.nilai.lulus) {
  console.log("\n" + "=".repeat(78));
  console.log("D. NASKAH — TIDAK DITULIS");
  console.log("=".repeat(78));
  console.log("Tidak ada ide yang lulus FYP Gate, jadi naskah TIDAK ditulis dari ide gagal.");
  console.log("Tiga terbaik di atas yang ditawarkan ke pengguna untuk dipilih (PATCH 4 §6).");
  process.exit(0);
}

let keluhan: string[] | undefined;
let segmen: SegmentDraft[] | null = null;
let hasilNilai: ReturnType<typeof nilai> | null = null;
for (let percobaan = 1; percobaan <= 2; percobaan++) {
  const segs = await tulisNaskah({
    productName: produk.name, productCategory: produk.category, priceIdr: produk.priceIdr,
    durationSec: durasi, contentType: "affiliate", cartLabel, register,
    hookFamily: "H1", hookLevel: "normal", format: "hands_only",
    wordMin: minWc, wordMax: maxWc, ide: petunjukNaskah(ide.ide), keluhan,
  });
  const draft = keSegmentDraft(segs).map((s) => ({ ...s, ...compileDeliveryText(s.text) }));
  const v = nilai(draft);
  segmen = draft; hasilNilai = v;
  console.log(`\n(percobaan naskah ${percobaan}: ${v.passed ? "LULUS validator" : "ditolak — " + v.errors.map((e) => e.rule).join(",")})`);
  if (v.passed) break;
  keluhan = v.errors.map((e) => e.message_id);
}

console.log("\n" + "=".repeat(78));
console.log("D. NASKAH 3 SEGMEN — melayani ide di atas");
console.log("=".repeat(78));
const kata = segmen!.map((s) => s.text).join(" ").trim().split(/\s+/).length;
console.log(`validator : ${hasilNilai!.passed ? "LULUS" : "GAGAL"} · ${kata} kata (jendela ${minWc}-${maxWc})`);
for (const w of hasilNilai!.warnings) console.log(`peringatan: ${w.rule} — ${w.message_id}`);
if (!hasilNilai!.passed) for (const e of hasilNilai!.errors) console.log(`error     : ${e.rule} — ${e.message_id}`);
for (const s of segmen!) {
  const x = s as SegmentDraft & { product_state?: string; start_state?: string };
  console.log(`\n[${s.start}-${s.end}s] ${s.role.toUpperCase()}  produk=${x.product_state ?? "-"}`);
  console.log(`  dialog : "${s.text}"`);
  console.log(`  awal   : ${x.start_state ?? "-"}`);
  console.log(`  visual : ${s.visual_direction}`);
}
