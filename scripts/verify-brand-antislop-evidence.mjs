#!/usr/bin/env node
import fs from "node:fs";
import { verifyBrandAntiSlopEvidence } from "../lib/brand-antislop-evidence.mjs";

const file = process.argv[2];
if (!file) {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", reason: "usage: verify-brand-antislop-evidence <packet.json>" })}\n`);
  process.exitCode = 1;
} else {
  try {
    const packet = JSON.parse(fs.readFileSync(file, "utf8"));
    process.stdout.write(`${JSON.stringify(verifyBrandAntiSlopEvidence(packet))}\n`);
  } catch (error) {
    process.stderr.write(`${JSON.stringify({ status: "FAIL", reason: error instanceof Error ? error.message : String(error) })}\n`);
    process.exitCode = 1;
  }
}
