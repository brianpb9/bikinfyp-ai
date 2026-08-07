// r13 (review QA 2026-08-07): unit test utk findReusableClips — jaminan retry
// tidak membakar biaya provider lagi kalau klip upaya sebelumnya masih valid.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { findReusableClips } from "../lib/media/resume-clips";
import type { VisualSpec } from "../lib/providers/types";

const FFMPEG = process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg";

function makeClip(dir: string, name: string, durationSec: number): string {
  const out = path.join(dir, name);
  execFileSync(FFMPEG, ["-y", "-v", "error", "-f", "lavfi", "-i", `color=c=blue:s=64x64:r=10:d=${durationSec}`, "-pix_fmt", "yuv420p", out]);
  return out;
}

function spec(shots: { durationSec: number }[]): VisualSpec {
  return {
    jobId: "test", width: 720, height: 1280,
    shots: shots.map((s, i) => ({ index: i, durationSec: s.durationSec, prompt: "x", imageRefPath: "/dev/null" })),
    negativePrompt: "", qualityTier: "high_quality", generateAudio: true,
    hasProofInsert: false,
  };
}

test("findReusableClips: null bila klip belum ada", async () => {
  const dir = fs.mkdtempSync("/tmp/resume-clips-");
  const result = await findReusableClips(dir, spec([{ durationSec: 5 }]));
  assert.equal(result, null);
});

test("findReusableClips: pakai ulang klip valid, biaya 0 (tidak dobel-tagih)", async () => {
  const dir = fs.mkdtempSync("/tmp/resume-clips-");
  makeClip(dir, "shot0.mp4", 5);
  makeClip(dir, "shot1.mp4", 5);
  const result = await findReusableClips(dir, spec([{ durationSec: 5 }, { durationSec: 5 }]));
  assert.ok(result, "harus ketemu klip valid");
  assert.equal(result!.assets.length, 2);
  assert.equal(result!.costIdr, 0, "biaya 0 -- sudah tercatat di upaya sebelumnya, retry tidak boleh menagih ulang");
  assert.equal(result!.providerName, "reused-from-disk");
});

test("findReusableClips: null bila salah satu shot hilang (klip parsial dari upaya gagal di tengah)", async () => {
  const dir = fs.mkdtempSync("/tmp/resume-clips-");
  makeClip(dir, "shot0.mp4", 5);
  // shot1.mp4 sengaja tidak dibuat -- upaya sebelumnya gagal sebelum shot1 selesai
  const result = await findReusableClips(dir, spec([{ durationSec: 5 }, { durationSec: 5 }]));
  assert.equal(result, null, "jangan pakai klip PARSIAL -- generate ulang semua lebih aman daripada campur klip lama+baru");
});

test("findReusableClips: null bila durasi klip di disk tidak cocok spec (kemungkinan sisa job lain/beda tier)", async () => {
  const dir = fs.mkdtempSync("/tmp/resume-clips-");
  makeClip(dir, "shot0.mp4", 2); // jauh dari 15 dtk yang diminta
  const result = await findReusableClips(dir, spec([{ durationSec: 15 }]));
  assert.equal(result, null);
});
