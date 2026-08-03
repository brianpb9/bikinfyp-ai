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
  // Format yang genuinely tidak terdaftar (bukan talking_head/vo_broll, yang
  // sekarang punya kebijakan sendiri sejak v1 Wajah AI/VO+Foto) wajib ditolak.
  assert.equal(evaluateQcPolicy("some_unlisted_format", passing()), false);
});

test("QC talking_head & vo_broll: masing-masing punya kebijakan sendiri", () => {
  const talkingHeadPassing: QcCheck[] = [
    { code: "QC-01", name: "lip-sync", status: "skip" },
    ...QC_POLICY_BY_FORMAT.talking_head.requiredPass.map((code) => ({ code, name: code, status: "pass" as const })),
  ];
  assert.equal(evaluateQcPolicy("talking_head", talkingHeadPassing), true);
  // QC-09 (larangan wajah) tidak boleh jadi syarat untuk talking_head.
  assert.ok(!(QC_POLICY_BY_FORMAT.talking_head.requiredPass as readonly string[]).includes("QC-09"));

  const voBrollPassing: QcCheck[] = [
    { code: "QC-01", name: "lip-sync", status: "skip" },
    { code: "QC-02", name: "hand-morph", status: "skip" },
    ...QC_POLICY_BY_FORMAT.vo_broll.requiredPass.map((code) => ({ code, name: code, status: "pass" as const })),
  ];
  assert.equal(evaluateQcPolicy("vo_broll", voBrollPassing), true);
});
