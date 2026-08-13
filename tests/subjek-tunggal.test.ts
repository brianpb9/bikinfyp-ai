import { test } from "node:test";
import assert from "node:assert/strict";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { getTemplate } from "../lib/templates";
import type { QualityTier } from "../lib/providers/types";
import type { SegmentDraft } from "../lib/script-engine/templates";

// Ditemukan 2026-08-13 dari render sungguhan: shot PENUTUP TVC 30 detik keluar
// dengan DUA perempuan dan EMPAT tangan mengelilingi produk — hal terakhir
// yang dilihat penonton. Tidak ada satu pun yang menahannya: QC-02 stub,
// tidak ada pemeriksaan jumlah orang, dan format TVC tidak punya larangan
// anatomi sama sekali.

const SEG: SegmentDraft[] = [
  { role: "hook", text: "a", start: 0, end: 5, visual_direction: "x" },
  { role: "demo", text: "b", start: 5, end: 22, visual_direction: "y" },
  { role: "cta", text: "c", start: 22, end: 30, visual_direction: "z" },
];

function spec(o: { format: "talking_head" | "hands_only" | "ads" | "tvc"; tvcRoute?: string; noModel?: boolean; shots?: number }) {
  return planShots({
    jobId: "s", durationSec: 30, segments: SEG, category: getCreatorCategory("hijaber")!,
    productName: "Botol", productCategory: "beauty", imageRefPath: "/tmp/x.jpg",
    qualityTier: "high_quality" as QualityTier, format: o.format,
    tvcRoute: o.tvcRoute as never, noModel: o.noModel, shotCountOverride: o.shots ?? 3,
  });
}

// DIREVISI 2026-08-13 setelah render kedua. Versi lama tes ini berbunyi
// "TVC mengunci satu orang di SETIAP shot — termasuk penutup", dan justru
// ITULAH keyakinan yang memproduksi cacatnya: memasang "tepat satu orang" di
// shot yang perannya "produk sendirian di frame" membuat promptnya
// bertentangan sendiri, dan model menyelesaikannya dengan menggandakan orang.
//
// Aturan yang benar: shot yang MENAMPILKAN orang dikunci satu; shot yang
// memang tanpa orang tidak dikunci — ia dilarang punya orang.
test("TVC: shot berorang dikunci satu, shot penutup tanpa orang tidak dikunci", () => {
  const s = spec({ format: "tvc", tvcRoute: "intimate", shots: 6 });
  for (const sh of s.shots.slice(0, -1)) {
    assert.match(sh.prompt, /EXACTLY ONE person/i, `shot ${sh.index}: tanpa kunci subjek tunggal`);
  }
  const penutup = s.shots[s.shots.length - 1].prompt;
  assert.doesNotMatch(penutup, /EXACTLY ONE person/i, "penutup packshot tidak boleh ikut dikunci satu orang");
  assert.match(penutup, /Not a single person/i, "penutup packshot harus melarang orang");
});

test("TVC melarang orang kedua di negative prompt", () => {
  const s = spec({ format: "tvc", tvcRoute: "fabric", shots: 5 });
  assert.match(s.negativePrompt, /no second person/i, "TVC tanpa larangan orang kedua — ini video yang gagal");
  assert.match(s.negativePrompt, /exactly two hands/i, "TVC tanpa larangan tangan berlebih");
});

test("kunci anatomi ditulis POSITIF, bukan cuma sebagai larangan", () => {
  // Dokumen produksi Brian: klip yang sama dibuat TIGA KALI, dan yang
  // menyelesaikan tangan hantu adalah pernyataan positif, bukan larangan.
  assert.match(spec({ format: "tvc", tvcRoute: "intimate" }).shots[0].prompt,
    /exactly two hands, both clearly visible and naturally attached/i);
});

test("format ads ikut terkunci", () => {
  const s = spec({ format: "ads" });
  assert.match(s.shots[0].prompt, /EXACTLY ONE person/i);
  assert.match(s.negativePrompt, /no second person/i);
});

test("talking_head ikut terkunci", () => {
  const s = spec({ format: "talking_head" });
  assert.match(s.shots[0].prompt, /EXACTLY ONE person/i);
  assert.match(s.negativePrompt, /no second person/i);
});

// Rute komedi SENGAJA memakai dua tokoh (tersangka + penuduh). Memaksakan
// satu orang di sana membatalkan leluconnya.
test("rute TVC komedi TIDAK dikunci satu orang", () => {
  const s = spec({ format: "tvc", tvcRoute: "comedy", shots: 6 });
  assert.ok(!/EXACTLY ONE person/i.test(s.shots[0].prompt), "rute komedi ikut terkunci — leluconnya butuh dua orang");
  assert.ok(!/no second person/i.test(s.negativePrompt), "rute komedi dilarang punya orang kedua");
});

test("hands_only tidak dikunci subjek — memang tanpa wajah", () => {
  const s = spec({ format: "hands_only" });
  assert.ok(!/EXACTLY ONE person/i.test(s.shots[0].prompt));
  assert.match(s.negativePrompt, /no face/i, "hands_only kehilangan larangan wajahnya");
});

test("TVC tanpa model tidak dikunci subjek — tidak ada orang sama sekali", () => {
  const s = spec({ format: "tvc", tvcRoute: "luxury", noModel: true });
  assert.ok(!/EXACTLY ONE person/i.test(s.shots[0].prompt));
});

// --- QC-11: pemeriksa jumlah orang memakai aturan yang SAMA dengan prompt ---
//
// Kunci subjek di prompt dan pemeriksa di QC adalah dua sisi dari satu aturan.
// Kalau angkanya ditulis dua kali, cepat atau lambat keduanya berbeda — dan
// pemeriksa yang salah lebih berbahaya daripada tidak ada pemeriksa, karena ia
// menolak video yang sebenarnya benar. Tes ini menegakkan bahwa spec membawa
// angka yang sama dengan yang diperintahkan ke model.

test("spec membawa maxPeople, dan angkanya cocok dengan kunci subjek di prompt", () => {
  const kasus = [
    { o: { format: "talking_head" as const }, maks: 1 },
    { o: { format: "tvc" as const, tvcRoute: "luxury" }, maks: 1 },
    { o: { format: "tvc" as const, tvcRoute: "comedy" }, maks: 2 },
    { o: { format: "tvc" as const, tvcRoute: "luxury", noModel: true }, maks: 0 },
    { o: { format: "hands_only" as const }, maks: 0 },
  ];
  for (const k of kasus) {
    const s = spec(k.o);
    assert.equal(s.maxPeople, k.maks, `${JSON.stringify(k.o)} harus maksimal ${k.maks} orang`);
    // Kunci "tepat satu orang" HANYA boleh muncul ketika batasnya memang 1.
    // Diperiksa pada shot PEMBUKA: shot penutup TVC sengaja tanpa orang, jadi
    // ia memang tidak membawa kunci itu (lihat tes penutup di bawah).
    const adaKunci = s.shots[0].prompt.includes("EXACTLY ONE person");
    assert.equal(adaKunci, k.maks === 1, `kunci subjek tunggal harus ${k.maks === 1 ? "ada" : "tidak ada"} untuk ${JSON.stringify(k.o)}`);
  }
});

// Shot penutup TVC: packshot PRODUK SAJA, dan promptnya harus KONSISTEN.
//
// Dua render berbayar menghasilkan cacat yang sama persis di detik yang sama:
// dua perempuan (wajah yang sama, digandakan) mengapit botol di shot penutup.
// Render kedua sudah membawa kunci subjek tunggal positif DAN negatifnya
// lengkap. Jadi ini bukan soal larangan yang kurang keras.
//
// Sebabnya prompt yang saling bertentangan: beat penutup meminta "packshot
// produk", baris identitas meminta "orang yang sama seperti shot lain", dan
// kunci subjek meminta "tepat satu orang". Model menyelesaikan kontradiksi
// dengan komposisi simetris — orangnya digandakan kiri-kanan botol.
//
// Tes ini menjaga ketiganya tidak pernah lagi muncul bersamaan.
test("penutup TVC: packshot tanpa orang, tanpa perintah yang bertentangan", () => {
  for (const rute of ["luxury", "intimate", "reallife"]) {
    const s = spec({ format: "tvc", tvcRoute: rute, shots: 4 });
    const penutup = s.shots[s.shots.length - 1].prompt;
    assert.ok(penutup.includes("Not a single person"), `${rute}: penutup harus melarang orang`);
    assert.ok(!penutup.includes("EXACTLY ONE person"), `${rute}: kunci "tepat satu orang" tidak boleh ada di shot tanpa orang`);
    assert.ok(!penutup.includes("same person, same face"), `${rute}: baris identitas orang tidak boleh ada di shot tanpa orang`);
    // Shot tengah TETAP menampilkan orang dan TETAP dikunci satu.
    const tengah = s.shots[1].prompt;
    assert.ok(tengah.includes("EXACTLY ONE person"), `${rute}: shot tengah harus tetap dikunci satu orang`);
    assert.ok(!tengah.includes("Not a single person"), `${rute}: shot tengah tidak boleh melarang orang`);
  }
  // Rute "fabric" adalah pengecualian yang disengaja: penutupnya justru HARUS
  // memakai bajunya dan bergerak (packshot mematikan premisnya), jadi di sana
  // orang tetap ada.
  const kain = spec({ format: "tvc", tvcRoute: "fabric", shots: 4 });
  const penutupKain = kain.shots[kain.shots.length - 1].prompt;
  assert.ok(!penutupKain.includes("Not a single person"), "rute kain: penutupnya memang harus ada orangnya");
  assert.ok(penutupKain.includes("EXACTLY ONE person"), "rute kain: penutup berorang tetap dikunci satu");
});

// hands_only: satu-satunya format yang seluruh isinya TANGAN, dan sampai
// 2026-08-13 satu-satunya yang tidak pernah diberi tahu ada berapa tangan yang
// boleh muncul — SINGLE_SUBJECT_LOCK sengaja dilewati di sini karena isinya
// bicara soal orang dan wajah. Dua template hands_only pertama yang dirender
// sama-sama keluar dengan TIGA telapak di beat yang sama.
test("hands_only mengunci tepat dua tangan milik satu orang", () => {
  const s = spec({ format: "hands_only" });
  for (const sh of s.shots) {
    assert.match(sh.prompt, /Exactly two hands are visible/i, `shot ${sh.index}: tanpa kunci jumlah tangan`);
    assert.match(sh.prompt, /No third hand ever enters the frame/i, `shot ${sh.index}: tanpa larangan tangan ketiga`);
  }
  assert.match(s.negativePrompt, /no third hand/i, "negative prompt tanpa larangan tangan ketiga");
  // Wajah tetap dilarang — kunci tangan tidak boleh menggeser larangan wajah.
  assert.match(s.negativePrompt, /no face/i);
});
