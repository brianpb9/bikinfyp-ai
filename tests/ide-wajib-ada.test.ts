// PENULIS TIDAK PERNAH MENULIS TANPA IDE TERPILIH.
//
// Direproduksi dari render video penuh 20 Agu. Lognya berbunyi:
//   [idea] "Serum Glow Bright": Idea Stage dilewati — semua gelombang pembuat
//   ide gagal
// dan penulis tetap menulis. Yang keluar: "Eh, ini seru banget sih." /
// "kulit aku langsung keliatan glowing, loh." — naskah tanpa sudut, dan
// videonya sudah terlanjur dibayar Rp35.015.
//
// Doktrinnya sama dengan template yang tidak pernah disajikan: kalau bahan
// bakunya tidak ada, tolak dengan alasan jelas dan boleh dicoba lagi. Sebuah
// tahap yang melaporkan kegagalannya lalu melanjutkan seolah tidak gagal
// bukan tahap — ia hiasan.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-idewajib-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-idewajib-storage-${process.pid}`;
// Kunci LLM kosong: pembuat ide GAGAL, persis kondisi 20 Agu.
process.env.ANTHROPIC_API_KEY = "";
process.env.SCRIPT_LLM = "1";

const { generateScripts, IdeTidakTersedia, TemplateTidakDisajikan } = await import("../lib/script-engine");

const PRODUK = {
  id: "p-uji", name: "Serum Glow Bright", price_idr: 85000,
  category: "beauty", sourceUrl: null,
} as never;

test("lapisan LLM mati -> DITOLAK, tidak pernah mengembalikan naskah", async () => {
  // Invarian yang benar-benar dijaga: dengan lapisan LLM mati, tidak ada
  // naskah yang keluar — entah yang jatuh duluan Idea Stage atau penulisnya.
  // Sebelum 20 Agu, Idea Stage yang mati hanya menulis peringatan lalu
  // membiarkan penulis bekerja tanpa ide sama sekali.
  await assert.rejects(
    () => generateScripts({
      product: PRODUK, register: "bestie", qualityTier: "super_hq",
      durationSec: 15, count: 1, hookLevel: "berani",
      contentType: "affiliate", format: "hands_only",
    } as never),
    (err: unknown) => {
      assert.ok(
        err instanceof IdeTidakTersedia || err instanceof TemplateTidakDisajikan,
        `penolakan harus bertipe jelas, dapat ${(err as Error).name}: ${(err as Error).message}`
      );
      assert.ok((err as { sebabTeknis?: string }).sebabTeknis, "penolakan tanpa sebab teknis untuk operator");
      return true;
    },
    "lapisan LLM mati tapi naskah tetap keluar"
  );
});

test("blok Idea Stage TIDAK lagi punya jalur 'dilewati'", async () => {
  // Penjagaan struktural, karena kondisi 'Idea Stage mati sementara penulis
  // hidup' tidak bisa dipalsukan dari luar tanpa menyuntik jaringan. Yang
  // dijaga: catch-nya melempar, bukan menulis peringatan lalu melanjutkan.
  const fs = await import("node:fs");
  const src = fs.readFileSync("lib/script-engine/index.ts", "utf8");
  // Yang dicari KODE-nya, bukan teksnya: komentar di berkas itu memang
  // mengutip log lama "Idea Stage dilewati" sebagai catatan sejarah.
  assert.ok(
    !/console\.warn\([^)]*Idea Stage dilewati/.test(src),
    "jalur 'Idea Stage dilewati' masih ada — itu jalur yang menghasilkan naskah tanpa sudut 20 Agu"
  );
  assert.match(src, /throw new IdeTidakTersedia/, "kegagalan Idea Stage tidak dilempar");
});

test("pesan penolakannya untuk MANUSIA, bukan jejak galat", async () => {
  const err = new IdeTidakTersedia("semua gelombang pembuat ide gagal");
  assert.match(err.message, /[a-z]{4,}\s+[a-z]{4,}/i, "pesannya harus kalimat, bukan kode");
  assert.ok(!/Error:|stack|undefined/.test(err.message), `pesan bocor jejak teknis: ${err.message}`);
  assert.equal(err.sebabTeknis, "semua gelombang pembuat ide gagal");
});

test("jalur tanpa-LLM (template murni) TIDAK ikut ditolak", async () => {
  // tanpaLlm dipakai fixture dan uji katalog — di sana memang tidak ada Idea
  // Stage untuk digagalkan, dan menolaknya akan mematikan seluruh uji katalog.
  const hasil = await generateScripts({
    product: PRODUK, register: "bestie", qualityTier: "silent_caption",
    durationSec: 15, count: 1, hookLevel: "normal",
    contentType: "affiliate", format: "hands_only", tanpaLlm: true,
  } as never);
  assert.equal(hasil.length, 1);
});
