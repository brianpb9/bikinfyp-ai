import { test } from "node:test";
import assert from "node:assert/strict";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { generateScripts, type ProductInput } from "../lib/script-engine";

// JARING UNTUK KELAS BUG, BUKAN UNTUK DUA KEJADIANNYA.
//
// Dua cacat termahal 2026-08-13 punya bentuk yang sama persis, dan keduanya
// baru ketahuan setelah dibayar:
//
//   penutup TVC   beat minta "packshot produk saja", baris identitas minta
//                 "orang yang sama", kunci minta "tepat satu orang".
//                 -> model menggandakan orangnya kiri-kanan botol.
//   hands_only    baris persona minta "memegang", kunci minta
//                 "mengoperasikan" + "menadah". Tiga tugas, dua tangan.
//                 -> model menyediakan telapak ketiga.
//
// Dua-duanya BUKAN larangan yang kurang keras. Dua-duanya permintaan yang
// tidak koheren, dan model menyelesaikan ketidakkoherenan dengan mengarang.
// Memperkuat larangan sudah dicoba tiga kali dengan uang sungguhan dan gagal
// tiga kali.
//
// Tes ini memeriksa SELURUH katalog: tidak boleh ada satu prompt pun yang
// memuat dua perintah yang tidak mungkin benar bersamaan. Ia tidak menilai
// bagus-tidaknya video — ia menahan satu-satunya jenis kesalahan yang sudah
// terbukti berulang, sebelum ada yang membayar untuk menemukannya lagi.

const SEG = [
  { role: "hook", text: "a", start: 0, end: 5, visual_direction: "x" },
  { role: "demo", text: "b", start: 5, end: 11, visual_direction: "y" },
  { role: "cta", text: "c", start: 11, end: 15, visual_direction: "z" },
];

const PRODUK: ProductInput = {
  id: "uji", name: "Mosseru Bright Shower Gel", price_idr: 189000,
  category: "beauty", sourceUrl: null,
};

/** Pasangan yang tidak mungkin benar bersamaan dalam satu prompt shot. */
export const BERTENTANGAN: { a: RegExp; b: RegExp; kenapa: string }[] = [
  {
    a: /Not a single person appears/i,
    b: /EXACTLY ONE person is present/i,
    kenapa: 'shot dilarang punya orang TAPI juga dikunci "tepat satu orang"',
  },
  {
    a: /Not a single person appears/i,
    // Dua bentuk: yang lama (dipakai sampai 2026-08-14, dan itulah yang
    // benar-benar menghasilkan video cacat) dan yang sekarang. Aturan harus
    // menangkap keduanya — kalau tidak, tes sejarahnya berhenti membuktikan
    // apa pun begitu kalimatnya diganti.
    b: /The same person, same face|SAME woman from the earlier shots/i,
    kenapa: 'shot dilarang punya orang TAPI juga disuruh memakai "orang yang sama"',
  },
  {
    a: /Not a single person appears/i,
    b: /no people anywhere in frame[\s\S]*presenter|presenter[\s\S]*Not a single person/i,
    kenapa: "shot tanpa orang tapi tetap menyebut presenter",
  },
  {
    // Tugas tangan harus berjumlah dua. "holding" tanpa pemilik yang ditunjuk
    // adalah tugas ketiga yang diam-diam ditambahkan.
    a: /one hand operates the product, the other receives/i,
    b: /holding the product naturally/i,
    kenapa: "memegang, mengoperasikan, dan menadah = tiga tugas untuk dua tangan",
  },
];

async function rencana(tpl: (typeof CAMPAIGN_TEMPLATES)[number]) {
  const [skrip] = await generateScripts({ tanpaLlm: true,
    product: PRODUK, register: "bunda", qualityTier: "high_quality",
    durationSec: tpl.durationSec, count: 1, hookLevel: tpl.hookLevel,
    ...(tpl.hookFamily ? { hookFamilies: [tpl.hookFamily as never], lockHookFamily: true } : {}),
    templateId: tpl.id,
  });
  return planShots({
    jobId: tpl.id, durationSec: tpl.durationSec,
    segments: skrip.segments.length ? skrip.segments : (SEG as never),
    category: getCreatorCategory("hijaber")!, productName: PRODUK.name, productCategory: "beauty",
    imageRefPath: "/tmp/x.jpg", qualityTier: "high_quality", format: tpl.format,
    hookLevel: tpl.hookLevel, ugcTemplate: tpl.id,
    tvcRoute: tpl.tvcRoute, shotCountOverride: tpl.shotCount, ratio: tpl.ratio,
  });
}

test("tidak ada prompt di SELURUH katalog yang memuat perintah bertentangan", async () => {
  const pelanggaran: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const spec = await rencana(tpl);
    for (const shot of spec.shots) {
      for (const aturan of BERTENTANGAN) {
        if (aturan.a.test(shot.prompt) && aturan.b.test(shot.prompt)) {
          pelanggaran.push(`${tpl.id} shot ${shot.index + 1}: ${aturan.kenapa}`);
        }
      }
    }
  }
  assert.deepEqual(pelanggaran, [], `prompt bertentangan:\n  ${pelanggaran.join("\n  ")}`);
});

// Setiap shot harus menyatakan dengan jelas ADA atau TIDAK ADA orang. Shot yang
// diam soal itu adalah tempat model bebas menebak — dan tebakan model yang
// menghasilkan dua perempuan di shot penutup.
test("setiap shot menyatakan sikap soal kehadiran orang", async () => {
  const bisu: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    if (tpl.format !== "tvc") continue; // TVC: satu-satunya yang punya shot sengaja tanpa orang
    for (const shot of (await rencana(tpl)).shots) {
      // Ketiga bentuk "tanpa orang" kini ditulis POSITIF (reviewer ronde 3):
      // menyebut orang di dalam negasi adalah cara paling efektif memanggilnya
      // ke frame. Yang dijaga tetap sama — tiap shot menyatakan sikapnya.
      const menyatakan =
        /product-only/i.test(shot.prompt) ||
        /EXACTLY ONE person is present/i.test(shot.prompt) ||
        /frame belonging entirely to the product/i.test(shot.prompt) ||
        /frame holds only the product/i.test(shot.prompt) ||
        /SAME woman from the earlier shots/i.test(shot.prompt);
      if (!menyatakan) bisu.push(`${tpl.id} shot ${shot.index + 1}`);
    }
  }
  assert.deepEqual(bisu, [], `shot yang tidak menyatakan kehadiran orang:\n  ${bisu.join("\n  ")}`);
});

// BUKTI BAHWA JARINGNYA MENANGKAP.
//
// Dua tes di atas lulus sejak baris pertama ditulis, dan tes yang lulus sejak
// awal tidak membuktikan apa pun — ia bisa saja tidak memeriksa apa-apa.
// Di sini aturannya diadu dengan prompt yang BENAR-BENAR pernah dikirim dan
// benar-benar menghasilkan video cacat berbayar.
test("aturan pertentangan menangkap prompt yang dulu memang gagal", async () => {
  // Prompt penutup TVC sebelum perbaikan (render 2026-08-13, Rp16.626,
  // menghasilkan dua perempuan berwajah identik mengapit botol).
  const penutupLama =
    "This is the FINAL shot. Beat 6 of 6: the hero shot: the product front-facing and centred " +
    "on a clean surface — the packshot a brand would sign off on. " +
    "EXACTLY ONE person is present in the entire frame from start to finish. " +
    "The same person, same face, same hair and same outfit as the other shots.";

  const kena = BERTENTANGAN.filter((a) => a.a.test(penutupLama) && a.b.test(penutupLama));
  // Prompt lama itu TIDAK memuat "Not a single person" — justru itu masalahnya:
  // beat-nya minta packshot tanpa orang, tapi tidak pernah mengatakannya.
  // Maka yang menangkapnya bukan aturan pertentangan, melainkan tes kedua:
  // shot penutup wajib MENYATAKAN sikap, dan versi lama diam.
  assert.equal(kena.length, 0, "prompt lama memang tidak menyatakan larangan orang — itu inti bugnya");

  // Versi cacat yang lain: sudah menyatakan larangan, tapi kuncinya ikut
  // terpasang. Inilah yang harus ditangkap aturan pertentangan.
  const bertentangan = penutupLama + " Not a single person appears in this shot.";
  const kena2 = BERTENTANGAN.filter((a) => a.a.test(bertentangan) && a.b.test(bertentangan));
  assert.ok(kena2.length >= 2, `harus tertangkap minimal dua aturan, dapat ${kena2.length}`);

  // Prompt hands_only sebelum perbaikan.
  const tanganLama =
    "hands and forearms only, face and body NOT visible. " +
    "Exactly two hands are visible in the entire frame, and both belong to the same single person — " +
    "one hand operates the product, the other receives or steadies it. " +
    "close-up of a young Indonesian hijabi woman's hands, holding the product naturally over a table.";
  const kena3 = BERTENTANGAN.filter((a) => a.a.test(tanganLama) && a.b.test(tanganLama));
  assert.equal(kena3.length, 1, "tiga tugas untuk dua tangan harus tertangkap");
});

// PERTENTANGAN KEEMPAT, ditemukan lewat review kreatif 2026-08-14.
//
// Label produk keluar sebagai huruf setengah terbaca yang BERUBAH-UBAH antar
// shot dalam satu video: "Bright Slow 'ver Gel" di shot 1-2, "Shaw Slow 'w'
// Peer / 30ml / 45 oz" di shot 3 — dan 45 oz untuk botol 30ml itu mustahil.
//
// Sebabnya sama seperti tiga pertentangan sebelumnya. Prompt lama meminta nama
// merek "sharp, steady and perfectly legible" DAN teks kecil di bawahnya
// "out of focus from natural macro shallow depth of field". Keduanya tercetak
// di PERMUKAAN DATAR YANG SAMA, bidang fokus yang sama — depth of field tidak
// bisa menajamkan satu baris dan mengaburkan baris tepat di bawahnya. Yang
// diminta mustahil secara optik, jadi model mengarang sesuatu di antaranya.
//
// QC-10 tidak menangkapnya karena ia memeriksa NAMA MEREK terbaca — dan
// "mosseru" memang terbaca sempurna di semua frame. Yang rusak justru barisan
// di bawahnya, yang tidak pernah diperiksa siapa pun.
test("label: tidak menuntut tajam dan buram sekaligus di bidang yang sama", async () => {
  const pelanggaran: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    for (const shot of (await rencana(tpl)).shots) {
      const mintaTajam = /brand name on the label stays sharp/i.test(shot.prompt);
      const mintaBuram = /out of focus from natural macro shallow depth of field/i.test(shot.prompt);
      if (mintaTajam && mintaBuram) pelanggaran.push(`${tpl.id} shot ${shot.index + 1}`);
    }
  }
  assert.deepEqual(pelanggaran, [], `prompt menuntut tajam+buram di satu bidang:\n  ${pelanggaran.join("\n  ")}`);

  // Dan harus MENYATAKAN apa yang seharusnya terlihat, bukan cuma melarang.
  const contoh = (await rencana(CAMPAIGN_TEMPLATES.find((t) => t.format === "hands_only")!)).shots[0].prompt;
  // Sejak kebijakan jarak 20 Agu (jalan keluar A) aturan TEKSTUR ini berlaku
  // untuk SELURUH teks di label, nama merek termasuk — bukan lagi hanya baris
  // kecil di bawahnya. Render berbayar 20 Agu membuktikan nama merek pun
  // keluar sebagai karangan ("jddpgeer", "SOMSONG") begitu ia ter-resolve.
  assert.match(contoh, /reads? (only )?as fine printed TEXTURE/i, "tidak menyatakan wujud teks label yang benar");
  assert.match(contoh, /no individual letter, word, or number resolved/i, "kebijakan jarak label tidak dinyatakan");
  assert.match(contoh, /Never render invented words/i, "tidak melarang kata karangan di label");
});

test("template interupsi karton menjangkarkan staging yang jujur", async () => {
  const staged = ["ads-tembus-dinding", "ads-atap-jebol"];
  for (const id of staged) {
    const tpl = CAMPAIGN_TEMPLATES.find((t) => t.id === id);
    if (!tpl) continue;
    const pembuka = (await rencana(tpl)).shots[0].prompt;
    assert.match(pembuka, /cardboard|paper panel|foam|confetti|stage/i, `${id}: properti staging hilang`);
    assert.match(pembuka, /printed identity card|printed product or service card/i, `${id}: kartu identitas hilang`);
    assert.doesNotMatch(pembuka, /broken wall|ceiling gives way|debris and dust bursting|undamaged/i);
  }
});

// Setiap shot pembuka wajib menuntut gerakan di detik pertama.
//
// Review kreatif 2026-08-14: hands_only sudah punya "starts ALREADY in motion",
// tapi talking_head dan ads tidak — jadi pembukanya secara harfiah statis
// (presenter memegang produk setinggi dada sambil tersenyum). Di FYP, satu
// detik diam adalah satu detik yang dipakai jempol untuk menggeser.
test("shot pembuka selalu menuntut sesuatu berubah di detik pertama", async () => {
  const diam: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const pembuka = (await rencana(tpl)).shots[0].prompt;
    const bergerak =
      /ALREADY mid-action/i.test(pembuka) ||          // aturan umum
      /starts ALREADY in motion/i.test(pembuka) ||     // hands_only
      /it starts ALREADY in motion/i.test(pembuka) ||  // TVC generik
      /WITHOUT WARNING|KICKED OPEN|gives way|HIGH-ENERGY OPENING/i.test(pembuka) || // pattern-interrupt
      /stillness first/i.test(pembuka);                // rute intimate: diam DISENGAJA
    if (!bergerak) diam.push(`${tpl.id} (${tpl.format})`);
  }
  assert.deepEqual(diam, [], `shot pembuka tanpa tuntutan gerak:\n  ${diam.join("\n  ")}`);
});

// Latar hanya untuk template yang beat-nya belum menentukan tempat.
test("latar tidak ditumpuk pada template yang sudah punya ruangannya sendiri", async () => {
  const tumpuk: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    const p = (await rencana(tpl)).shots[0].prompt;
    const punyaLatarTambahan = /^.*Setting: a /m.test(p);
    const punyaRuangSendiri = /an ordinary quiet room|a calm interior|an empty quiet room|dim room lit only by/i.test(p);
    if (punyaLatarTambahan && punyaRuangSendiri) tumpuk.push(tpl.id);
  }
  assert.deepEqual(tumpuk, [], `dua penentu tempat dalam satu prompt:\n  ${tumpuk.join("\n  ")}`);
});

// PERTENTANGAN KELIMA — penggandaan di shot TENGAH TVC.
//
// Dua TVC dirender ulang dengan semua perbaikan terpasang, lolos pemeriksa
// 3-frame, lalu ditolak pemeriksa rapat: 5 dan 2 wajah utama. Perbaikan
// packshot menutup penggandaan di PENUTUP; penggandaannya pindah ke tengah.
//
// Shot tengah membawa "The same person ... as the other shots" bersama beat
// yang berbahasa perbandingan ("the second test"). Dua-duanya bahasa
// SEBELUM-SESUDAH, dan model menampilkan perbandingan itu DI DALAM satu frame:
// dua perempuan identik berdampingan. Larangan "no second version of the same
// person" sudah ada sejak awal dan tetap kalah — sama seperti empat kasus
// sebelumnya.
//
// Perbaikannya menyatakan bahwa kesinambungannya melintasi WAKTU, bukan di
// dalam frame.
test("shot berorang menyatakan kesinambungan lintas waktu, bukan perbandingan dalam frame", async () => {
  const kurang: string[] = [];
  for (const tpl of CAMPAIGN_TEMPLATES) {
    for (const shot of (await rencana(tpl)).shots) {
      if (!/SAME woman from the earlier shots/i.test(shot.prompt)) continue;
      if (!/only ONCE inside this frame/i.test(shot.prompt) || !/never as a side-by-side comparison/i.test(shot.prompt)) {
        kurang.push(`${tpl.id} shot ${shot.index + 1}`);
      }
    }
  }
  assert.deepEqual(kurang, [], `identitas orang tanpa penegasan lintas-waktu:\n  ${kurang.join("\n  ")}`);
  // Baris lama tidak boleh tersisa di mana pun.
  for (const tpl of CAMPAIGN_TEMPLATES) {
    for (const shot of (await rencana(tpl)).shots) {
      assert.doesNotMatch(shot.prompt, /The same person, same face, same hair and same outfit as the other shots/i,
        `${tpl.id} shot ${shot.index + 1}: masih memakai baris identitas lama yang mengundang perbandingan`);
    }
  }
});
