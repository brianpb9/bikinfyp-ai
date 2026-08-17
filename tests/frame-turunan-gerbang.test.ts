// Gerbang frame turunan CAST-REF (keputusan Brian 17 Agu).
//
// Dua batas, sifatnya berbeda, dan keduanya gampang bocor kalau tidak dijaga:
//
//   TIER   — hanya super_hq dan Enterprise. Rp650+Rp12 per segmen = 62% margin
//            high_quality; batas ~25% sudah tertulis di MAKS_FRAME_PER_TIER.
//   FORMAT — hanya hands_only. talking_head dikunci satu klip selama Seedance
//            menolak referensi berwajah, jadi tidak ada identitas antar-klip
//            untuk dijaga; vo_broll tidak memanggil model video sama sekali.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-turunan-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-turunan-storage-${process.pid}`;
process.env.DATABASE_URL = "postgresql://x:y@localhost:5432/z";

const { bolehFrameTurunan } = await import("../lib/postgres/worker");
const { kunciCastRef } = await import("../lib/media/cast-ref");

test("super_hq hands_only boleh; high_quality retail tidak", () => {
  assert.equal(bolehFrameTurunan({ format: "hands_only", tier: "super_hq", orgId: null }), true);
  assert.equal(bolehFrameTurunan({ format: "hands_only", tier: "high_quality", orgId: null }), false);
  assert.equal(bolehFrameTurunan({ format: "hands_only", tier: "silent_caption", orgId: null }), false);
});

test("Enterprise boleh di tier apa pun — jalurnya memang dibayar berbeda", () => {
  assert.equal(bolehFrameTurunan({ format: "hands_only", tier: "high_quality", orgId: "org-1" }), true);
});

test("format berwajah dan tanpa-video TIDAK ikut, bahkan di super_hq Enterprise", () => {
  for (const format of ["talking_head", "tvc", "vo_broll", "ads"]) {
    assert.equal(
      bolehFrameTurunan({ format, tier: "super_hq", orgId: "org-1" }),
      false,
      `${format} tidak boleh memakai frame turunan sekarang`
    );
  }
});

test("kunci CAST-REF stabil per identitas, dan avatar custom tidak berbagi paket", () => {
  // Preset sama -> paket sama, itu yang membuat wajahnya konsisten antar video.
  assert.equal(kunciCastRef({ presetId: "hijaber" }), kunciCastRef({ presetId: "hijaber" }));
  assert.notEqual(kunciCastRef({ presetId: "hijaber" }), kunciCastRef({ presetId: "genz" }));
  // Dua deskripsi berbeda adalah dua ORANG berbeda.
  const a = kunciCastRef({ customDesc: "perempuan 25 tahun, rambut panjang" });
  const b = kunciCastRef({ customDesc: "perempuan 40 tahun, rambut pendek" });
  assert.notEqual(a, b);
  assert.equal(a, kunciCastRef({ customDesc: "  perempuan 25 tahun, rambut panjang  " }), "spasi tepi tidak boleh bikin paket baru");
  // Custom menang atas preset: kalau tidak, semua avatar unggahan akan berbagi
  // satu paket presetnya dan wajahnya jadi orang lain.
  assert.equal(kunciCastRef({ presetId: "hijaber", customDesc: "X yang panjang" }).startsWith("custom-"), true);
  // Nama preset aneh tidak boleh keluar dari direktorinya.
  assert.equal(kunciCastRef({ presetId: "../../etc/passwd" }).includes("/"), false);
});
