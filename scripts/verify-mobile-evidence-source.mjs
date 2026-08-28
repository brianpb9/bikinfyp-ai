#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const attestationPath = path.join(root, ".evidence-source-attestation.json");
const bytes = fs.readFileSync(attestationPath);
const attestation = JSON.parse(bytes);
if (attestation.schema !== "mobile-evidence-source/v1") throw new Error("source attestation schema mismatch");
if (attestation.commit !== process.env.EVIDENCE_SOURCE_SHA) throw new Error("source attestation commit mismatch");
if (attestation.tree !== process.env.EVIDENCE_SOURCE_TREE) throw new Error("source attestation tree mismatch");
for (const item of attestation.files) {
  if (!/^[0-9a-f]{64}$/.test(item.sha256) || !Number.isInteger(item.bytes) || typeof item.path !== "string") {
    throw new Error("source attestation entry malformed");
  }
  const absolute = path.resolve(root, item.path);
  if (!absolute.startsWith(`${root}${path.sep}`)) throw new Error(`source attestation path escaped: ${item.path}`);
  const source = fs.readFileSync(absolute);
  if (source.length !== item.bytes || crypto.createHash("sha256").update(source).digest("hex") !== item.sha256) {
    throw new Error(`source attestation mismatch: ${item.path}`);
  }
}
process.stdout.write(`${JSON.stringify({ commit: attestation.commit, tree: attestation.tree,
  manifest_sha256: crypto.createHash("sha256").update(bytes).digest("hex"), files: attestation.files.length })}\n`);
