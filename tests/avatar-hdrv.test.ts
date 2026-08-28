import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { AVATAR_PRESETS, getAvatarPreset } from "../lib/avatar-presets";
import { getCreatorCategory } from "../lib/personas";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";

// Pustaka avatar HDRV menggantikan 11 avatar generik (2026-08-13). Rancangannya
// memisahkan IDENTITAS (id + desc) dari SUARA (voice -> kategori kreator lama).
// Yang paling mudah rusak: `voice` menunjuk kategori yang tidak ada atau tidak
// aktif — backend memvalidasinya saat job dibuat, jadi kesalahan di sini baru
// ketahuan sebagai job yang gagal dibuat, bukan sebagai layar yang salah.

test("setiap avatar meminjam suara dari kategori kreator yang NYATA dan aktif", () => {
  for (const a of AVATAR_PRESETS) {
    const c = getCreatorCategory(a.voice);
    assert.ok(c, `${a.id} memakai voice "${a.voice}" yang tidak ada di personas.ts`);
    assert.equal(c!.status, "active", `${a.id} memakai voice "${a.voice}" yang tidak aktif`);
  }
});

test("roster kanonik persis 19 influencer HDRV dengan metadata writer dan CAST-REF", () => {
  assert.equal(AVATAR_PRESETS.length, 19);
  assert.equal(AVATAR_PRESETS.filter((avatar) => avatar.gender === "female").length, 11);
  assert.equal(AVATAR_PRESETS.filter((avatar) => avatar.gender === "male").length, 8);
  for (const avatar of AVATAR_PRESETS) {
    assert.ok(["bunda", "bestie", "genz", "netral"].includes(avatar.register), `${avatar.id}: register invalid`);
    assert.match(avatar.castLock, /^CAST-LOCK:/, `${avatar.id}: CAST-LOCK tidak eksplisit`);
    assert.equal(avatar.desc, avatar.castLock, `${avatar.id}: alias desc hanyut dari CAST-LOCK`);
    assert.equal(avatar.referenceImages.length, 4, `${avatar.id}: pack referensi tidak lengkap`);
    for (const image of avatar.referenceImages) assert.ok(fs.existsSync(`public${image}`), `referensi hilang: ${image}`);
  }
});

test("id avatar unik dan tidak bentrok dengan id kategori kreator", () => {
  const ids = AVATAR_PRESETS.map((a) => a.id);
  assert.equal(new Set(ids).size, ids.length, "ada id avatar kembar");
  for (const id of ids) {
    assert.equal(getCreatorCategory(id), undefined, `id avatar "${id}" bentrok dengan id kategori kreator`);
  }
});

test("setiap avatar punya deskripsi fisik yang benar-benar berguna", () => {
  for (const a of AVATAR_PRESETS) {
    // desc dikirim sebagai avatar_custom_desc dan MENIMPA promptSeed. Terlalu
    // pendek berarti wajahnya diserahkan ke tebakan model.
    assert.ok(a.desc.length > 60, `${a.id}: deskripsi terlalu pendek (${a.desc.length})`);
    assert.match(a.desc, /Indonesian/, `${a.id}: deskripsi tidak menyebut orang Indonesia`);
  }
});

test("dua avatar yang berbagi suara TETAP punya deskripsi berbeda", () => {
  const perSuara = new Map<string, string[]>();
  for (const a of AVATAR_PRESETS) perSuara.set(a.voice, [...(perSuara.get(a.voice) ?? []), a.desc]);
  for (const [voice, list] of perSuara) {
    assert.equal(new Set(list).size, list.length, `avatar dengan suara "${voice}" punya deskripsi kembar — akan tampil sama`);
  }
});

test("foto tiap avatar benar-benar ada", () => {
  for (const a of AVATAR_PRESETS) {
    assert.ok(fs.existsSync(`public${a.img}`), `foto hilang: ${a.img}`);
  }
});

test("ada avatar untuk kedua gender", () => {
  for (const g of ["female", "male"] as const) {
    assert.ok(AVATAR_PRESETS.some((a) => a.gender === g), `tidak ada avatar ${g}`);
  }
});

test("getAvatarPreset mengembalikan null untuk yang tidak dikenal", () => {
  assert.equal(getAvatarPreset(null), null);
  assert.equal(getAvatarPreset("tidak-ada"), null);
  assert.ok(getAvatarPreset(AVATAR_PRESETS[0].id));
});

test("tiga template UGC Ads baru terdaftar tanpa menampilkan klip legacy", () => {
  for (const id of ["ads-unboxing-pov", "ads-meja-kosong", "ads-panas-ekstrem"]) {
    const t = CAMPAIGN_TEMPLATES.find((x) => x.id === id);
    assert.ok(t, `${id} tidak ada`);
    assert.equal(t!.group, "ads", `${id} tidak masuk kolom UGC Ads`);
    assert.equal(t!.preview, null, `${id}: klip legacy tidak cocok dengan staging netral baru`);
    assert.ok(t!.caution, `${id}: tanpa peringatan — aturan dokumennya hilang`);
  }
});
