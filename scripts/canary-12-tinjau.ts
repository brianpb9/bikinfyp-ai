/**
 * Bahan tinjau canary — frame + kontak sheet untuk DUA reviewer manusia.
 *
 * Gate 3 menuntut tinjauan manual dua orang, dan reviewer tidak menonton 12
 * mp4 satu per satu di terminal. Skrip ini menarik 3 frame per klip (awal,
 * tengah, akhir) dan menulis MARKDOWN berdampingan dengan hasil QC — supaya
 * yang ditinjau manusia persis yang dinilai mesin, di satu halaman.
 */
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const OUT = path.resolve(process.cwd(), "..", "test_output", "canary_12");
const ffmpeg = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";

const laporan = JSON.parse(fs.readFileSync(path.join(OUT, "laporan.json"), "utf8")) as {
  total: number;
  laporan: { id: string; sifat: string; status: string; berkas?: string; qc?: { code: string; status: string; detail: string }[]; segments?: { role: string; text: string }[]; script_source?: string; fotoSintetis?: boolean }[];
};

const baris: string[] = [
  "# Tinjauan Canary 12 Klip — 19 Agu 2026",
  "",
  `Total biaya render: Rp${laporan.total.toLocaleString("id-ID")}. Tiap klip = SATU shot (~5 dtk) dari rantai produksi penuh.`,
  "",
  "Kolom reviewer diisi MANUSIA, bukan disalin dari QC: [ ] lolos · [x] cacat + catatan.",
  "",
];

for (const k of laporan.laporan) {
  baris.push(`## ${k.id} — ${k.sifat}`);
  if (k.status !== "ok" || !k.berkas) {
    baris.push(`**STATUS: ${k.status}** — tidak ada klip untuk ditinjau.`, "");
    continue;
  }
  for (const [nama, posisi] of [["awal", "10"], ["tengah", "50"], ["akhir", "90"]] as const) {
    const f = path.join(OUT, k.id, `frame-${nama}.jpg`);
    try {
      execFileSync(ffmpeg, ["-y", "-v", "error", "-i", k.berkas, "-vf", `select=gte(t\\,${Number(posisi) / 100 * 5})`, "-frames:v", "1", f]);
    } catch { /* frame gagal ditarik — mp4-nya tetap ada */ }
  }
  baris.push(
    `Naskah (${k.script_source}${k.fotoSintetis ? ", foto sintetis" : ", foto nyata"}):`,
    ...(k.segments ?? []).map((s) => `- **${s.role}**: ${s.text}`),
    "",
    "QC mesin:",
    ...(k.qc ?? []).map((c) => `- ${c.code} **${c.status.toUpperCase()}** — ${c.detail}`),
    "",
    // Rubrik formal (board review 19 Agu §4.2): dua dimensi bernilai 0-2 di
    // samping ceklis cacat, plus daftar CRITICAL FAIL yang masing-masing
    // menggagalkan klip sendirian. "Scroll-stop" dinilai TERHADAP feed
    // pembanding bernama, bukan perasaan — reviewer wajib menulis pembandingnya.
    "Reviewer 1 (label / merek / anatomi / bahasa): [ ]",
    "Reviewer 2: [ ]",
    "",
    "Rubrik skor (masing-masing 0-2, isi manusia):",
    "- **Bahasa & CTA** ( /2): transkrip 100% Indonesia; frasa CTA benar untuk content-type-nya (afiliasi=keranjang, Ads=tanpa keranjang); nol klaim berlebihan.",
    "- **Scroll-stop** ( /2): dibandingkan feed FYP nyata — SEBUTKAN video pembandingnya (akun/tautan). 2 = berhenti scroll, 1 = mungkin, 0 = lewat.",
    "",
    "CRITICAL FAIL (satu saja = klip gagal, apa pun skornya):",
    "- [ ] dialog berbahasa Inggris",
    "- [ ] on-screen text karangan model (bukan overlay kami)",
    "- [ ] pack shot di detik pertama",
    "- [ ] wajah berubah antar klip produk yang sama",
    "- [ ] naskah template/degraded terkirim sebagai output",
    "",
    `Berkas: \`${path.relative(path.resolve(process.cwd(), ".."), k.berkas)}\` · frame: frame-awal/tengah/akhir.jpg`,
    "",
  );
}

fs.writeFileSync(path.join(OUT, "TINJAUAN.md"), baris.join("\n"));
console.log(`Tinjauan: ${path.join(OUT, "TINJAUAN.md")}`);
