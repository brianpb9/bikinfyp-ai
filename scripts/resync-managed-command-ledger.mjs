#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const evidenceDir = process.argv[2];
if (!evidenceDir) throw new Error("evidence directory is required");
const ledgerPath = path.join(evidenceDir, "command-ledger.tsv");
const lines = fs.readFileSync(ledgerPath, "utf8").trimEnd().split("\n");
const updated = lines.map((line, index) => {
  if (index === 0) return line;
  const fields = line.split("\t");
  if (fields.length !== 6) throw new Error(`invalid ledger row ${index + 1}`);
  const bytes = fs.readFileSync(path.join(evidenceDir, fields[4]));
  fields[5] = crypto.createHash("sha256").update(bytes).digest("hex");
  return fields.join("\t");
});
process.stdout.write(`${updated.join("\n")}\n`);
