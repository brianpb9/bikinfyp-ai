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
