// Reviewer ronde 3, temuan #4: klaim "prompt akhir bersih di semua format"
// diukur dengan DETEKTOR YANG SEDANG DIUJI. Itu tautologis — kalau detektornya
// melewatkan sesuatu, pengukurannya ikut melewatkannya. Oracle reviewer
// menemukan negasi-manusia di 231 dari 231 shot yang kami nyatakan bersih.
//
// Jadi tes ini TIDAK memakai periksaPemicu sama sekali. Ia memakai pemeriksa
// sederhana yang ditulis di sini: cari kata negasi, lalu lihat apakah dalam
// tiga kata sesudahnya ada kata yang menyebut manusia. Sengaja lebih kasar
// daripada detektor produksi — pemeriksa independen boleh cerewet; yang tidak
// boleh adalah pemeriksa yang buta pada cacat yang sama dengan yang diperiksa.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-oracle-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-oracle-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { planShots, frasaNegatifBersih } = await import("../lib/media/shot-planner");
const { getCreatorCategory } = await import("../lib/personas");
const { TVC_ROUTES } = await import("../lib/templates");

// ---- ORACLE INDEPENDEN (tidak mengimpor apa pun dari pemicu-filter) ----
const NEGASI_ORACLE = /\b(no|not|never|without|none|nobody|no one|tanpa|tidak|tak|gak|nggak|bukan|jangan)\b/gi;
const MANUSIA_ORACLE = new RegExp(
  "\\b(" +
    "person|people|someone|anyone|resident|residents|woman|women|man|men|face|faces|figure|figures|silhouette|" +
    "speaker|presenter|model|head|heads|hand|hands|arm|arms|limb|limbs|lip|lips|mouth|body|bodies|anatomy|" +
    "orang|penghuni|wajah|kepala|tangan|lengan|bibir|mulut|badan|siluet|she|her|he|him|they|them" +
    ")\\b",
  "i"
);

/** Negasi yang objeknya manusia, dalam jendela tiga kata sesudah negasinya. */
function negasiManusia(teks: string): string[] {
  const temuan: string[] = [];
  for (const m of teks.matchAll(NEGASI_ORACLE)) {
    // trim() DULU: tanpa itu split menghasilkan elemen kosong di depan, satu
    // slot jendela terbuang, dan kata orang di posisi keempat lolos. Itu yang
    // membuat oracle ini sempat melaporkan 0/360 sementara oracle reviewer
    // menemukan "no watermark EXACTLY ONE person" di 23 shot.
    // Jendela berhenti di AKHIR KALIMAT. Negasi mengikat di dalam kalimatnya:
    // "no watermark. EXACTLY ONE person is present" adalah dua kalimat, dan
    // yang dinegasikan watermark — bukan orangnya. Koma TIDAK menghentikan
    // jendela, karena itu masih satu klausa.
    const ekor = teks.slice(m.index! + m[0].length, m.index! + m[0].length + 60).split(/[.;!?]/)[0].trim();
    const jendela = ekor.split(/\s+/).slice(0, 4).join(" ");
    if (MANUSIA_ORACLE.test(jendela)) temuan.push(`${m[0]}${jendela}`);
  }
  return temuan;
}

test("oracle-nya sendiri benar-benar bisa gagal", () => {
  assert.deepEqual(negasiManusia("the corridor is empty and calm"), []);
  assert.ok(negasiManusia("no other residents enter the corridor").length, "oracle harus menangkap negasi klasik");
  assert.ok(negasiManusia("not a single person appears in this shot").length);
  assert.ok(negasiManusia("no face, no hands, no arms").length);
});

const segments = [
  { role: "hook" as const, start: 0, end: 4, text: "Nah, jerawat masih bandel juga sih?", visual_direction: "x" },
  { role: "demo" as const, start: 4, end: 10, text: "aku pakai ini tiap malam deh", visual_direction: "x" },
  { role: "cta" as const, start: 10, end: 15, text: "cek keranjang kuning ya", visual_direction: "x" },
];

const PERSONA = ["hijaber", "genz", "ibu"];

function rencana(opsi: {
  format: string;
  durationSec?: number;
  persona?: string;
  productName?: string;
  noModel?: boolean;
  tvcRoute?: string;
}) {
  return planShots({
    jobId: "t",
    durationSec: opsi.durationSec ?? 15,
    segments,
    category: getCreatorCategory(opsi.persona ?? "hijaber")!,
    productName: opsi.productName ?? "Scarlett Acne Serum",
    productCategory: "beauty",
    productVisualDesc: "botol dropper bening",
    imageRefPath: "/tmp/x.png",
    qualityTier: "high_quality",
    format: opsi.format as never,
    ...(opsi.noModel ? { noModel: true } : {}),
    ...(opsi.tvcRoute ? { tvcRoute: opsi.tvcRoute as never } : {}),
  });
}

test("MATRIKS penuh: tidak satu pun prompt positif memuat negasi tentang manusia", () => {
  const gagal: string[] = [];
  let jumlahShot = 0;
  for (const format of ["hands_only", "talking_head", "vo_broll", "tvc", "ads"]) {
    for (const durasi of [15, 30]) {
      for (const persona of PERSONA) {
        for (const rute of format === "tvc" ? [...TVC_ROUTES] : [undefined]) {
          for (const noModel of format === "tvc" ? [false, true] : [false]) {
            const spec = rencana({ format, durationSec: durasi, persona, tvcRoute: rute, noModel });
            for (const sh of spec.shots) {
              jumlahShot++;
              const t = negasiManusia(sh.prompt);
              if (t.length) gagal.push(`${format}/${durasi}/${persona}/${rute ?? "-"}${noModel ? "/noModel" : ""} shot ${sh.index}: ${t.join(" | ")}`);
            }
          }
        }
      }
    }
  }
  assert.ok(jumlahShot >= 200, `matriksnya harus besar, baru ${jumlahShot} shot`);
  assert.deepEqual(gagal.slice(0, 8), [], `${gagal.length}/${jumlahShot} shot memuat negasi tentang manusia`);
});

test("NEGATIVE prompt: frasa telanjang, dan kondisi yang diinginkan tidak ada di daftar hindari", () => {
  for (const format of ["hands_only", "talking_head", "tvc", "ads"]) {
    const spec = rencana({ format });
    const neg = spec.negativePrompt;
    // "Negative: no face" = hindari ketiadaan wajah. Persis kebalikannya.
    assert.ok(!/\bno\s+\w/i.test(neg), `${format}: masih ada "no X" di negative prompt — ${neg}`);
    assert.ok(!/\bexactly two hands\b/i.test(neg),
      `${format}: "exactly two hands" itu kondisi yang DIINGINKAN, tidak boleh di daftar hindari — ${neg}`);
    assert.ok(neg.length > 20, `${format}: negative prompt jadi kosong — ${neg}`);
  }
  // Maknanya tidak hilang, cuma bentuknya berubah.
  assert.match(rencana({ format: "hands_only" }).negativePrompt, /face/i);
});

test("frasaNegatifBersih: bentuknya yang berubah, bukan daftarnya yang dibuang", () => {
  assert.equal(
    frasaNegatifBersih("no face, no extra hands, exactly two hands, blurry, no face"),
    "face, extra hands, blurry"
  );
  assert.equal(frasaNegatifBersih("watermark, text overlay"), "watermark, text overlay");
});

test("produk yang namanya memuat kata pemicu tetap bisa dirender", async () => {
  const { periksaPemicu } = await import("../lib/media/pemicu-filter");
  for (const nama of ["Bright Shower Gel", "Sabun Mandi Harian"]) {
    const spec = rencana({ format: "hands_only", productName: nama });
    for (const sh of spec.shots) {
      const t = periksaPemicu(sh.prompt, { namaProduk: nama }).filter((x) => x.jenis === "kosakata");
      assert.deepEqual(t, [], `"${nama}" shot ${sh.index}: nama produknya sendiri tidak boleh jadi alasan blokir`);
    }
    // Tanpa konteks nama, kata itu MEMANG terdeteksi — bukti bahwa yang
    // membedakan adalah konteksnya, bukan pelemahan detektornya.
    const tanpaKonteks = rencana({ format: "hands_only", productName: nama }).shots
      .flatMap((sh) => periksaPemicu(sh.prompt));
    assert.ok(tanpaKonteks.length > 0, `${nama}: detektornya tidak boleh jadi buta`);
  }
});
