// Temuan Creative Director (board review 20 Agu): sinematografi yang ditulis
// penulis DIBUANG sebelum sampai ke kamera.
//
// Penulis menghasilkan framing/angle/camera/action per segmen — dan pada trace
// nyata isinya bagus: "tight macro, slight top-down, static. Botol dropper
// berdiri di dalam kotak pensil kayu terbuka, label membelakangi kamera, satu
// jari mengetuk sisinya." Yang benar-benar dikirim ke model video: "presenter
// memegang produk setinggi dada dengan reaksi hangat".
//
// Akibatnya bukan selera: koreografi datang dari tabel beat tetap, jadi SETIAP
// video format sama mendapat tiga beat identik. Video yang bisa ditukar satu
// sama lain adalah definisi AI-slop, dan ia lahir di perakit prompt — bukan di
// model video. Kita membayar model kelas atas untuk menulis sinematografi itu,
// lalu membuangnya.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-sinema-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-sinema-storage-${process.pid}`;

const { planShots } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");

/** Segmen dengan sinematografi penulis, bentuk persis seperti keluaran LLM. */
const SEGMEN_KAYA = [
  {
    role: "hook", start: 0, end: 5, text: "",
    visual_direction: "meja rias",
    framing: "tight macro", angle: "slight top-down", camera: "static",
    action: "botol dropper berdiri di dalam kotak pensil kayu terbuka, satu jari mengetuk sisinya",
    start_state: "kotak pensil kayu terbuka di meja, label membelakangi kamera",
    product_state: "partial", expression: "not visible",
  },
  {
    role: "demo", start: 5, end: 11, text: "Aku sembunyiin ini dari anak kos sebelah.",
    visual_direction: "lemari",
    framing: "medium", angle: "eye level", camera: "slow push in",
    action: "dia menyelipkan botol ke balik tumpukan handuk lalu menutup pintu lemari",
    start_state: "pintu lemari setengah terbuka", product_state: "partial", expression: "menahan senyum",
  },
  {
    role: "cta", start: 11, end: 15, text: "Kalau mau, keranjang kuning ya.",
    visual_direction: "produk hero",
    framing: "close", angle: "eye level", camera: "static",
    action: "botol ditaruh diam menghadap kamera, label terbaca",
    start_state: "botol sudah di telapak tangan", product_state: "hero", expression: "hangat",
  },
] as never;

function rakit(format: "hands_only" | "talking_head" | "ads", segments = SEGMEN_KAYA) {
  return planShots({
    jobId: "uji-sinema", durationSec: 15, segments,
    category: getCreatorCategory("hijaber")!, productName: "Serum Glow Bening", productCategory: "beauty",
    imageRefPath: "/tmp/x.jpg", qualityTier: "super_hq", format,
  } as never) as { shots: { prompt: string }[] };
}

test("AKSI yang ditulis penulis sampai ke prompt shot", () => {
  for (const format of ["hands_only", "talking_head", "ads"] as const) {
    const p = rakit(format).shots[0].prompt;
    assert.match(
      p, /kotak pensil kayu|pencil case/i,
      `[${format}] aksi penulis hilang — koreografi masih datang dari tabel beat:\n${p.slice(0, 300)}`
    );
  }
});

test("KAMERA & framing penulis ikut, bukan cuma format bawaan", () => {
  const p = rakit("ads").shots[0].prompt;
  // "tight macro" penulis sengaja ditumpulkan untuk produk berlabel sejak
  // kebijakan jarak 20 Agu (lihat test di bawah) — yang diuji di sini adalah
  // bahwa sisa framing penulis tetap sampai, bukan macro-nya.
  assert.match(p, /Shot composition:/i, "blok framing penulis hilang seluruhnya");
  assert.match(p, /slight top-down/i, "angle penulis hilang");
  assert.match(p, /static/i, "gerak kamera penulis hilang");
});

test("dua naskah BERBEDA menghasilkan koreografi berbeda — bukan tiga beat yang sama", () => {
  const a = rakit("ads").shots[0].prompt;
  const segLain = JSON.parse(JSON.stringify(SEGMEN_KAYA));
  segLain[0].action = "tangan menarik tirai, sinar jatuh ke botol di ambang jendela";
  segLain[0].framing = "wide";
  segLain[0].camera = "slow pan";
  const b = rakit("ads", segLain as never).shots[0].prompt;
  assert.notEqual(a, b, "prompt identik untuk naskah berbeda = video yang bisa ditukar satu sama lain");
  assert.match(b, /tirai|curtain/i);
});

test("segmen TANPA sinematografi tetap jalan — jatuh ke beat bawaan", () => {
  const polos = [
    { role: "hook", start: 0, end: 7, text: "", visual_direction: "close-up produk" },
    { role: "cta", start: 7, end: 15, text: "Kalau mau, keranjang kuning ya.", visual_direction: "hero" },
  ] as never;
  const spec = rakit("hands_only", polos);
  assert.ok(spec.shots.length >= 1);
  assert.ok(spec.shots[0].prompt.length > 200, "prompt bawaan harus tetap utuh untuk naskah lama");
});

test("expression 'not visible' dari penulis TIDAK memanggil wajah ke shot pembuka", () => {
  const p = rakit("ads").shots[0].prompt;
  assert.ok(
    !/face and upper body clearly visible/i.test(p),
    `penulis menandai shot 1 tanpa wajah, tapi kamera menimpanya:\n${p.slice(0, 240)}`
  );
});

test("kunci wajib tetap ada — sinematografi menambah, tidak menggusur", () => {
  const p = rakit("ads").shots[0].prompt;
  assert.match(p, /true small size/i, "kunci ukuran asli hilang");
  assert.match(p, /Every spoken word is Indonesian/i, "kunci bahasa hilang");
  assert.match(p, /identical packaging|do not redesign/i, "kunci identitas produk hilang");
});

// Dari render berbayar 20 Agu (test_output/adu_koreografi): aksi penulis yang
// menyuruh kamera menemukan produk BELAKANGAN mengalahkan kunci "botol selalu
// di frame", dan model menurutinya — botol baru muncul detik ~2,5 dari 5 detik.
// Dua aturan berlomba di satu prompt; yang berbentuk koreografi menang.
test("aksi penulis TERIKAT pada kehadiran produk sejak frame pertama", () => {
  const segMenyapu = JSON.parse(JSON.stringify(SEGMEN_KAYA));
  segMenyapu[0].action =
    "camera sweeps left to right across the mess, then pauses on the serum bottle lying on its side";
  const p = rakit("hands_only", segMenyapu as never).shots[0].prompt;
  const iHadir = p.search(/already fully inside the frame from the very first frame/i);
  const iAksi = p.search(/camera sweeps left to right/i);
  assert.ok(iHadir >= 0, `pengikat kehadiran produk hilang:\n${p.slice(0, 400)}`);
  assert.ok(
    iHadir < iAksi,
    "pengikat harus MENDAHULUI aksi — kalau ia datang belakangan ia jadi aturan yang berlomba, persis yang kalah di render 20 Agu"
  );
});

test("kategori jasa TIDAK dipaksa memunculkan benda", async () => {
  const spec = planShots({
    jobId: "uji-jasa", durationSec: 15, segments: SEGMEN_KAYA,
    category: getCreatorCategory("hijaber")!, productName: "Jasa Desain Logo",
    productCategory: "jasa", imageRefPath: "/tmp/x.jpg",
    qualityTier: "super_hq", format: "ads",
  } as never) as { shots: { prompt: string }[] };
  assert.ok(
    !/already fully inside the frame/i.test(spec.shots[0].prompt),
    "jasa tidak punya benda untuk dijaga di frame — memaksanya membuat model mengarang produk"
  );
});

// KEBIJAKAN JARAK LABEL (Brian, 20 Agu — jalan keluar A). Tiga putaran prompt
// gagal membuat model mengeja label dengan benar; render 20 Agu menghasilkan
// "jddpgeer"/"SOMSONG". Huruf yang tidak pernah dirender tidak bisa salah.
test("tidak ada lagi permintaan mustahil 'nama merek terbaca tajam'", () => {
  const p = rakit("hands_only").shots[0].prompt;
  assert.ok(
    !/brand name[^.]*legible|perfectly legible/i.test(p),
    `permintaan yang tiga kali terbukti mustahil masih ada di prompt berbayar:\n${p.slice(0, 300)}`
  );
  assert.match(p, /no individual letter, word, or number resolved/i, "kebijakan jarak label hilang");
});

test("framing 'tight macro' penulis ditumpulkan untuk produk berlabel", () => {
  const p = rakit("hands_only").shots[0].prompt;   // segmen hook menulis "tight macro"
  assert.ok(
    !/tight macro|extreme close/i.test(p),
    `macro penulis lolos — label akan mengisi frame dan hurufnya jadi karangan:\n${p.slice(0, 300)}`
  );
  assert.match(p, /at arm's-length viewing distance/i, "penggantinya tidak terpasang");
});

test("produk jasa TIDAK ditumpulkan — tidak ada label untuk dilindungi", () => {
  const spec = planShots({
    jobId: "uji-jasa-macro", durationSec: 15, segments: SEGMEN_KAYA,
    category: getCreatorCategory("hijaber")!, productName: "Jasa Desain Logo",
    productCategory: "jasa", imageRefPath: "/tmp/x.jpg",
    qualityTier: "super_hq", format: "ads",
  } as never) as { shots: { prompt: string }[] };
  assert.match(spec.shots[0].prompt, /tight macro/i, "framing sinematik penulis hilang tanpa alasan");
});
