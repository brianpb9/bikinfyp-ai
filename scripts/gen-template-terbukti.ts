// Generator lib/config/template-terbukti.json dari ekspor label winner GMV
// (repo Viral Meter, exports/template_terbukti_winners_*.csv).
//
// ATURAN (TEMPLATE_TERBUKTI_README.md): yang boleh dibawa ke repo/user hanya
// POLA AGREGAT (kombinasi label + hitungan) — TIDAK PERNAH konten mentah
// (caption/url/skrip video orang). CSV sumber tetap di repo model, tidak
// di-commit ke sini.
//
// Pakai: npx tsx scripts/gen-template-terbukti.ts "<path csv>"
import fs from "node:fs";
import path from "node:path";

const csvPath = process.argv[2];
if (!csvPath) {
  console.error("pakai: npx tsx scripts/gen-template-terbukti.ts <path-csv-winner>");
  process.exit(1);
}

function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let cur = "", row: string[] = [], inQ = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQ) {
      if (c === '"' && text[i + 1] === '"') { cur += '"'; i++; }
      else if (c === '"') inQ = false;
      else cur += c;
    } else if (c === '"') inQ = true;
    else if (c === ",") { row.push(cur); cur = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cur); cur = "";
      if (row.some((v) => v !== "")) rows.push(row);
      row = [];
    } else cur += c;
  }
  if (cur !== "" || row.length) { row.push(cur); rows.push(row); }
  const header = rows[0];
  return rows.slice(1).map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

const rows = parseCsv(fs.readFileSync(csvPath, "utf-8"));
const total = rows.length;

// Definisi pola -> preset yang BISA diekspresikan generator kita.
// Keluarga hook dipetakan balik dari taxonomy model (lihat
// lib/fyp-score/features.ts HOOK_FAMILY_TO_MODEL_HOOK_TYPE).
const TEMPLATES = [
  {
    id: "klaim_langsung",
    name: "Klaim Langsung",
    desc: "Testimoni to-the-point: langsung klaim manfaat, payoff instan",
    match: (r: Record<string, string>) => r.label_hook_type === "direct_claim" && r.label_narrative === "instant_payoff",
    preset: { format: "talking_head", qualityTier: "high_quality", durationSec: 30, hookFamilies: ["H3", "H12", "H10", "H5"] },
    evidence: "pola paling sering muncul di video pemenang",
  },
  {
    id: "tanya_jawab",
    name: "Tanya-Jawab Cepat",
    desc: "Buka dengan pertanyaan relatable, jawab cepat pakai produk",
    match: (r: Record<string, string>) => r.label_hook_type === "question",
    preset: { format: "talking_head", qualityTier: "high_quality", durationSec: 30, hookFamilies: ["H15", "H2", "H9", "H13"] },
    evidence: "juga didukung koefisien model (hook pertanyaan berkorelasi menang)",
  },
  {
    id: "demo_transformasi",
    name: "Demo Transformasi",
    desc: "Tunjukkan pemakaian & perubahan sebelum-sesudah, tanpa wajah",
    match: (r: Record<string, string>) => r.label_format === "tutorial" || r.label_narrative === "transformation",
    preset: { format: "hands_only", qualityTier: "silent_caption", durationSec: 30, hookFamilies: ["H11", "H12", "H5", "H6"] },
    evidence: "pola tutorial/transformasi di video pemenang",
  },
];

const out = {
  generated_from: path.basename(csvPath),
  generated_at: new Date().toISOString().slice(0, 10),
  total_winners: total,
  disclaimer:
    "“Terbukti” = terbukti menang GMV di data pembanding kami (korelasional) — bukan jaminan FYP.",
  templates: TEMPLATES.map((t) => ({
    id: t.id,
    name: t.name,
    desc: t.desc,
    count: rows.filter(t.match).length,
    evidence: t.evidence,
    preset: t.preset,
  })),
};

const outPath = path.join(process.cwd(), "lib", "config", "template-terbukti.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2) + "\n");
console.log(`ditulis: ${outPath}`);
for (const t of out.templates) console.log(`  ${t.name}: ${t.count}/${total} winner`);
