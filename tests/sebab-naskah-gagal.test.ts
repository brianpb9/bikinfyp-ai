// Dua kegagalan naskah yang TINDAKANNYA BERLAWANAN harus bisa dibedakan.
//
// ---------------------------------------------------------------------------
// KENAPA INI PENTING, DIUKUR DARI KEJADIAN NYATA
// ---------------------------------------------------------------------------
// Empat kegagalan produksi 3 Sep 2026 tersimpan di audit_log dengan sebab yang
// sama persis: "penulis LLM gagal setelah percobaan ulang". Kalimat itu benar
// tapi tidak berguna — ia menyamakan:
//
//   (a) penyedia LLM benar-benar jatuh  -> isi saldo / periksa kunci
//   (b) penyedia SEHAT, validator kita yang menolak 3x -> perbaiki aturan/prompt
//
// Menyelidikinya terpaksa mengejar log kontainer, dan jawabannya ternyata (b):
// tiga aturan keras tidak pernah disampaikan ke penulisnya. Audit yang tidak
// menyimpan bedanya membuat operator mencari di tempat yang salah lebih dulu.
//
// Tes ini merah pada kode lama: di sana KEDUA kasus menghasilkan kalimat yang
// sama.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.SCRIPT_LLM = "1";
process.env.ANTHROPIC_API_KEY = "kunci-uji";
process.env.DB_PATH = `/tmp/racun-test-sebab-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-sebab-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";

const { generateScripts } = await import("../lib/script-engine");

const PRODUK = {
  id: "uji-sebab", name: "Serum Glow Bening", category: "beauty",
  description: "Serum wajah 30ml", price_idr: 89000,
} as never;

const aslinya = globalThis.fetch;

async function sebabDari(): Promise<string> {
  const err = (await generateScripts({
    product: PRODUK, register: "netral", qualityTier: "high_quality", durationSec: 15,
  }).then(() => null).catch((e: Error) => e)) as (Error & { sebabTeknis?: string }) | null;
  assert.ok(err, "harus melempar");
  return err!.sebabTeknis ?? "";
}

test("penyedia jatuh -> sebabnya menunjuk PENYEDIA, bukan validator", async () => {
  globalThis.fetch = (async () => {
    throw new Error("fetch failed: ECONNREFUSED api.anthropic.com");
  }) as never;
  try {
    const sebab = await sebabDari();
    assert.match(sebab, /penyedia LLM gagal menjawab/i, `sebab tidak menunjuk penyedia: ${sebab}`);
    assert.match(sebab, /ECONNREFUSED/, `pesan asli penyedia hilang: ${sebab}`);
    assert.doesNotMatch(sebab, /penyedia SEHAT/, `salah menuduh validator: ${sebab}`);
  } finally {
    globalThis.fetch = aslinya;
  }
});

test("validator menolak -> sebabnya menyebut ATURAN yang menolak, dan bahwa penyedia sehat", async () => {
  // Naskah yang SAH menurut skema tapi pasti ditolak validator: hook datar
  // tanpa perangkat retoris sama sekali, tanpa partikel, tanpa jeda lisan.
  const datar = [
    { block: "HOOK", label: "PAIN", start: 0, end: 4, text: "Produk ini memiliki kandungan bahan aktif",
      start_state: "the bottle is already on the table", framing: "medium", angle: "eye level",
      camera: "static", action: "the hand moves toward it", product_state: "hidden",
      expression: "neutral", audio_note: "", why: "setup — names the pain", mode: "SELFIE" },
    { block: "BODY", label: "DEMO", start: 4, end: 10, text: "Kandungan tersebut bekerja pada lapisan kulit",
      start_state: "the bottle is already in the hand", framing: "medium", angle: "eye level",
      camera: "push in", action: "the hand turns the label forward", product_state: "partial",
      expression: "neutral", audio_note: "", why: "tension — shows the fix", mode: "SELLING" },
    { block: "CTA", label: "REVEAL", start: 10, end: 15, text: "Silakan periksa informasi produk tersebut",
      start_state: "the bottle is already raised", framing: "tight", angle: "eye level",
      camera: "static", action: "the hand holds steady, then lowers", product_state: "hero",
      expression: "neutral", audio_note: "", why: "payoff — label readable", mode: "SELLING" },
  ];
  globalThis.fetch = (async () => ({
    ok: true,
    json: async () => ({ content: [{ type: "text", text: JSON.stringify({ segments: datar }) }] }),
  })) as never;
  try {
    const sebab = await sebabDari();
    assert.match(sebab, /ditolak validator/i, `sebab tidak menyebut validator: ${sebab}`);
    assert.match(sebab, /penyedia SEHAT/, `tidak menyatakan penyedia sehat: ${sebab}`);
    // Yang paling berguna: ATURAN MANA. Tanpa ini operator tetap harus
    // mengejar log kontainer, yang justru sedang kita hentikan.
    assert.ok(
      /Aturan yang menolak: .+/.test(sebab) && !/\(tidak tercatat\)/.test(sebab),
      `daftar aturan yang menolak tidak ikut: ${sebab}`,
    );
  } finally {
    globalThis.fetch = aslinya;
  }
});
