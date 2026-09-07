// ATURAN DOMAIN STORYBOARD — gerbang persetujuan pra-render (Brian 7 Sep 2026).
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  MAKS_REGEN_PER_SCENE, MAKS_REGEN_TOTAL, dialogUntukScene, sceneDariShots,
  bolehRegenerate, sisaRegenerate, siapDisetujui, sisaTotal, terpakaiTotal,
} from "../lib/storyboard";
import { promptGambar } from "../lib/media/seedream";
import type { SegmentDraft } from "../lib/script-engine/templates";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const seg = (role: SegmentDraft["role"], start: number, end: number, text: string): SegmentDraft =>
  ({ role, start, end, text, visual_direction: "" }) as SegmentDraft;

const shot = (index: number, durationSec: number, extra: Record<string, unknown> = {}) =>
  ({ index, durationSec, prompt: `shot ${index}`, imageRefPath: "/x.jpg", ...extra }) as never;

test("dialog dipilih dari TUMPANG TINDIH TERBESAR, bukan yang mulai duluan", () => {
  // Hook 1 detik menyerempet awal scene; demo mengisi hampir seluruhnya.
  // Memilih "yang mulai lebih dulu" akan salah memilih hook.
  const segments = [seg("hook", 0, 5.5, "Hook pendek"), seg("demo", 5.5, 10, "Kalimat demo")];
  assert.equal(dialogUntukScene(segments, 5, 10), "Kalimat demo");
});

test("scene tanpa tumpang tindih TIDAK meminjam kalimat segmen terdekat", () => {
  // Packshot di ekor video. Menempelkan kalimat ke gambar yang tidak
  // mengucapkannya membuat kartu storyboard berbohong.
  const segments = [seg("hook", 0, 5, "Halo")];
  assert.equal(dialogUntukScene(segments, 10, 15), "");
});

test("packshot tidak pernah diberi dialog walau waktunya tumpang tindih", () => {
  const segments = [seg("cta", 0, 15, "Linknya di keranjang kuning")];
  const scenes = sceneDariShots([shot(0, 5), shot(1, 5, { tanpaOrang: true })], segments);
  assert.equal(scenes[0]!.dialog, "Linknya di keranjang kuning");
  assert.equal(scenes[1]!.dialog, "", "packshot ikut kebagian dialog");
});

test("rentang waktu scene berurutan dari durasi, bukan dari indeks", () => {
  const segments = [seg("hook", 0, 4, "A"), seg("demo", 4, 8, "B"), seg("cta", 8, 12, "C")];
  const scenes = sceneDariShots([shot(0, 4), shot(1, 4), shot(2, 4)], segments);
  assert.deepEqual(scenes.map((s) => s.dialog), ["A", "B", "C"]);
});

test("kuota regenerate berhenti tepat di batas", () => {
  assert.equal(bolehRegenerate({ regenCount: MAKS_REGEN_PER_SCENE - 1 }), true);
  assert.equal(bolehRegenerate({ regenCount: MAKS_REGEN_PER_SCENE }), false);
  assert.equal(sisaRegenerate({ regenCount: MAKS_REGEN_PER_SCENE }), 0);
  assert.equal(sisaRegenerate({ regenCount: 99 }), 0, "sisa tidak boleh negatif");
});

test("pagu TOTAL menahan kuota agar tidak tumbuh bersama jumlah scene", () => {
  // Jumlah scene tidak tetap — diukur dengan menjalankan planShots (7 Sep 2026):
  //   15s hands_only = 3 scene, 30s hands_only = 6 scene.
  //
  // Pagu per-scene SAJA berarti biayanya ikut mengembang: 2x per scene =
  // Rp6.300 untuk 3 scene tapi Rp12.600 untuk 6. Inilah tes yang menangkap
  // rancangan pertama saya, yang cuma punya pagu per-scene dan menghabiskan
  // 87% margin standard di KEDUA durasi.
  const HARGA = 700;
  const terburuk = (n: number) => n * HARGA + Math.min(MAKS_REGEN_TOTAL, n * MAKS_REGEN_PER_SCENE) * HARGA;

  // Margin sesudah kenaikan paket +5% (Brian 7 Sep 2026).
  const MARGIN_STANDARD_15S = 15000 - 6750;
  const MARGIN_STANDARD_30S = 15000 * 2 - 6750 * 2;

  assert.ok(terburuk(3) <= MARGIN_STANDARD_15S * 0.65,
    `15 detik: Rp${terburuk(3)} terlalu besar terhadap margin Rp${MARGIN_STANDARD_15S}`);
  assert.ok(terburuk(6) <= MARGIN_STANDARD_30S * 0.65,
    `30 detik: Rp${terburuk(6)} terlalu besar terhadap margin Rp${MARGIN_STANDARD_30S}`);

  // Dan yang paling penting: biaya kasus terburuk TIDAK naik dua kali lipat
  // saat jumlah scene naik dua kali lipat.
  assert.ok(terburuk(6) < terburuk(3) * 2, "pagu total tidak menahan pertumbuhan");
});

test("pagu total mengunci kartu yang pagu per-scene-nya masih sisa", () => {
  // 4 kartu, tiga di antaranya sudah dipakai sekali; total terpakai 4 = habis.
  const semua = [{ regenCount: 2 }, { regenCount: 2 }, { regenCount: 0 }, { regenCount: 0 }];
  assert.equal(terpakaiTotal(semua), MAKS_REGEN_TOTAL);
  assert.equal(sisaTotal(semua), 0);
  // Kartu keempat belum pernah diganti — pagu per-scene-nya penuh — tapi jatah
  // storyboard sudah habis. Menjanjikan "bisa 2x lagi" di sini adalah bohong.
  assert.equal(bolehRegenerate({ regenCount: 0 }, semua), false);
  assert.equal(sisaRegenerate({ regenCount: 0 }, semua), 0);
});

test("tanpa daftar scene, sisaRegenerate hanya melaporkan pagu per-scene", () => {
  // Pemanggil lama (dan tampilan yang belum tahu konteks storyboard) tetap
  // mendapat jawaban yang benar untuk pertanyaan yang ia ajukan.
  assert.equal(sisaRegenerate({ regenCount: 0 }), MAKS_REGEN_PER_SCENE);
  assert.equal(bolehRegenerate({ regenCount: 0 }), true);
});

test("Generate terkunci selama masih ada kartu tanpa gambar", () => {
  assert.equal(siapDisetujui([{ imageKey: "a" }, { imageKey: null }]), false);
  assert.equal(siapDisetujui([{ imageKey: "a" }, { imageKey: "b" }]), true);
  assert.equal(siapDisetujui([]), false, "storyboard kosong tidak boleh lolos");
});

test("prompt gambar memakai startState, bukan prompt gerak", () => {
  // Prompt shot menggambarkan apa yang TERJADI sepanjang klip. Dipakai apa
  // adanya, gambar diamnya menggambarkan gerakan.
  const p = promptGambar({ prompt: "she lifts the pouch and turns", startState: "the pouch is already in her hand" });
  assert.match(p, /already in her hand/);
  assert.doesNotMatch(p, /lifts the pouch/);
});

test("prompt gambar selalu melarang teks dan watermark di dalam frame", () => {
  const p = promptGambar({ prompt: "anything" });
  assert.match(p, /no watermark/i);
  assert.match(p, /No text/i);
  assert.match(p, /9:16/);
});

test("watermark dipaku mati di sumbernya, bukan lewat parameter", () => {
  // Contoh resmi BytePlus memakai watermark:true. Kalau nilainya bisa dioper
  // pemanggil, satu salin-tempel yang salah menaruh tanda air BytePlus ke
  // dalam video yang dijual.
  // Komentar dibuang dulu: berkas itu MENJELASKAN bahwa contoh resmi BytePlus
  // memakai watermark:true, dan kalimat penjelasan itu jangan sampai terbaca
  // sebagai kode yang menyalakannya.
  const src = readFileSync(join(process.cwd(), "lib/media/seedream.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
  assert.match(src, /const WATERMARK = false/);
  assert.match(src, /watermark: WATERMARK/);
  assert.doesNotMatch(src, /watermark:\s*(true|input\.|opts\.)/);
});

test("id antrean BullMQ tidak memuat titik dua", () => {
  // BullMQ menolak custom id yang memuat ":" dengan "Custom Id cannot contain :".
  // Penolakannya keluar sebagai 500 di route, bukan sebagai galat antrean, jadi
  // sebabnya tidak terlihat dari pesan yang diterima pengguna — persis yang
  // terjadi pada uji produksi pertama fitur ini.
  const src = readFileSync(join(process.cwd(), "lib/storyboard-queue.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
  const ids = [...src.matchAll(/jobId:\s*`([^`]+)`/g)].map((m) => m[1]!);
  assert.ok(ids.length >= 2, "id antrean tidak ditemukan");
  for (const id of ids) {
    // Titik dua di dalam ${...} tidak mungkin ada di sini; yang dicek adalah
    // pemisah yang kita tulis sendiri.
    assert.doesNotMatch(id.replace(/\$\{[^}]*\}/g, "X"), /:/, `id antrean "${id}" memuat titik dua`);
  }
});

test("gerbang job menolak storyboard yang masih dibangun, bukan cuma yang gambarnya kurang", () => {
  // Saat satu kartu sedang diganti, gambar LAMANYA masih tercatat — jadi
  // siapDisetujui() sendirian mengembalikan true dan job akan merender gambar
  // yang justru barusan ditolak pengguna. Terlihat pada uji produksi 7 Sep
  // 2026: status BUILDING dengan siap=true.
  // Komentar dibuang dulu: blok itu MENJELASKAN kenapa siapDisetujui() saja
  // tidak cukup, dan kalimat penjelasan itu memuat namanya — cukup untuk
  // membuat pemeriksaan urutan membaca komentar, bukan kode.
  const src = readFileSync(join(process.cwd(), "app/api/jobs/route.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
  const i = src.indexOf('storyboard_id) {');
  assert.ok(i > 0, "gerbang storyboard hilang dari route job");
  const blok = src.slice(i, i + 1600);
  assert.match(blok, /sb\.status !== "READY"/, "gerbang tidak memeriksa status");
  // Dan urutannya: status diperiksa SEBELUM kelengkapan gambar, karena status
  // itulah yang membedakan "sedang diganti" dari "belum pernah dibuat".
  assert.ok(blok.indexOf('sb.status !== "READY"') < blok.indexOf("siapDisetujui"),
    "status diperiksa setelah kelengkapan gambar");
});

test("tombol Generate di UI ikut terkunci selama storyboard dibangun", () => {
  const src = readFileSync(join(process.cwd(), "app/bikin/storyboard/page.tsx"), "utf8");
  assert.match(src, /disabled=\{sibuk \|\| !data\.siap \|\| masihBerjalan\}/,
    "tombol Generate hanya melihat `siap`");
});

test("acuan produk dikirim ke Seedream, dan DITAHAN untuk scene withholdProduct", () => {
  // Uji produksi 7 Sep 2026: produknya pouch lipat hijau zaitun, kartu
  // storyboard menampilkan TAS BATIK COKELAT. Panggilan Seedream saya cuma
  // mengirim teks, jadi model menggambar produk dari nol. Kartu itu lalu jadi
  // frame pertama render, videonya menjual barang yang tidak pernah dimiliki
  // pengguna, dan QC-03 menjatuhkannya SESUDAH uang ditahan.
  const sr = readFileSync(join(process.cwd(), "lib/media/seedream.ts"), "utf8");
  assert.match(sr, /input\.fotoProduk \? \{ image:/, "acuan produk tidak dikirim ke API");

  const w = readFileSync(join(process.cwd(), "lib/postgres/storyboard-worker.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
  // Scene yang menahan produk TIDAK boleh menerima acuannya — kalau tidak,
  // produk muncul di shot yang seharusnya belum memperlihatkannya.
  assert.match(w, /scene\.withhold_product \? null : fotoProduk/, "withholdProduct tetap menerima acuan");
  // Dan fotonya diambil sekali untuk seluruh storyboard, bukan per scene.
  assert.equal((w.match(/kunciFotoProduk\(/g) ?? []).length, 1, "foto produk diambil berulang");
});

test("REFERENCE AUTHORITY hanya muncul saat ada acuan, dan menolak menyalin komposisinya", () => {
  // Diukur 7 Sep 2026, prompt shot SAMA dan acuan SAMA:
  //   tanpa kalimat ini -> foto produk di atas meja, TANPA TANGAN, walau
  //                        prompt-nya berbunyi "hands and forearms only"
  //   dengan kalimat ini -> tangan memegang produk yang benar, adegan baru
  const dengan = promptGambar({ prompt: "hands holding the product", adaAcuan: true });
  const tanpa = promptGambar({ prompt: "hands holding the product" });

  assert.match(dengan, /REFERENCE AUTHORITY/);
  assert.match(dengan, /Do NOT reproduce the reference photo composition/);
  // Tanpa acuan kalimat itu MENYESATKAN: tidak ada gambar yang dilampirkan.
  assert.doesNotMatch(tanpa, /REFERENCE AUTHORITY/);
  assert.doesNotMatch(tanpa, /attached image/);
});

test("gambar storyboard dipaksa ke kanvas render yang persis, bukan sekadar 'sudah tegak'", () => {
  // acuanTegak() punya toleransi 5% dan melewatkan gambar yang sudah mendekati
  // 9:16. Itu masuk akal saat SEMUA acuan datang dari satu jalur normalisasi.
  // Sejak storyboard tidak lagi: Seedream mengembalikan 800x1424 (0,5618),
  // foto produk dinormalkan ke 720x1280 (0,5625) — keduanya lolos toleransi,
  // provider meniru ukuran acuannya, dan klipnya pulang beda ukuran.
  const RASIO = 9 / 16;
  const beda = (l: number, t: number) => Math.abs(l / t - RASIO) / RASIO;
  assert.ok(beda(800, 1424) < 0.05, "premisnya salah: 800x1424 seharusnya lolos toleransi");
  assert.ok(beda(720, 1280) < 0.05, "premisnya salah: 720x1280 seharusnya lolos toleransi");
  // Dua gambar yang sama-sama "lolos toleransi" tetap berbeda ukuran, dan
  // itulah yang menjatuhkan ffmpeg concat.
  assert.notEqual(800, 720);

  const w = readFileSync(join(process.cwd(), "lib/postgres/worker.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*\/\//.test(b)).join("\n");
  const i = w.indexOf("framePertamaDariStoryboard");
  const blok = w.slice(i, i + 2000);
  assert.match(blok, /\.resize\(spec\.width, spec\.height/, "gambar storyboard tidak dipaksa ke kanvas render");
});
