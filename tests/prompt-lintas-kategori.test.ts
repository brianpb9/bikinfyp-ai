// Prompt video harus NETRAL KATEGORI — dan itu dijaga, bukan diharapkan.
//
// ─────────────────────────────────────────────────────────────────────────────
// PERTANYAAN BRIAN, 4 SEP 2026
// ─────────────────────────────────────────────────────────────────────────────
//   "prompting ini di hardcode untuk kategori skincare? sehingga konten niche
//    lain menjadi berantakan... saya ingin perbaikan prompting yang lebih
//    general untuk semua kategori juga di apply di semua model."
//
// Dugaannya benar. Prompt job be16d8f3 — produknya speaker party 18 inci —
// memuat "one cap, one dropper", "the ENTIRE bottle", "invented ingredient
// names", "invented volume figures", dan "about the width of a hand". Semuanya
// benar untuk botol serum, produk pertama yang ditangani repo ini, dan ikut
// terkirim untuk semua produk sesudahnya.
//
// Memperbaiki lima kalimat yang KEBETULAN terlihat di satu prompt bukan jawaban
// untuk "sudah general?". Tes ini yang menjawabnya: ia merender prompt untuk
// produk dari kategori yang berjauhan, lalu menolak kosakata milik kategori
// lain — sekarang, dan setiap kali ada yang menambah kalimat baru.

import { test } from "node:test";
import assert from "node:assert/strict";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { registeredVideoProviders } from "../lib/providers/registry";

/** Kosakata yang hanya benar untuk satu jenis benda. */
const KOSAKATA_TERLARANG: { pola: RegExp; milik: string }[] = [
  { pola: /\bbottles?\b/i, milik: "botol (skincare)" },
  { pola: /\bdropper\b/i, milik: "botol (skincare)" },
  { pola: /\bone cap\b/i, milik: "botol (skincare)" },
  { pola: /\bskincare\b/i, milik: "skincare" },
  { pola: /\bingredient names?\b/i, milik: "skincare" },
  { pola: /\bvolume figures?\b/i, milik: "skincare" },
  { pola: /\btrue small size\b/i, milik: "produk kecil" },
  { pola: /\bwidth of a hand\b/i, milik: "produk kecil" },
];

const PRODUK = [
  { name: "ADVANCE Portable K1812-C Speaker Profesional Party 18inch", category: "gadget", desc: "speaker party besar beroda" },
  { name: "Meja Kerja Kayu Minimalis", category: "home", desc: "meja kerja kayu 120cm" },
  { name: "Keripik Singkong Pedas Daun Jeruk", category: "food", desc: "kemasan pouch 250 gram" },
  { name: "Sepatu Lari Pria Ringan", category: "fashion", desc: "sepatu lari putih" },
  { name: "Serum Glow Bening", category: "beauty", desc: "botol serum bening 30ml" },
];

const segmen = [
  { role: "hook" as const, text: "Nah, ini beneran bikin beda banget sih tiap hari" },
  { role: "demo" as const, text: "aku pakai ini terus, hasilnya kerasa banget dan nggak ribet sama sekali" },
  { role: "cta" as const, text: "jadi kalau kamu mau coba juga, cek keranjang kuning ya" },
];

function promptUntuk(p: (typeof PRODUK)[number], format: "talking_head" | "hands_only") {
  return planShots({
    jobId: "uji", durationSec: 15, segments: segmen,
    category: getCreatorCategory("hijaber")!,
    productName: p.name, productCategory: p.category, productVisualDesc: p.desc,
    productPhotoPath: "/tmp/x.png", format, qualityTier: "premium",
  } as never).shots.map((s) => s.prompt);
}

test("prompt tidak membawa kosakata kategori LAIN — lintas 5 kategori, 2 format", () => {
  const pelanggaran: string[] = [];
  for (const p of PRODUK) {
    for (const format of ["talking_head", "hands_only"] as const) {
      for (const [i, prompt] of promptUntuk(p, format).entries()) {
        for (const k of KOSAKATA_TERLARANG) {
          // Produk yang MEMANG botol serum boleh menyebut botol — yang dijaga
          // adalah kosakata yang bocor ke kategori yang bukan miliknya.
          if (p.category === "beauty" && /botol|skincare/.test(k.milik)) continue;
          if (k.pola.test(prompt)) {
            pelanggaran.push(`${p.category}/${format}/shot${i}: "${k.pola.source}" (milik ${k.milik})`);
          }
        }
      }
    }
  }
  assert.deepEqual(pelanggaran, [], `kosakata kategori lain bocor ke prompt:\n${pelanggaran.join("\n")}`);
});

test("nama produk yang panjang tidak diminta DILAFALKAN utuh", () => {
  // Judul marketplace bisa 24 kata penuh kata kunci. Menyuruh model
  // mengucapkannya bukan permintaan yang masuk akal, dan pada job be16d8f3
  // potongannya bahkan terpotong di tengah kata ("...promo Bluetooth Extr").
  const panjang = PRODUK[0];
  for (const prompt of promptUntuk(panjang, "talking_head")) {
    const m = prompt.match(/Enunciate clearly the brand name "([^"]*)"/);
    if (!m) continue;
    assert.ok(m[1].split(/\s+/).length <= 3, `yang dilafalkan masih panjang: "${m[1]}"`);
  }
});

test("SETIAP mesin video memakai susunan teks bersama, bukan miliknya sendiri", async () => {
  // Menjawab pertanyaan "apakah semua model sudah pakai template yang betul?"
  // dengan penjagaan, bukan dengan keadaan yang kebetulan benar hari ini.
  // Mesin baru yang menyusun teksnya sendiri akan membuat tes ini merah.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const dir = path.join(process.cwd(), "lib/providers/stubs");
  const terdaftar = registeredVideoProviders();
  assert.ok(terdaftar.length >= 2, "registry harus punya minimal dua mesin");

  for (const berkas of fs.readdirSync(dir).filter((f) => f.endsWith(".ts"))) {
    const src = fs.readFileSync(path.join(dir, berkas), "utf8");
    // Hanya provider VIDEO yang relevan; yang lain (TTS) tidak menyusun prompt.
    if (!/VideoProvider/.test(src)) continue;
    // Stub yang belum diaktifkan tidak menyusun prompt sama sekali.
    if (/integrasi API belum diaktifkan/.test(src)) continue;
    assert.match(src, /teksPromptShot\(spec, shot\)/,
      `${berkas} menyusun teks promptnya sendiri — perbaikan prompt tidak akan sampai ke mesin ini`);
  }
});
