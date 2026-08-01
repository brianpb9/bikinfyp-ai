// Unit test framing mock provider: sumber non-9:16 WAJIB contain/letterbox,
// tidak boleh cover-crop (regresi bug crop teks tepi foto).

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

test("mock renderZoompanShot memakai contain (decrease) + blur letterbox, bukan cover-crop untuk fg", () => {
  const src = fs.readFileSync(new URL("../lib/providers/mock/shared.ts", import.meta.url), "utf8");
  // Foreground harus CONTAIN
  assert.ok(src.includes("force_original_aspect_ratio=decrease"), "fg harus contain (decrease)");
  // Letterbox blur dari foto itu sendiri
  assert.ok(src.includes("boxblur"), "latar letterbox harus blur");
  // Foto non-9:16 di-scale 90% + zoom dibatasi supaya tepi tidak terpotong
  assert.ok(src.includes("0.9"), "fg non-9:16 harus di-scale 90%");
  assert.ok(src.includes("1.06"), "zoom non-9:16 harus dibatasi 1.06");
});
