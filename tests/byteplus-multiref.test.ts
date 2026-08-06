// Unit test buildTaskContent (multi-foto referensi, 2026-08-06):
// - tanpa foto ekstra -> mode i2v lama (1 image tanpa role),
// - foto ekstra + model Seedance 2.0 -> SEMUA image ber-role reference_image
//   (aturan ModelArk terverifikasi: first_frame tidak boleh dicampur reference),
// - foto ekstra + model Seedance 1.0 (tier senyap) -> tetap i2v (1.0 tanpa r2v),
// - maks 4 foto ekstra (5 total).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

process.env.DB_PATH = `/tmp/racun-test-multiref-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-multiref-storage-${process.pid}`;

const { buildTaskContent } = await import("../lib/providers/stubs/byteplus");
import type { VisualSpec, ShotSpec } from "../lib/providers/types";

// PNG 1x1 nyata supaya imageToDataUri bisa membaca file.
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "multiref-"));
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
  "base64"
);
const mk = (name: string) => {
  const p = path.join(dir, name);
  fs.writeFileSync(p, png);
  return p;
};
const main = mk("0.png");
const extras = [mk("1.png"), mk("2.png"), mk("3.png"), mk("4.png"), mk("5.png")];

const shot: ShotSpec = { index: 0, durationSec: 7.5, prompt: "hands presenting product", imageRefPath: main };
const spec = (extra?: string[]): VisualSpec => ({
  jobId: "t", width: 720, height: 1280, shots: [shot],
  negativePrompt: "no text, no logo, no writing",
  qualityTier: "high_quality", generateAudio: true,
  extraReferenceImagePaths: extra,
});

type Item = { type: string; role?: string };

test("tanpa foto ekstra: mode i2v lama (1 image, tanpa role)", () => {
  const items = buildTaskContent(spec(undefined), shot, "dreamina-seedance-2-0-mini-260615") as Item[];
  assert.equal(items.filter((i) => i.type === "image_url").length, 1);
  assert.ok(items.every((i) => i.role === undefined));
});

test("foto ekstra + Seedance 2.0: semua image ber-role reference_image", () => {
  const items = buildTaskContent(spec(extras.slice(0, 2)), shot, "dreamina-seedance-2-0-mini-260615") as Item[];
  const imgs = items.filter((i) => i.type === "image_url");
  assert.equal(imgs.length, 3); // utama + 2 ekstra
  assert.ok(imgs.every((i) => i.role === "reference_image"), "SEMUA harus reference_image (tidak boleh campur first_frame)");
});

test("foto ekstra + Seedance 1.0 (tier senyap): tetap i2v", () => {
  const items = buildTaskContent(spec(extras.slice(0, 2)), shot, "seedance-1-0-pro-fast-251015") as Item[];
  assert.equal(items.filter((i) => i.type === "image_url").length, 1);
  assert.ok(items.every((i) => i.role === undefined));
});

test("maks 4 foto ekstra (total 5 image)", () => {
  const items = buildTaskContent(spec(extras), shot, "dreamina-seedance-2-0-260128") as Item[];
  assert.equal(items.filter((i) => i.type === "image_url").length, 5);
});
