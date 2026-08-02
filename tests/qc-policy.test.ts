import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQcPolicy, QC_POLICY_BY_FORMAT, type QcCheck } from "../lib/media/qc";

const passing = (): QcCheck[] => [
  { code: "QC-01", name: "lip-sync", status: "skip" },
  ...QC_POLICY_BY_FORMAT.hands_only.requiredPass.map((code) => ({ code, name: code, status: "pass" as const })),
];

test("QC hands_only: hanya N/A terdokumentasi boleh skip", () => {
  assert.equal(evaluateQcPolicy("hands_only", passing()), true);
  const uncertainOverlay = passing().map((c) => c.code === "QC-06" ? { ...c, status: "skip" as const } : c);
  assert.equal(evaluateQcPolicy("hands_only", uncertainOverlay), false);
});

test("QC hands_only: check wajib hilang atau format tanpa kebijakan menolak", () => {
  assert.equal(evaluateQcPolicy("hands_only", passing().filter((check) => check.code !== "QC-09")), false);
  assert.equal(evaluateQcPolicy("talking_head", passing()), false);
});
