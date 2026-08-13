import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { qcSubjekLokal } from "../lib/media/qc";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { maksOrangPerFrame } from "../lib/media/shot-planner";

// TES YANG BENAR-BENAR MELIHAT PIKSEL — dan tidak memanggil layanan berbayar.
//
// Sepanjang hari ini semua cacat besar ditemukan dengan MENONTON: lima bug
// struktural, nol ditemukan tes. Sebabnya jelas — tes kami memeriksa string
// prompt dan kebijakan, tidak pernah gambar. Selama itu benar, "npm test hijau"
// tidak boleh dibaca sebagai "videonya benar".
//
// Tes ini menutup sebagian jarak itu. Untuk SETIAP template yang tercatat
// terbukti di buku bukti, video jadinya dibuka lagi dan diperiksa detektor
// wajah LOKAL (YuNet, jalan di mesin sendiri, gratis). Yang diuji bukan
// sekadar "berkasnya masih ada", tapi apakah pemeriksa KEDUA yang independen
// masih setuju dengan vonis yang tercatat.
//
// Kenapa dua pemeriksa penting: vonis di buku bukti datang dari model visi
// lewat internet. Kalau suatu saat model itu berubah perilaku, atau ambangnya
// digeser, atau berkas buktinya tertukar, tidak ada yang akan tahu. Detektor
// lokal ini tidak punya kepentingan yang sama dan tidak ikut berubah.
//
// Lambat (33 video, tiap video 3 frame + deteksi), jadi bisa dilewati dengan
// LEWATI_TES_PIKSEL=1 saat sedang iterasi cepat. Yang TIDAK boleh: menjadikan
// pelewatan itu bawaan, karena tes yang tidak pernah jalan sama saja tidak ada.

const BUKU = path.resolve(process.cwd(), "..", "test_output", "bukti-render.json");

interface Catatan {
  berkas: string;
  visiLolos?: boolean | null;
}

test("setiap video katalog yang diklaim terbukti masih lolos pemeriksa kedua", { timeout: 600_000 }, async (t) => {
  if (process.env.LEWATI_TES_PIKSEL) return t.skip("dilewati lewat LEWATI_TES_PIKSEL");
  if (!fs.existsSync(BUKU)) return t.skip("buku bukti belum ada — jalankan scripts/render-katalog.ts");

  const buku: Record<string, Catatan> = JSON.parse(fs.readFileSync(BUKU, "utf8"));
  const terbukti = CAMPAIGN_TEMPLATES.filter((tpl) => buku[tpl.id]?.visiLolos === true && fs.existsSync(buku[tpl.id].berkas));
  if (terbukti.length === 0) return t.skip("belum ada template terbukti");

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "piksel-"));
  const gagal: string[] = [];
  try {
    for (const tpl of terbukti) {
      // Batas WAJAH, bukan orang: hands_only melarang wajah, format lain
      // menampilkan satu presenter (rute komedi dua). Angkanya diturunkan dari
      // sumber yang sama dengan yang dipakai merender.
      const maksWajah = maksOrangPerFrame({ format: tpl.format, tvcRoute: tpl.tvcRoute });
      const c = await qcSubjekLokal(buku[tpl.id].berkas, maksWajah, workDir);
      if (c.status === "fail") gagal.push(`${tpl.id} (${tpl.format}, maks ${maksWajah} wajah): ${c.detail}`);
    }
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }

  assert.deepEqual(
    gagal, [],
    `video yang tercatat terbukti tapi DITOLAK pemeriksa lokal:\n  ${gagal.join("\n  ")}\n` +
      `Salah satu dari dua hal benar: buktinya sudah tidak berlaku, atau salah satu pemeriksa keliru. ` +
      `Dua-duanya harus diselidiki, bukan ditandai lulus.`
  );
});
