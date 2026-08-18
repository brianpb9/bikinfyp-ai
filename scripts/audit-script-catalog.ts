/**
 * HERMETIK: audit ini TIDAK BOLEH memanggil penyedia berbayar.
 *
 * Ia menilai copy TEMPLATE, dan penulis LLM tidak ada hubungannya dengan itu.
 * Tapi selama SCRIPT_LLM tidak dikunci, .env.local mengisinya sendiri dan
 * setiap kali audit dijalankan — di CI, di laptop, oleh auditor — request
 * Anthropic ikut terkirim. Reviewer ronde 5 menjalankannya dan memicu
 * sedikitnya dua request tanpa pernah memintanya.
 *
 * Uang tidak boleh keluar sebagai efek samping dari MENGUKUR.
 *
 * Ditulis sebagai PEMERIKSAAN, bukan penugasan: `import` di ESM dievaluasi
 * sebelum baris mana pun di badan modul, jadi menyetel process.env di sini
 * sudah terlambat untuk modul yang membaca env saat dimuat. Yang bisa
 * diandalkan hanya menolak berjalan.
 */
if (process.env.SCRIPT_LLM !== "0") {
  console.error(
    "audit:script-catalog menolak berjalan tanpa SCRIPT_LLM=0.\n" +
      "Audit ini menilai copy TEMPLATE dan tidak boleh memanggil penyedia berbayar.\n" +
      "Jalankan: SCRIPT_LLM=0 npm run audit:script-catalog"
  );
  process.exit(2);
}

import fs from "node:fs";
import path from "node:path";
import { generateCatalogScriptAudit } from "../lib/script-engine/catalog-audit";

function outputPath(argv: string[]): string | null {
  const index = argv.indexOf("--output");
  if (index === -1) return null;
  const value = argv[index + 1];
  if (!value) throw new Error("--output membutuhkan path berkas JSON");
  return path.resolve(value);
}

const audit = await generateCatalogScriptAudit();
const json = `${JSON.stringify(audit, null, 2)}\n`;
const target = outputPath(process.argv.slice(2));

if (target) {
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, json, "utf8");
  process.stderr.write(`Bukti audit ditulis ke ${target}\n`);
  process.stderr.write(`${JSON.stringify(audit.summary, null, 2)}\n`);
} else {
  process.stdout.write(json);
}

if (!audit.summary.passed) process.exitCode = 1;
