import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AVATAR_PRESETS } from "../lib/avatar-presets";
import { resolveAvatarDescription } from "../lib/promo/avatar";

const read = (path: string) => fs.readFileSync(path, "utf8");

test("promo, retail, campaign, dan matrix mengambil avatar dari satu roster", () => {
  const promo = read("app/promo/page.tsx");
  const retail = read("app/bikin/gaya/page.tsx");
  const campaign = read("app/dashboard/(app)/campaign/page.tsx");
  const matrix = read("app/api/dashboard/matrix/route.ts");
  for (const source of [promo, retail, campaign, matrix]) assert.match(source, /AVATAR_PRESETS/);
  assert.doesNotMatch(promo, /const AVATAR_PRESETS/);
  assert.doesNotMatch(retail, /const CREATOR_CATS/);
  for (const legacy of ["Salma", "Zea", "Bunda Ratih", "Keisha", "Dina", "Raka", "Fajar", "Pak Danu", "Pak Herman", "Bimo", "Yoga", "Laras"]) {
    assert.doesNotMatch(promo, new RegExp(legacy));
    assert.doesNotMatch(retail, new RegExp(legacy));
  }
});

test("promo menerima id influencer lalu resolver memakai CAST-LOCK, bukan fallback persona generik", () => {
  const avatar = AVATAR_PRESETS.find((item) => item.id === "nico-tan")!;
  assert.equal(resolveAvatarDescription({ kind: "preset", presetId: avatar.id }), avatar.castLock);
  const route = read("app/api/promo/jobs/route.ts");
  assert.match(route, /getAvatarPreset\(presetId\)/);
  assert.match(route, /getCreatorCategory\(preset\.voice\)/);
});

test("pilihan avatar masuk ke payload penulis dan render", () => {
  const promo = read("app/promo/page.tsx");
  const retail = read("app/bikin/gaya/page.tsx");
  const campaign = read("app/dashboard/(app)/campaign/page.tsx");
  const generator = read("app/api/dashboard/campaign/generate/route.ts");
  const confirm = read("app/api/dashboard/campaign/confirm/route.ts");
  assert.match(promo, /preset_id: avatarPresetId/);
  assert.match(retail, /avatarId, avatarDesc: getAvatarPreset\(avatarId\)\?\.castLock/);
  assert.match(campaign, /avatar_id: avatarId/);
  assert.match(campaign, /register: getAvatarPreset\(avatarId\)\?\.register/);
  assert.match(generator, /getAvatarPreset\(body\.avatar_id\)/);
  assert.match(confirm, /avatarPreset\?\.castLock/);
  assert.match(retail, /initialAvatar = restoredAvatar \?\? AVATAR_PRESETS\.find/);
  assert.match(retail, /restoredFlow\.register/);
  assert.match(retail, /disabled=\{loading \|\| !selectedAvatar\}/);
});

test("template brand menyimpan dan memulihkan avatar ID, bukan ID suara", () => {
  const campaign = read("app/dashboard/(app)/campaign/page.tsx");
  const route = read("app/api/dashboard/templates/route.ts");
  assert.match(campaign, /creator_category: avatarId/);
  assert.match(campaign, /getAvatarPreset\(String\(t\.creator_category/);
  assert.match(campaign, /setAvatarNeedsReselection\(true\)/);
  assert.match(campaign, /Template lama/);
  assert.match(route, /getAvatarPreset\(String\(body\.creator_category/);
  assert.match(route, /avatar\.id/);
});

test("dashboard photo dropzone memakai route org dan menghormati slot tersisa", () => {
  const page = read("app/dashboard/(app)/campaign/page.tsx");
  const route = read("app/api/dashboard/campaign/product/[id]/photos/route.ts");
  assert.match(page, /onDrop=/);
  assert.match(page, /onDragOver=/);
  assert.match(page, /MAX_PHOTOS - product\.images\.length/);
  assert.match(page, /api\/dashboard\/campaign\/product\/\$\{product\.product_id\}\/photos/);
  assert.doesNotMatch(page, /fetch\(`\/api\/products\/\$\{product\.product_id\}\/photos/);
  assert.match(route, /requireOrgContextApi/);
  assert.match(route, /smokeGetOrgProduct\(orgId, productId\)/);
  assert.match(route, /pgAppendOrgProductImages\(membership\.org_id/);
  assert.match(route, /pgRemoveOrgProductImage\(membership\.org_id/);
  assert.match(route, /readSinglePhotoMultipart/);
  assert.match(page, /uploadPhotosQueued/);
  const runtime = read("lib/postgres/smoke-runtime.ts");
  assert.match(runtime, /jsonb_array_length/);
  assert.match(runtime, /RETURNING images/);
  assert.doesNotMatch(route, /saveProductImages\(id, blobs, owned\.images\.length\)/);
});
