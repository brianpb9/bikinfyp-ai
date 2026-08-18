// Unit test: prompt hands_only melarang wajah + negative per-format + QC-03.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import { execFileSync } from "node:child_process";

process.env.DB_PATH = `/tmp/racun-test-handsfix-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-handsfix-storage-${process.pid}`;

const { planShots, HANDS_ONLY_NEGATIVE } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");
const { qcProductSimilarity } = await import("../lib/media/qc");

const hijaber = getCreatorCategory("hijaber")!;
const segments = [
  { role: "hook" as const, start: 0, end: 3, text: "Say, masa 85 ribu segini sih", visual_direction: "x" },
  { role: "demo" as const, start: 3, end: 10, text: "nah, ini Serum Glow, teksturnya niat, cuma 85 ribu", visual_direction: "x" },
  { role: "cta" as const, start: 10, end: 15, text: "Cek keranjang kuning ya deh", visual_direction: "x" },
];

function spec(format: "hands_only" | "vo_broll" = "hands_only") {
  return planShots({
    jobId: "t1",
    durationSec: 15,
    segments,
    category: hijaber,
    productName: "Serum Glow",
    productCategory: "beauty",
    productVisualDesc: "botol dropper amber 30ml, label putih tulisan hitam",
    imageRefPath: "/tmp/x.png",
    qualityTier: "silent_caption",
    format,
  });
}

test("hands_only: base prompt mengandung framing larangan wajah eksplisit", () => {
  const s = spec();
  for (const shot of s.shots) {
    assert.ok(shot.prompt.includes("hands and forearms only"), shot.prompt);
    // Maknanya, bukan frasanya: batas dinyatakan sebagai BINGKAI sejak 18 Agu
    // (reviewer A5) karena "face and body NOT visible" adalah negasi tentang
    // orang di prompt positif dan memicu penyaring penyedia.
    assert.ok(/below the collarbone|cropped at the wrists/.test(shot.prompt), shot.prompt);
  }
});

test("hands_only: negative mengecualikan wajah sepenuhnya, tanpa token negasi", () => {
  const s = spec();
  // Field negative sudah berarti "hindari ini"; kata "no" cuma menambah token
  // negasi-tentang-orang yang dibaca penyaring. Yang wajib ada isinya.
  assert.ok(/\bface\b/.test(s.negativePrompt), s.negativePrompt);
  assert.ok(!/\bno face\b/.test(s.negativePrompt), "token negasi tidak boleh kembali");
  assert.ok(s.negativePrompt.includes("head in frame"), s.negativePrompt);
  assert.ok(!/no face distortion/i.test(s.negativePrompt), s.negativePrompt);
    // DIREVISI 2026-08-15. Versi lama menuntut substring "no text" — dan
    // justru itu yang menekan label produk sampai jadi coretan. Bukti
    // berpasangan pada foto Wardah asli: dengan larangan tulisan keluar
    // "NACNADNAAMLNO- HYCOMRLE", tanpa larangan keluar persis aslinya.
    //
    // Yang harus dijaga: larangan OVERLAY tambahan tetap ada, karena tanpa itu
    // model menambah caption dan watermark karangan.
  assert.ok(s.negativePrompt.includes("no added text overlay"), "negative wajib melarang overlay teks tambahan");
});

test("format lain (vo_broll): negative kategori tidak diubah", () => {
  const s = spec("vo_broll");
  assert.equal(s.negativePrompt, hijaber.negativePrompt);
  for (const shot of s.shots) {
    assert.ok(!shot.prompt.includes("face and body NOT visible"), "frasa negasi lama tidak boleh kembali");
  }
});

test("kedua shot membawa instruksi konservasi identitas produk + deskripsi visual user", () => {
  const s = spec();
  assert.ok(s.shots[0].prompt.includes("identical packaging"), s.shots[0].prompt);
  assert.ok(s.shots[1].prompt.includes("the same product as in shot 1"), s.shots[1].prompt);
  assert.ok(s.shots[0].prompt.includes("botol dropper amber 30ml"), "deskripsi visual user harus masuk prompt");
});

// --- QC-03 dengan gambar/video sintetis ---
function makeVideo(color: [number, number, number], out: string) {
  execFileSync("python3", [
    "-c",
    `from PIL import Image; img = Image.new("RGB",(720,1280),(240,235,225));
from PIL import ImageDraw; d = ImageDraw.Draw(img); d.rectangle([216,384,504,896], fill=tuple(${JSON.stringify(color)}));
img.save("${out.replace(".mp4", ".png")}")`,
  ]);
  execFileSync(process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg", [
    "-y", "-v", "error", "-loop", "1", "-i", out.replace(".mp4", ".png"),
    "-t", "2", "-pix_fmt", "yuv420p", out,
  ]);
}

test("QC-03: shot menyimpang total (amber->putih) DITOLAK; shot konsisten LOLOS", async () => {
  const dir = `/tmp/qc03-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  const ref = `${dir}/ref.png`;
  execFileSync("python3", [
    "-c",
    `from PIL import Image; img = Image.new("RGB",(720,1280),(240,235,225));
from PIL import ImageDraw; d = ImageDraw.Draw(img); d.rectangle([216,384,504,896], fill=(140,85,40));
img.save("${ref}")`,
  ]);
  const amber = `${dir}/amber.mp4`;
  const amber2 = `${dir}/amber2.mp4`;
  const putih = `${dir}/putih.mp4`;
  makeVideo([140, 85, 40], amber);
  makeVideo([150, 95, 50], amber2);
  makeVideo([235, 235, 235], putih);

  const konsisten = await qcProductSimilarity([amber, amber2], ref, dir);
  assert.equal(konsisten.status, "pass", konsisten.detail);

  const menyimpang = await qcProductSimilarity([amber, putih], ref, dir);
  assert.equal(menyimpang.status, "fail", menyimpang.detail);
  assert.ok(menyimpang.detail!.includes("hue_khas_min") || menyimpang.detail!.includes("antar_shot_max"));
});

test("QC-09: detektor YuNet jalan dan melaporkan 0 wajah pada gambar polos", async () => {
  const { qcNoFace } = await import("../lib/media/qc");
  const dir = `/tmp/qc09-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  const plain = `${dir}/plain.mp4`;
  makeVideo([140, 85, 40], plain);
  const res = await qcNoFace([plain], dir);
  assert.equal(res.status, "pass", res.detail);
});

function makeHandFrame(out: string, morph: boolean) {
  execFileSync("python3", ["-c", `
from PIL import Image, ImageDraw
im = Image.new("RGB", (480, 640), (240, 235, 225)); d = ImageDraw.Draw(im); skin = (198, 134, 100)
if ${morph ? "True" : "False"}:
  d.ellipse((80, 80, 400, 600), fill=skin)
else:
  d.rectangle((215, 390, 265, 610), fill=skin)
  for x in [130, 170, 210, 250]: d.rounded_rectangle((x, 180, x + 20, 410), radius=10, fill=skin)
im.save(${JSON.stringify(out)})`]);
}

function makeMorphVideo(dir: string, morph: boolean) {
  const normal = `${dir}/hand.png`;
  const bad = `${dir}/morph.png`;
  makeHandFrame(normal, false);
  makeHandFrame(bad, true);
  const list = `${dir}/frames.txt`;
  // Same background means this is deliberately not a hard scene-cut: QC-02
  // should inspect the sudden silhouette change, not skip it as an edit.
  fs.writeFileSync(list, `file '${normal}'\nduration 1\nfile '${morph ? bad : normal}'\nduration 1\nfile '${morph ? bad : normal}'\n`);
  const out = `${dir}/${morph ? "morph" : "stable"}.mp4`;
  execFileSync(process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg", ["-y", "-v", "error", "-f", "concat", "-safe", "0", "-i", list, "-vf", "fps=2", "-pix_fmt", "yuv420p", out]);
  return out;
}

test("QC-02: perubahan siluet tangan ekstrem tanpa cut DITOLAK; siluet stabil LOLOS", async () => {
  const { qcHandMorphing } = await import("../lib/media/qc");
  const dir = `/tmp/qc02-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  const stable = await qcHandMorphing(makeMorphVideo(dir, false), dir);
  assert.equal(stable.status, "pass", stable.detail);
  const malformed = await qcHandMorphing(makeMorphVideo(dir, true), dir);
  assert.equal(malformed.status, "fail", malformed.detail);
  assert.match(malformed.detail ?? "", /anomali siluet/);
});

function makeOcrVideo(dir: string, clipped: boolean) {
  const png = `${dir}/${clipped ? "clipped" : "safe"}.png`;
  const python = [
    "from PIL import Image, ImageDraw, ImageFont",
    'im = Image.new("RGB", (720, 1280), (28, 37, 48))',
    "d = ImageDraw.Draw(im)",
    `font = ImageFont.truetype(${JSON.stringify(`${process.cwd()}/assets/fonts/Poppins-ExtraBold.ttf`)}, 44)`,
    `d.text((${clipped ? -150 : 60}, 1020), "KLIK KERANJANG KUNING", font=font, fill="white")`,
    `im.save(${JSON.stringify(png)})`,
  ].join("\n");
  execFileSync("python3", ["-c", python]);
  const mp4 = `${dir}/${clipped ? "clipped" : "safe"}.mp4`;
  execFileSync(process.env.FFMPEG_PATH ?? "/opt/homebrew/bin/ffmpeg", ["-y", "-v", "error", "-loop", "1", "-i", png, "-t", "2", "-pix_fmt", "yuv420p", mp4]);
  return mp4;
}

test("QC-06: OCR frame nyata meluluskan overlay aman dan menolak baris terpotong", async () => {
  const { qcTextNotClipped } = await import("../lib/media/qc");
  const dir = `/tmp/qc06-${process.pid}`;
  fs.mkdirSync(dir, { recursive: true });
  const expected = [{ text: "Klik Keranjang Kuning", startSec: 0, endSec: 2 }];
  const safe = await qcTextNotClipped(makeOcrVideo(dir, false), dir, expected);
  assert.equal(safe.status, "pass", safe.detail);
  // Kebijakan 2026-08-06: teks KRITIS yang tak terbukti = skip (fail-closed);
  // non-kritis cukup mayoritas (>=60%).
  const partial = await qcTextNotClipped(makeOcrVideo(dir, false), dir, [
    ...expected,
    { text: "Dibuat dengan AI", startSec: 0, endSec: 2, critical: true },
  ]);
  assert.equal(partial.status, "skip", partial.detail);
  assert.match(partial.detail ?? "", /belum membuktikan overlay KRITIS/);
  // Non-kritis yang tak terbukti TIDAK menjatuhkan video selama rasio >= 60%.
  const majority = await qcTextNotClipped(makeOcrVideo(dir, false), dir, [
    ...expected,
    { text: "kartu caption yang tak terbaca ocr", startSec: 0, endSec: 2 },
    { text: "kartu caption lain yang terbaca? tidak", startSec: 0, endSec: 2 },
  ]);
  assert.equal(majority.status, "skip", "2 dari 3 tak terbukti = 33% < 60% -> tetap skip");
  const okRatio = await qcTextNotClipped(makeOcrVideo(dir, false), dir, [
    ...expected,
    ...expected.map((e) => ({ ...e, text: "Klik Keranjang Kuning " })), // duplikat mudah terbaca
  ]);
  assert.equal(okRatio.status, "pass", okRatio.detail);
  const clipped = await qcTextNotClipped(makeOcrVideo(dir, true), dir, expected);
  assert.equal(clipped.status, "fail", clipped.detail);
  assert.match(clipped.detail ?? "", /menyentuh tepi kanvas/);
  // edgeExempt (watermark AIGC, by design 24px dari tepi): line-box yang
  // menyentuh kanvas TIDAK menjatuhkan video (refund palsu job ec925061) —
  // kehadirannya tetap diverifikasi, hanya analisis tepinya yang dikecualikan.
  const exempt = await qcTextNotClipped(makeOcrVideo(dir, true), dir, [
    { ...expected[0], edgeExempt: true },
  ]);
  assert.equal(exempt.status, "pass", exempt.detail);
});

// Dua tes di bawah dulu memaku 15 detik per shot. Alasan yang mereka TULIS
// ("batas BytePlus 2-15 dtk/klip") tetap dihormati — 5 detik jelas di dalam
// rentang itu; yang dipaku cuma satu nilai yang kebetulan memenuhinya.
//
// Sejak 17 Agu format tanpa wajah memakai modul ~5 detik, sesuai naskah
// rujukan produksi (15s->3, 20s->4, 30s->5-6 segmen). Alasannya ada di
// shot-planner: tangga beat punya empat anak tangga berbeda tugas, dan dua
// shot panjang tidak pernah benar-benar memakainya. Biaya tidak berubah —
// provider menagih per DETIK video, bukan per klip.
//
// Yang dijaga sekarang invariannya, bukan angkanya: tiap shot 4-15 detik,
// durasinya BULAT (BytePlus membulatkan naik, jadi pecahan memanjangkan video
// diam-diam), dan totalnya sama persis dengan durasi yang diminta.
test("durasi 30 dtk: modul pendek, durasi bulat, total tetap 30 dtk", () => {
  const segments30 = [
    { role: "hook" as const, start: 0, end: 6, text: "Say, masa 85 ribu segini sih", visual_direction: "x" },
    { role: "demo" as const, start: 6, end: 20, text: "nah, ini Serum Glow, teksturnya niat, cuma 85 ribu", visual_direction: "x" },
    { role: "cta" as const, start: 20, end: 30, text: "Cek keranjang kuning ya deh", visual_direction: "x" },
  ];
  const s = planShots({
    jobId: "t2",
    durationSec: 30,
    segments: segments30,
    category: hijaber,
    productName: "Serum Glow",
    productCategory: "beauty",
    productVisualDesc: null,
    imageRefPath: "/tmp/x.png",
    qualityTier: "silent_caption",
    format: "hands_only",
  });
  assert.equal(s.shots.length, 6);
  for (const shot of s.shots) {
    assert.equal(shot.durationSec, 5);
    assert.ok(Number.isInteger(shot.durationSec), "durasi pecahan dibulatkan naik provider");
    assert.ok(shot.durationSec >= 4 && shot.durationSec <= 15, "batas klip provider");
  }
  assert.equal(s.shots.reduce((a, b) => a + b.durationSec, 0), 30, "total wajib sama dengan yang diminta");
});

// 45 detik adalah kasus yang membuktikan kenapa durasi harus BULAT: 45/6 =
// 7,5 detik, dibulatkan naik provider jadi 8, dan videonya keluar 48 detik.
// Jumlah shot karena itu diturunkan sampai membagi habis — 5 shot @9 detik.
test("durasi 45 dtk: jumlah shot diturunkan agar durasinya membagi habis", () => {
  const segments45 = [
    { role: "hook" as const, start: 0, end: 9, text: "Say, masa 85 ribu segini sih", visual_direction: "x" },
    { role: "demo" as const, start: 9, end: 30, text: "nah, ini Serum Glow, teksturnya niat, cuma 85 ribu", visual_direction: "x" },
    { role: "cta" as const, start: 30, end: 45, text: "Cek keranjang kuning ya deh", visual_direction: "x" },
  ];
  const s = planShots({
    jobId: "t3",
    durationSec: 45,
    segments: segments45,
    category: hijaber,
    productName: "Serum Glow",
    productCategory: "beauty",
    productVisualDesc: null,
    imageRefPath: "/tmp/x.png",
    qualityTier: "silent_caption",
    format: "hands_only",
  });
  assert.equal(s.shots.length, 5);
  for (const shot of s.shots) assert.equal(shot.durationSec, 9);
  assert.equal(s.shots.reduce((a, b) => a + b.durationSec, 0), 45, "45 dtk harus tetap 45 dtk, bukan 48");
  // Shot terakhir harus beda beat dari shot tengah (closing/inviting), bukan
  // cuma pengulangannya.
  // Penutup = shot TERAKHIR, bukan indeks tetap. Dulu keduanya kebetulan sama
  // karena 45 detik selalu 3 shot; sejak modul dipendekkan, indeks 2 adalah
  // beat tengah. Asersi yang memaku indeks akan menuduh perilaku yang benar.
  const terakhir = s.shots[s.shots.length - 1];
  assert.ok(terakhir.prompt.includes("closing"), terakhir.prompt);
  // Shot tengah dulu berbunyi "demonstrating the product in use" — kalimat
  // GENERIK yang tidak pernah menyebut apa yang sebenarnya dilakukan tangan.
  // Itu yang membuat seluruh taksonomi bentuk produk tidak pernah sampai ke
  // model pada format hands_only, dan sabun batang tetap diperagakan seperti
  // barang yang bisa dituang. Sekarang shot tengah membawa aksi bentuknya.
  assert.ok(s.shots[1].prompt.includes("Close-up of hands as she "), s.shots[1].prompt);
  assert.ok(!s.shots[1].prompt.includes("demonstrating the product in use"),
    "beat generik ini adalah cacatnya, bukan perilaku yang harus dijaga");
  assert.notEqual(s.shots[1].prompt, terakhir.prompt);
  // Tangga beat benar-benar berganti tugas — inti kenapa modulnya dipendekkan.
  const tengah = s.shots.slice(1, -1).map((x) => x.prompt);
  assert.equal(new Set(tengah).size, tengah.length, "shot tengah tidak boleh mengulang beat yang sama");
});

test("durasi 45 dtk, tier bersuara: dialog 1 segmen penuh per shot (bukan digabung)", () => {
  const segments45 = [
    { role: "hook" as const, start: 0, end: 9, text: "HOOKTEXT", visual_direction: "x" },
    { role: "demo" as const, start: 9, end: 30, text: "DEMOTEXT", visual_direction: "x" },
    { role: "cta" as const, start: 30, end: 45, text: "CTATEXT", visual_direction: "x" },
  ];
  const s = planShots({
    jobId: "t4",
    durationSec: 45,
    segments: segments45,
    category: hijaber,
    productName: "Serum Glow",
    productCategory: "beauty",
    productVisualDesc: null,
    imageRefPath: "/tmp/x.png",
    qualityTier: "high_quality",
    format: "hands_only",
  });
  // Dulu asersinya memaku indeks (0=hook, 1=demo, 2=cta) — benar saat 45 detik
  // selalu tiga shot. Sejak modul dipendekkan ia lima shot, dan CTA jatuh di
  // shot terakhir, bukan shot ketiga. Yang dijaga sekarang maksud aslinya:
  // satu segmen penuh per shot, TIDAK digabung dan TIDAK diulang.
  const cari = (t: string) => s.shots.filter((sh) => sh.prompt.includes(t));
  for (const t of ["HOOKTEXT", "DEMOTEXT", "CTATEXT"]) {
    assert.equal(cari(t).length, 1, `"${t}" harus muncul di tepat satu shot`);
  }
  // Tidak ada shot yang memuat dua kalimat sekaligus (itu arti "bukan digabung").
  for (const sh of s.shots) {
    const jumlah = ["HOOKTEXT", "DEMOTEXT", "CTATEXT"].filter((t) => sh.prompt.includes(t)).length;
    assert.ok(jumlah <= 1, `satu shot memuat ${jumlah} kalimat — dialog tergabung lagi`);
  }
  // Urutannya tetap naik: hook sebelum demo sebelum cta.
  const idx = (t: string) => s.shots.findIndex((sh) => sh.prompt.includes(t));
  assert.ok(idx("HOOKTEXT") < idx("DEMOTEXT") && idx("DEMOTEXT") < idx("CTATEXT"));
});

// Modul 5 detik memperkenalkan cacat yang tangga lama tidak punya: pada 4+
// shot, "hook / demo / sisanya CTA" memberi kalimat penutup ke DUA shot, jadi
// CTA-nya diucapkan dua kali. Dan menyaring "segmen yang beririsan" saja juga
// salah — segmen demo 9 detik beririsan dengan tiga shot 5 detik sekaligus.
test("tiap kalimat naskah diucapkan TEPAT SEKALI, apa pun jumlah shotnya", () => {
  for (const dur of [15, 20, 30]) {
    const segments = [
      { role: "hook" as const, start: 0, end: dur * 0.25, text: "HOOKLINE", visual_direction: "x" },
      { role: "demo" as const, start: dur * 0.25, end: dur * 0.7, text: "DEMOLINE", visual_direction: "x" },
      { role: "cta" as const, start: dur * 0.7, end: dur, text: "CTALINE", visual_direction: "x" },
    ];
    const s = planShots({
      jobId: `dup-${dur}`, durationSec: dur, segments, category: hijaber,
      productName: "Serum Glow", productCategory: "beauty", productVisualDesc: null,
      imageRefPath: "/tmp/x.png", qualityTier: "high_quality", format: "hands_only",
    });
    for (const baris of ["HOOKLINE", "DEMOLINE", "CTALINE"]) {
      const muncul = s.shots.filter((sh) => sh.prompt.includes(baris)).length;
      assert.equal(muncul, 1, `${dur}s: "${baris}" muncul di ${muncul} shot, seharusnya tepat 1`);
    }
  }
});
