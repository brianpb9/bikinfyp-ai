import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const apiSource = readFileSync(
  new URL("../app/api/dashboard/campaign/generate/route.ts", import.meta.url),
  "utf8"
);
const dashboardSource = readFileSync(
  new URL("../app/dashboard/(app)/campaign/page.tsx", import.meta.url),
  "utf8"
);

test("API dashboard menolak count template di atas kapasitas dengan pesan jelas", () => {
  assert.match(apiSource, /templateId && count > TEMPLATE_COPY_CAPACITY/);
  assert.match(apiSource, /Template ini menyediakan maksimal.*variasi naskah unik/);
  assert.match(apiSource, /Lepas template untuk membuat sampai/);
});

test("dashboard membatasi dan meng-clamp jumlah video berdasarkan template", () => {
  assert.match(dashboardSource, /maxVideoCount = template \? TEMPLATE_COPY_CAPACITY : 6/);
  assert.match(dashboardSource, /count > TEMPLATE_COPY_CAPACITY\) setCount\(TEMPLATE_COPY_CAPACITY\)/);
  assert.match(dashboardSource, /setCount\(Math\.min\(t\.count, TEMPLATE_COPY_CAPACITY\)\)/);
  assert.match(dashboardSource, /length: maxVideoCount - 1/);
});
