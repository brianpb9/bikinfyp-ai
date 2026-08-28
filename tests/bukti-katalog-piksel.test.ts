import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { qcSubjekLokal } from "../lib/media/qc";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { maksOrangPerFrame } from "../lib/media/shot-planner";
import { probeDurationSec, probeVideoSize } from "../lib/media/ffmpeg";

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

// Deteksi YuNet bersifat lokal, read-only, dan setiap qcSubjekLokal membuat
// direktori frame unik sendiri. Menjalankan empat video sekaligus mengisi waktu
// tunggu decode/inferensi tanpa mengurangi video atau frame yang diperiksa.
// Jangan jadikan angka ini cara menyembunyikan timeout: assertion jumlah hasil
// di bawah memastikan seluruh eligible video benar-benar selesai.
const PARALEL_QC_LOKAL = 4;

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
  assert.ok(terbukti.length >= 29, `baseline 29 video eligible menyusut menjadi ${terbukti.length}`);

  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "piksel-"));
  const gagal: string[] = [];
  try {
    const hasil = new Array<{ id: string; gagal: string | null } | undefined>(terbukti.length);
    let berikutnya = 0;
    const pekerja = async () => {
      while (true) {
        const indeks = berikutnya++;
        if (indeks >= terbukti.length) return;
        const tpl = terbukti[indeks];
        // Batas WAJAH, bukan orang: hands_only melarang wajah, format lain
        // menampilkan satu presenter (rute komedi dua). Angkanya diturunkan
        // dari sumber yang sama dengan yang dipakai merender.
        const maksWajah = maksOrangPerFrame({ format: tpl.format, tvcRoute: tpl.tvcRoute });
        const c = await qcSubjekLokal(buku[tpl.id].berkas, maksWajah, workDir);
        hasil[indeks] = {
          id: tpl.id,
          gagal: c.status === "fail" ? `${tpl.id} (${tpl.format}, maks ${maksWajah} wajah): ${c.detail}` : null,
        };
      }
    };
    await Promise.all(Array.from({ length: Math.min(PARALEL_QC_LOKAL, terbukti.length) }, () => pekerja()));
    assert.equal(hasil.filter(Boolean).length, terbukti.length, "seluruh video eligible wajib selesai diperiksa");
    assert.deepEqual(hasil.map((item) => item?.id), terbukti.map((tpl) => tpl.id), "video tidak boleh dilewati/diurutkan ulang");
    gagal.push(...hasil.flatMap((item) => item?.gagal ? [item.gagal] : []));
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

// Kelengkapan, bukan cuma kebersihan.
//
// QC visual memeriksa apa yang ADA di frame; ia tidak pernah tahu apa yang
// HILANG. 2026-08-14 sebuah video kehilangan satu dari dua shot (8,1 dtk dari
// 15) dan tetap dilaporkan "BERSIH", karena tiga frame yang disampelnya memang
// bersih. Durasi adalah cara termurah untuk mengetahui video itu utuh.
test("video bukti berdurasi penuh, tidak kehilangan shot", { timeout: 120_000 }, async (t) => {
  if (!fs.existsSync(BUKU)) return t.skip("buku bukti belum ada");
  const buku: Record<string, Catatan> = JSON.parse(fs.readFileSync(BUKU, "utf8"));
  const pendek: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const c = buku[tpl.id];
    if (!c || c.visiLolos !== true || !fs.existsSync(c.berkas)) continue;
    const d = await probeDurationSec(c.berkas).catch(() => 0);
    // Toleransi 2 dtk: concat bisa meleset sedikit dari target.
    if (d < tpl.durationSec - 2) pendek.push(`${tpl.id}: ${d.toFixed(1)} dtk, seharusnya ${tpl.durationSec}`);
  }
  assert.deepEqual(pendek, [], `bukti yang videonya kependekan — ada shot hilang:\n  ${pendek.join("\n  ")}`);
});

// Semua klip dalam satu video WAJIB berdimensi sama.
//
// concat demuxer dengan `-c copy` menuntut dimensi identik; melanggarnya
// menghasilkan berkas yang terlihat jadi tapi tidak sah. Terjadi 2026-08-14:
// packshot penutup dibangun 720x1280 dari VisualSpec yang di-hardcode,
// sementara lima shot TVC lainnya 1280x720. Ketahuan hanya karena lembar
// kontaknya menolak disusun — bukan oleh QC mana pun.
test("video bukti tidak mencampur dimensi antar shot", { timeout: 120_000 }, async (t) => {
  if (!fs.existsSync(BUKU)) return t.skip("buku bukti belum ada");
  const buku: Record<string, Catatan> = JSON.parse(fs.readFileSync(BUKU, "utf8"));
  const campur: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const c = buku[tpl.id];
    if (!c || c.visiLolos !== true || !fs.existsSync(c.berkas)) continue;
    const dir = path.join(path.dirname(c.berkas), tpl.id);
    if (!fs.existsSync(dir)) continue;
    const ukuran = new Set<string>();
    for (const sub of fs.readdirSync(dir).filter((d) => d.startsWith("s"))) {
      const berkas = fs.readdirSync(path.join(dir, sub)).filter((f) => f.endsWith(".mp4"));
      for (const f of berkas) {
        const d = await probeVideoSize(path.join(dir, sub, f)).catch(() => null);
        if (d) ukuran.add(`${d.width}x${d.height}`);
      }
    }
    if (ukuran.size > 1) campur.push(`${tpl.id}: ${[...ukuran].join(" + ")}`);
  }
  assert.deepEqual(campur, [], `video dengan dimensi campuran antar shot:\n  ${campur.join("\n  ")}`);
});
