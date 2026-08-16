// TVC adalah genre terpisah, bukan varian gaya dari konten afiliasi.
//
// Vonis manusia pertama (Brian, 16 Agu 2026) menolak SELURUH TVC di katalog:
// "tvc concept salah semua disapproved, harusnya konsep tvc itu kayak
// commercial jadi ada VO ada template scene berbeda". Akarnya struktural dan
// terbukti dari kode, bukan soal pilihan kata:
//
//   - validator L-03 mewajibkan penutup menyebut "keranjang" TANPA SYARAT,
//     sehingga penutup TVC yang benar menurut playbook produksi ("Koleksi baru
//     dari Rana") pasti ditolak;
//   - L-01/L-04 mewajibkan partikel gaul dan filler lisan;
//   - kelima template TVC menutup dengan "cek keranjang kuning", memimpin
//     dengan harga, dan TIDAK SATU PUN menyebut merek.
//
// Jadi yang ditonton adalah visual sinematik enam beat yang dijalankan naskah
// live selling. Tes ini mengunci pemisahannya supaya tidak pelan-pelan balik.

import { test } from "node:test";
import assert from "node:assert/strict";
import { isTvcTemplate, validateScript, type ScriptToValidate } from "../lib/script-engine/validator";
import { TEMPLATE_COPY, TEMPLATE_COPY_CAPACITY } from "../lib/script-engine/template-copy";
import { stripDeliveryTags } from "../lib/script-engine/delivery-tags";
import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from "../lib/templates";
import { REGISTERS } from "../lib/script-engine/registers";

const ctx = {
  reg: REGISTERS.bestie,
  harga: "85 ribu",
  produk: "Serum Wardah",
  noun: "skincare",
  pain: "kusamnya",
  proof: "teksturnya",
  space: "Meja rias",
  aktivitas: "skincare-an malem",
  identitas: "tim glowing",
};

const idTvc = Object.keys(TEMPLATE_COPY).filter(isTvcTemplate);

// Konvensi awalan "tvc-" itu rapuh kalau cuma kesepakatan lisan. Di sini ia
// diikat ke field `format` katalog, jadi menambah TVC tanpa awalan itu — atau
// memberi awalan itu ke template biasa — gagal di sini, bukan lolos ke penonton.
test("awalan id 'tvc-' selalu sama dengan format tvc di katalog", () => {
  const dariAwalan = CAMPAIGN_TEMPLATES.filter((t: CampaignTemplate) => isTvcTemplate(t.id)).map((t: CampaignTemplate) => t.id).sort();
  const dariFormat = CAMPAIGN_TEMPLATES.filter((t: CampaignTemplate) => t.format === "tvc").map((t: CampaignTemplate) => t.id).sort();
  assert.deepEqual(dariAwalan, dariFormat, "awalan id dan field format tidak sepakat soal template mana yang TVC");
  assert.ok(dariFormat.length > 0, "katalog kehilangan seluruh template TVC");
});

test("setiap varian TVC ditutup dengan menyebut nama produk (playbook D4)", () => {
  for (const id of idTvc) {
    for (let i = 0; i < TEMPLATE_COPY_CAPACITY; i++) {
      const penutup = stripDeliveryTags(TEMPLATE_COPY[id][i](ctx).cta).toLowerCase();
      assert.ok(
        penutup.includes(ctx.produk.toLowerCase()),
        `${id} varian ${i}: penutup tidak menyebut nama produk — "${penutup}"`
      );
    }
  }
});

test("tidak ada naskah TVC yang menyebut keranjang", () => {
  for (const id of idTvc) {
    for (let i = 0; i < TEMPLATE_COPY_CAPACITY; i++) {
      const c = TEMPLATE_COPY[id][i](ctx);
      const semua = `${c.hook} ${c.demo} ${c.cta}`;
      assert.ok(!/keranjang/i.test(semua), `${id} varian ${i} masih memakai bahasa afiliasi ("keranjang")`);
    }
  }
});

// Playbook C5, bukti langsung dari produksi: permintaan "lebih pelan" membuat
// satu baris VO meregang jadi 13,5 detik — tiga kali lipat dari jatahnya. Untuk
// TVC 30 detik yang setiap modulnya cuma 5 detik, satu baris meleset sebesar itu
// merusak seluruh timing.
//
// Larangannya sengaja BERHENTI di sini. Playbook C4 mencatat empat baris
// terdengar seperti empat orang berbeda, tetapi temuan itu tentang PREFIX
// instruksi yang dikirim ke TTS ("tenang dan jujur" vs "tempo naik dan lelah"),
// bukan tentang tag inline seperti [serious]. Melarang tag emosi juga berarti
// mengklaim bukti yang tidak saya punya.
test("naskah TVC tidak memakai tag tempo [slow]/[fast]", () => {
  const terlarang = ["[slow]", "[fast]"];
  for (const id of idTvc) {
    for (let i = 0; i < TEMPLATE_COPY_CAPACITY; i++) {
      const c = TEMPLATE_COPY[id][i](ctx);
      const semua = `${c.hook} ${c.demo} ${c.cta}`;
      for (const tag of terlarang) {
        assert.ok(!semua.includes(tag), `${id} varian ${i} memakai ${tag} — tag tempo terbukti meregangkan baris sampai 3x jatah waktunya`);
      }
    }
  }
});

function skripTvc(segs: { role: string; text: string }[]): ScriptToValidate {
  return {
    hook_family: "H12", register: "bestie", segments: segs,
    productName: ctx.produk, priceIdr: 85_000,
    format: "tvc", qualityTier: "high_quality", durationSec: 30,
  };
}

test("validator TVC: penutup tanpa nama merek ditolak T-01", () => {
  const hasil = validateScript(
    skripTvc([
      { role: "hook", text: "Satu tetes jatuh, dan seluruh ceritanya dimulai dari sana." },
      { role: "demo", text: "Ia menyentuh permukaan, melambat, lalu menemukan bentuknya sendiri dengan tenang." },
      { role: "cta", text: "Dibuat setetes demi setetes, pelan-pelan sekali." },
    ]),
    "strict"
  );
  assert.ok(hasil.errors.some((e) => e.rule === "T-01"), "penutup tanpa merek seharusnya ditolak");
});

test("validator TVC: menyebut keranjang ditolak T-02", () => {
  const hasil = validateScript(
    skripTvc([
      { role: "hook", text: "Satu tetes jatuh, dan seluruh ceritanya dimulai dari sana." },
      { role: "demo", text: "Ia menyentuh permukaan, melambat, lalu menemukan bentuknya sendiri dengan tenang." },
      { role: "cta", text: "Serum Wardah. Cek keranjang kuning ya." },
    ]),
    "strict"
  );
  assert.ok(hasil.errors.some((e) => e.rule === "T-02"), "bahasa afiliasi seharusnya ditolak di TVC");
});

// Playbook D1. Kalimat aslinya ditolak klien dengan kata-kata "ga jelas itu apa".
test("validator TVC: dua negasi ditolak T-03, tapi kalimat berpasangan lolos", () => {
  const cacat = validateScript(
    skripTvc([
      { role: "hook", text: "Hari tidak pernah menunggu kamu siap sama sekali." },
      { role: "demo", text: "Tapi nggak pernah nggak siap, itu yang membedakan semuanya di sini." },
      { role: "cta", text: "Serum Wardah. Selalu siap." },
    ]),
    "strict"
  );
  assert.ok(cacat.errors.some((e) => e.rule === "T-03"), "dua negasi bertumpuk seharusnya ditolak");

  // Kalimat berpasangan adalah retorika yang sah, bukan cacat — dipisahkan koma
  // dan lebih dari satu kata sisipan.
  const sah = validateScript(
    skripTvc([
      { role: "hook", text: "Satu tetes jatuh, dan seluruh ceritanya dimulai dari sana." },
      { role: "demo", text: "Nggak perlu ribet, nggak perlu mahal, cukup satu yang benar saja." },
      { role: "cta", text: "Serum Wardah. Sesederhana itu." },
    ]),
    "strict"
  );
  assert.ok(!sah.errors.some((e) => e.rule === "T-03"), "kalimat berpasangan bukan cacat dua negasi");
});

// Aturan lisan harus tetap keras untuk konten afiliasi — pelonggaran TVC tidak
// boleh bocor ke seluruh katalog.
test("aturan afiliasi L-01/L-03/L-04 tetap keras di luar TVC", () => {
  const hasil = validateScript(
    {
      hook_family: "H12", register: "bestie",
      segments: [
        { role: "hook", text: "Satu tetes jatuh, dan seluruh ceritanya dimulai dari sana." },
        { role: "demo", text: "Ia menyentuh permukaan, melambat, lalu menemukan bentuknya sendiri dengan tenang." },
        { role: "cta", text: "Serum Wardah. Dibuat setetes demi setetes." },
      ],
      productName: ctx.produk, priceIdr: 85_000,
      qualityTier: "high_quality", durationSec: 30,
    },
    "strict"
  );
  for (const rule of ["L-01", "L-03", "L-04"]) {
    assert.ok(hasil.errors.some((e) => e.rule === rule), `${rule} seharusnya masih keras untuk non-TVC`);
  }
});
