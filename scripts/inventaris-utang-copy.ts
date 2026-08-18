/**
 * INVENTARIS UTANG COPY — daftar kerja untuk penulis copy, bukan perbaikan
 * otomatis.
 *
 * Keputusan Brian 18 Agu (opsi a): suara copy dimiliki Brian/copywriter; agen
 * menyediakan inventaris dan diagnosisnya. Jadi skrip ini SENGAJA tidak
 * menulis ulang satu kalimat pun — ia cuma menjawab, per varian: berapa kata
 * sekarang, berapa yang muat, aturan mana yang dilanggar, dan kalimat mana
 * yang harus disentuh.
 *
 * Sumber angkanya AUDIT YANG SAMA dengan job CI catalog-debt-audit
 * (generateCatalogScriptAudit), bukan jalur generate kedua — dua jalur
 * penghitung akan menyimpang, dan yang menyimpang biasanya yang dipakai
 * mengambil keputusan.
 *
 *   SCRIPT_LLM=0 npx tsx scripts/inventaris-utang-copy.ts > UTANG_COPY.md
 */
import { generateCatalogScriptAudit } from "../lib/script-engine/catalog-audit";
import { jendelaKata } from "../lib/script-engine/validator";
import { getTemplate } from "../lib/templates";

const ARTI: Record<string, string> = {
  "L-05": "kepanjangan/kependekan untuk durasinya (batas Brian 1,5 kata/detik)",
  "L-19": "hook belum memakai perangkat retoris yang dikenali",
  "A-01": "penutup iklan belum mengarahkan ke bawah/bio",
  "A-02": "iklan jasa/app menyebut 'keranjang' — tidak ada keranjang yang bisa diklik",
  "L-03": "penutup afiliasi belum menyebut label keranjang",
  "T-01": "penutup TVC belum menyebut merek",
  "T-02": "TVC menyebut 'keranjang' — itu bahasa afiliasi",
  "T-03": "ada kalimat dengan dua negasi",
  "L-14": "angka/harga yang tidak ada di data produk",
};

function kata(t: string): number {
  return t.replace(/\[[^\]]*\]/g, " ").split(/\s+/).filter(Boolean).length;
}

const audit = await generateCatalogScriptAudit();

const baris = audit.templates.flatMap((t) =>
  t.variants.flatMap((v) => {
    if (v.validation.passed) return [];
    const tpl = getTemplate(t.templateId);
    const teks = v.segments.map((s) => s.text).join(" ");
    const { minWc, maxWc } = jendelaKata({
      qualityTier: tpl?.tier ?? "high_quality",
      durationSec: tpl?.durationSec ?? 15,
      productName: audit.fixture ? "" : "",
    });
    return [{
      templateId: t.templateId,
      genre: tpl?.kind ?? "?",
      durasi: tpl?.durationSec ?? 15,
      varian: v.variantIndex,
      kata: kata(teks),
      min: minWc,
      maks: maxWc,
      aturan: [...new Set(v.validation.errors.map((e) => e.rule))].sort(),
      hook: v.segments.find((s) => s.role === "hook")?.text ?? "",
      cta: v.segments.find((s) => s.role === "cta")?.text ?? "",
    }];
  })
);

const total = audit.templates.reduce((n, t) => n + t.variants.length, 0);
const perAturan = new Map<string, number>();
for (const b of baris) for (const a of b.aturan) perAturan.set(a, (perAturan.get(a) ?? 0) + 1);

const potong = (t: string) => t.replace(/\|/g, "/").replace(/\[[^\]]*\]/g, "").replace(/\s+/g, " ").trim().slice(0, 72);

console.log("# Utang copy katalog template\n");
console.log(`Dihitung ${audit.generatedAt} dari audit yang sama dengan catalog-debt-audit di CI.\n`);
console.log(`**${baris.length} dari ${total} varian** perlu ditulis ulang. Nama produk yang lebih panjang menggeser batas BAWAH, bukan batas atas.\n`);
console.log("| Aturan | Varian | Artinya |");
console.log("|---|---:|---|");
for (const [a, n] of [...perAturan].sort((x, y) => y[1] - x[1])) {
  console.log(`| ${a} | ${n} | ${ARTI[a] ?? "-"} |`);
}
console.log("\n## Per varian\n");
console.log("| Template | Genre | Dtk | # | Kata | Muat | Aturan | Hook sekarang | Penutup sekarang |");
console.log("|---|---|---:|---:|---:|---|---|---|---|");
for (const b of baris) {
  console.log(
    `| ${b.templateId} | ${b.genre} | ${b.durasi} | ${b.varian} | ${b.kata} | ${b.min}-${b.maks} | ${b.aturan.join(", ")} | ${potong(b.hook)} | ${potong(b.cta)} |`
  );
}
console.log(`\n_${new Set(baris.map((b) => b.templateId)).size} dari ${audit.templates.length} template terdampak._`);
