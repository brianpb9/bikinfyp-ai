// Audit A2 (19 Agu 2026): BARIS_10 mengklaim penegakan:"kode" untuk 9 dari 12
// baris, sementara yang benar-benar menolak sesuatu jauh lebih sedikit — dan
// prompt penulis bahkan menyebut angka ketiga ("six of those twelve").
// Klaim yang lebih besar dari kenyataan membuat pembaca berikutnya percaya
// gerbang yang tidak ada.
//
// Tes ini adalah SYARAT klaim: tiap baris yang mengaku "kode" WAJIB punya
// pemeriksa yang menolak input pelanggar di sini. Baris yang tidak bisa
// dibuktikan harus dilabeli "prompt" atau "belum" — bukan dibiarkan mengaku.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-standar10-klaim-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-standar10-klaim-storage-${process.pid}`;

const S = await import("../lib/script-engine/standar-10");
const { periksaPromptAkhir } = await import("../lib/media/gerbang-prompt");

/**
 * Bukti penegakan per baris: fungsi yang mengembalikan true bila input
 * PELANGGAR benar-benar ditolak. Kunci = nomor baris.
 */
const BUKTI: Record<number, () => boolean> = {
  // Baris 2 — ide yang bisa dipindah ke produk lain ditolak.
  2: () => !S.ujiTukarProduk({
    one_liner: "Bikin harimu jadi lebih baik", productName: "Serum Glow Bening", productCategory: "beauty",
  }).lolos,
  // Baris 3 — situasi manusia kosong ditolak (via nilaiBarisIde).
  3: () => S.nilaiBarisIde({
    one_liner: "Serum yang dipakai diam-diam tiap malam", why_stop: "penonton ingin tahu kenapa disembunyikan",
    mechanic: "secret", human_situation: "", productName: "Serum Glow Bening", productCategory: "beauty",
    hookLevel: "agak_berani", contentType: "affiliate",
  } as never).gagal.some((g) => g.no === 3),
  // Baris 4 — shot 2 yang jadi katalog spesifikasi ditolak.
  4: () => !S.payoffBukanKatalog({ teksShot2: "Isinya 30ml, niacinamide 10 persen.", mechanic: "secret" }).lolos,
  // Baris 5 — kategori jenuh dengan level hook rendah ditolak.
  5: () => !S.levelHookCukup({ hookLevel: "normal", productCategory: "beauty", productName: "Serum Wajah" } as never).lolos,
  // Baris 6 — klaim terlarang ditolak.
  6: () => S.nilaiBarisIde({
    one_liner: "Serum ini memutihkan dalam semalam", why_stop: "hasil instan bikin penasaran",
    mechanic: "transformation", human_situation: "Ibu muda kurang tidur menatap cermin sebelum kerja",
    productName: "Serum Glow Bening", productCategory: "beauty", hookLevel: "agak_berani", contentType: "affiliate",
  } as never).gagal.some((g) => g.no === 6),
  // Baris 8 — pemicu penyaring ditolak, di ide DAN di prompt akhir (19 Agu).
  8: () => {
    const diIde = S.nilaiBarisIde({
      one_liner: "Dia mengendap ke kamar mandi", why_stop: "penonton ingin tahu", mechanic: "secret",
      human_situation: "Seseorang menyimpan rutinitas malamnya sendiri", productName: "Sabun", productCategory: "beauty",
      hookLevel: "agak_berani", contentType: "affiliate", pemicu: ["shower"],
    } as never).gagal.some((g) => g.no === 8);
    const diPromptAkhir = periksaPromptAkhir({
      shots: [{ index: 0, prompt: "She steps into the shower holding a towel." }],
      negativePrompt: "", namaProduk: "Serum Glow Bening", format: "talking_head", withAudio: true,
    }).some((t) => t.keras && t.aturan === "L-21-KOSAKATA");
    return diIde && diPromptAkhir;
  },
  // Baris 9 — DUA bagian: batas kata per shot (validator S-09) DAN kunci
  // bahasa 4 lapis di prompt akhir (gerbang, 19 Agu). Dulu hanya bagian
  // pertama yang ada, tapi barisnya sudah mengaku "kode".
  9: () => {
    const batasKata = !S.kataPerShot([
      { role: "demo", start: 0, end: 6, text: "satu dua tiga empat lima enam tujuh delapan sembilan sepuluh sebelas dua belas", visual_direction: "x" },
    ] as never).lolos;
    const kunciBahasa = periksaPromptAkhir({
      shots: [{ index: 0, prompt: "A woman speaks to camera. true small size, about the width of a hand, normal conversational distance." }],
      negativePrompt: "", namaProduk: "Serum Glow Bening", format: "talking_head", withAudio: true,
    }).some((t) => t.keras && t.aturan === "BAHASA");
    return batasKata && kunciBahasa;
  },
  // Baris 10 — genre Ads yang menjual transaksi ditolak.
  10: () => S.nilaiBarisIde({
    one_liner: "Checkout sekarang mumpung diskon di keranjang kuning", why_stop: "takut kehabisan",
    mechanic: "stakes", human_situation: "Pemilik warung menghitung stok terakhir malam hari",
    productName: "Jasa Desain", productCategory: "jasa", hookLevel: "agak_berani", contentType: "ads",
  } as never).gagal.some((g) => g.no === 10),
  // Baris 12 — why_stop/mechanic kosong ditolak.
  12: () => S.nilaiBarisIde({
    one_liner: "Serum yang dipakai diam-diam tiap malam", why_stop: "", mechanic: "",
    human_situation: "Ibu muda kurang tidur menatap cermin sebelum kerja",
    productName: "Serum Glow Bening", productCategory: "beauty", hookLevel: "agak_berani", contentType: "affiliate",
  } as never).gagal.some((g) => g.no === 12),
};

for (const baris of S.BARIS_10) {
  if (baris.penegakan !== "kode") continue;
  test(`baris ${baris.no} mengaku "kode" — buktikan ia menolak pelanggar`, () => {
    const bukti = BUKTI[baris.no];
    assert.ok(
      bukti,
      `baris ${baris.no} ("${baris.judul}") mengaku penegakan:"kode" tapi tidak ada bukti penolakan di tes ini. ` +
        `Turunkan labelnya ke "prompt"/"belum", atau tambahkan buktinya.`
    );
    assert.equal(bukti(), true, `baris ${baris.no} ("${baris.judul}") tidak benar-benar menolak input pelanggar`);
  });
}

// Label "render" ditambahkan 20 Agu untuk baris 7 (label merek dijamin packshot
// foto asli di composer, bukan diminta dari penulis). Ia harus menunjuk ke
// penegaknya yang nyata — kalau tidak, ia cuma "prompt" dengan nama yang lebih
// meyakinkan, dan itu persis jenis klaim yang berkas ini ada untuk mencegah.
test('label "render" wajib menyebut penegak nyatanya di kode', async () => {
  const fs = await import("node:fs");
  for (const b of S.BARIS_10) {
    if (b.penegakan !== "render") continue;
    assert.ok(b.catatan && b.catatan.length > 10, `baris ${b.no} berlabel "render" tanpa catatan alasan`);
    const penegak = /appendPackshot/.test(b.catatan!) ? "lib/media/packshot-asli.ts" : null;
    assert.ok(penegak, `baris ${b.no}: catatannya tidak menyebut fungsi penegak yang bisa dicari`);
    const src = fs.readFileSync(penegak!, "utf8");
    assert.match(src, /export async function appendPackshot/, `penegak baris ${b.no} tidak ada di ${penegak}`);
  }
});

test('label "prompt"/"belum" wajib punya catatan alasan — supaya tidak jadi TODO tak bertuan', () => {
  for (const b of S.BARIS_10) {
    if (b.penegakan === "kode") continue;
    assert.ok(b.catatan && b.catatan.length > 10, `baris ${b.no} berlabel "${b.penegakan}" tanpa catatan alasan`);
  }
});

test("prompt penulis tidak boleh mengklaim lebih banyak baris mekanis daripada yang terbukti", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync("lib/script-engine/llm.ts", "utf8");
  const terbukti = S.BARIS_10.filter((b) => b.penegakan === "kode").map((b) => b.no);
  const m = src.match(/(\w+) of those twelve lines are checked MECHANICALLY[^"]*/i);
  if (!m) return; // kalimatnya boleh saja tidak ada
  const ANGKA: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10 };
  const diklaim = ANGKA[m[1].toLowerCase()] ?? Number(m[1]);
  assert.ok(
    Number.isFinite(diklaim) && diklaim <= terbukti.length,
    `prompt mengklaim ${diklaim} baris mekanis, terbukti ${terbukti.length} (${terbukti.join(",")})`
  );
});
