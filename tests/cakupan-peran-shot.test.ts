import { test } from "node:test";
import assert from "node:assert/strict";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { ugcRolesFor } from "../lib/media/ugc-template-roles";
import { TIDAK_OTOMATIS } from "../lib/auto-pick";

// Template tanpa tabel peran shot jatuh ke beat generik — artinya kartunya
// menjanjikan sesuatu ("atap runtuh", "waktu berhenti") yang tidak pernah
// terjadi di videonya. Pola ini sudah ditemukan DUA KALI lewat render; tes ini
// supaya tidak ada kali ketiga.

/** Yang memang SENGAJA tanpa tabel, dengan alasannya masing-masing.
 *  Daftar ini pendek dan harus tetap pendek — tiap tambahan di sini adalah
 *  janji yang kita putuskan tidak tepati. */
const SENGAJA_TANPA_TABEL: Record<string, string> = {
  "t05-before-after": "klaim hasil — butuh rekaman asli, tidak boleh dikarang",
  "t08-day-1-vs-day-7": "klaim hasil — butuh rekaman asli",
  "t10-bukti-di-lengan": "klaim hasil — butuh rekaman asli",
  "t12-vox-pop": "butuh 4 wajah berbeda, melawan penjaga konsistensi identitas",
};

test("setiap template ads dan format punya tabel peran shot", () => {
  const kurang: string[] = [];
  for (const t of CAMPAIGN_TEMPLATES) {
    // "sudut" sengaja tidak punya struktur: ia mengubah SUDUT HOOK, bukan
    // susunan shot, dan memang dirancang bisa dipakai di format mana pun.
    // TVC punya tabel rutenya sendiri di shot-planner.
    if (t.group === "sudut" || t.group === "tvc") continue;
    if (SENGAJA_TANPA_TABEL[t.id]) continue;
    if (!ugcRolesFor(t.id)) kurang.push(t.id);
  }
  assert.deepEqual(kurang, [], `template tanpa struktur shot: ${kurang.join(", ")}`);
});

test("yang sengaja tanpa tabel memang template klaim-hasil atau vox pop", () => {
  for (const id of Object.keys(SENGAJA_TANPA_TABEL)) {
    const t = CAMPAIGN_TEMPLATES.find((x) => x.id === id);
    assert.ok(t, `${id} sudah tidak ada di katalog — daftar pengecualian usang`);
    // Ketiga template klaim-hasil juga harus tidak pernah dipilih otomatis.
    if (id !== "t12-vox-pop") {
      assert.ok(TIDAK_OTOMATIS.includes(id), `${id} tanpa tabel TAPI masih boleh dipilih otomatis`);
    }
  }
});

test("empat pattern-interrupt menahan produk di shot pembuka", () => {
  for (const id of ["ads-tembus-dinding", "ads-atap-jebol", "ads-dobrak-pintu", "ads-waktu-berhenti"]) {
    const r = ugcRolesFor(id);
    assert.ok(r?.opening, `${id} tanpa peran pembuka`);
    assert.match(r!.opening!.role, /NOT visible yet/i, `${id}: produk tidak ditahan — interupsinya kehilangan gunanya`);
  }
});

test("keempat pattern-interrupt punya ARAH interupsi yang berbeda", () => {
  const arah = ["ads-tembus-dinding", "ads-atap-jebol", "ads-dobrak-pintu", "ads-waktu-berhenti"]
    .map((id) => ugcRolesFor(id)!.opening!.role);
  assert.equal(new Set(arah).size, 4, "empat template interupsi memakai pembuka yang sama");
});

test("dua ads penjelas justru menampilkan produk sejak awal", () => {
  for (const id of ["kenalin-bisnis", "promo-terbatas"]) {
    const r = ugcRolesFor(id);
    assert.ok(r?.opening, `${id} tanpa peran pembuka`);
    assert.ok(!/NOT visible yet/i.test(r!.opening!.role), `${id}: menahan produk padahal formatnya menjelaskan`);
  }
});

test("setiap tabel punya penutup satu-shot-menerus", () => {
  for (const t of CAMPAIGN_TEMPLATES) {
    if (t.group !== "ads") continue;
    const r = ugcRolesFor(t.id);
    if (!r?.closing) continue;
    assert.match(r.closing.role, /continuous/i, `${t.id}: penutup tidak menerus — aturan #4 dokumen produksi`);
  }
});
