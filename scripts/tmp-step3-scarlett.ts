import { pilihIde, petunjukNaskah } from "../lib/script-engine/ide";
import { MEKANIK_BY_ID } from "../lib/script-engine/idea-mechanics";

const hasil = await pilihIde({
  productName: "Scarlett Acne Serum", productCategory: "beauty", kategoriNoun: "skincare",
  priceIdr: 75000, durationSec: 15, contentType: "affiliate", register: "bestie",
  klaim: ["teksturnya ringan", "cepat meresap"],
});

console.log(`\n=== PERINGKAT (${hasil.peringkat.length} kandidat dinilai, putaran ${hasil.putaran}) ===`);
for (const p of hasil.peringkat) {
  const d = p.nilai.perDimensi;
  const rinci = Object.keys(d).length
    ? `stop ${d.scroll_stop} · beda ${d.distinctiveness} · cerita ${d.story_pull} · payoff ${d.payoff} · label ${d.brand_fidelity_plan} · natural ${d.nativeness}`
    : "(tidak dinilai)";
  console.log(`\n[${String(p.nilai.total).padStart(5)}] ${p.ide.mechanic.padEnd(18)} ${p.nilai.lulus ? "LULUS" : "gagal"}`);
  console.log(`        "${p.ide.one_liner}"`);
  console.log(`        ${rinci}`);
  if (!p.nilai.lulus) console.log(`        sebab: ${p.nilai.sebabGagal.join(", ")}`);
  if (p.nilai.alasan) console.log(`        juri: ${p.nilai.alasan}`);
}

console.log(`\n=== IDE TERPILIH ===`);
console.log(`mekanik   : ${hasil.ide.mechanic} — ${MEKANIK_BY_ID[hasil.ide.mechanic as keyof typeof MEKANIK_BY_ID]?.mekanik}`);
console.log(`one-liner : ${hasil.ide.one_liner}`);
console.log(`kenapa    : ${hasil.ide.why_stop}`);
console.log(`story     : ${hasil.ide.story.setup} -> ${hasil.ide.story.tension} -> ${hasil.ide.story.payoff}`);
console.log(`peran prd : ${hasil.ide.product_role}`);
console.log(`label     : ${hasil.ide.brand_fidelity_plan}`);
console.log(`risiko    : ${hasil.ide.risk}`);
console.log(`\n=== PETUNJUK KE PENULIS NASKAH ===\n${petunjukNaskah(hasil.ide)}`);
