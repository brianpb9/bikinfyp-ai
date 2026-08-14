import test from "node:test";
import assert from "node:assert/strict";
import { evaluateQcPolicy, QC_POLICY_BY_FORMAT, AMBANG_GERAK_MULUT, type QcCheck } from "../lib/media/qc";
import { shotUntukDetik, posisiSampel } from "../lib/media/qc-vision";

const passing = (): QcCheck[] => [
  { code: "QC-01", name: "lip-sync", status: "skip" },
  ...QC_POLICY_BY_FORMAT.hands_only.requiredPass.map((code) => ({ code, name: code, status: "pass" as const })),
];

test("QC hands_only: hanya N/A terdokumentasi boleh skip", () => {
  assert.equal(evaluateQcPolicy("hands_only", passing()), true);
  // QC-04 wajib pass — skip (apa pun alasannya) menolak output.
  const uncertainAudio = passing().map((c) => c.code === "QC-04" ? { ...c, status: "skip" as const } : c);
  assert.equal(evaluateQcPolicy("hands_only", uncertainAudio), false);
  // QC-06 skip DIIZINKAN sejak 2026-08-07 (mode bersuara tanpa overlay teks) —
  // tapi fail tetap menolak.
  const noOverlay = [...passing(), { code: "QC-06", name: "overlay", status: "skip" as const }];
  assert.equal(evaluateQcPolicy("hands_only", noOverlay), true);
  const clipped = [...passing(), { code: "QC-06", name: "overlay", status: "fail" as const }];
  assert.equal(evaluateQcPolicy("hands_only", clipped), false);
});

test("QC hands_only: check wajib hilang atau format tanpa kebijakan menolak", () => {
  assert.equal(evaluateQcPolicy("hands_only", passing().filter((check) => check.code !== "QC-09")), false);
  // Format yang genuinely tidak terdaftar (bukan talking_head/vo_broll, yang
  // sekarang punya kebijakan sendiri sejak v1 Wajah AI/VO+Foto) wajib ditolak.
  assert.equal(evaluateQcPolicy("some_unlisted_format", passing()), false);
});

test("QC talking_head & vo_broll: masing-masing punya kebijakan sendiri", () => {
  const talkingHeadPassing: QcCheck[] = [
    { code: "QC-01", name: "lip-sync", status: "skip" },
    ...QC_POLICY_BY_FORMAT.talking_head.requiredPass.map((code) => ({ code, name: code, status: "pass" as const })),
  ];
  assert.equal(evaluateQcPolicy("talking_head", talkingHeadPassing), true);
  // QC-09 (larangan wajah) tidak boleh jadi syarat untuk talking_head.
  assert.ok(!(QC_POLICY_BY_FORMAT.talking_head.requiredPass as readonly string[]).includes("QC-09"));

  const voBrollPassing: QcCheck[] = [
    { code: "QC-01", name: "lip-sync", status: "skip" },
    { code: "QC-02", name: "hand-morph", status: "skip" },
    ...QC_POLICY_BY_FORMAT.vo_broll.requiredPass.map((code) => ({ code, name: code, status: "pass" as const })),
  ];
  assert.equal(evaluateQcPolicy("vo_broll", voBrollPassing), true);
});

// QC-11 (2026-08-13). Cacat pemicunya: TVC 30 detik dengan DUA perempuan di
// shot penutup lolos SELURUH QC dan sampai ke output.
//
// Kebijakannya sengaja asimetris dan itu perlu dijaga tes: skip DIIZINKAN
// (model visi bisa mati atau kuncinya belum dipasang — memaksa wajib-lulus
// berarti seluruh produksi berhenti saat layanan pihak ketiga down), tapi fail
// MENOLAK. Pemeriksa yang cuma memberi peringatan tidak menahan apa pun.
test("QC-11 boleh skip di semua format, tapi fail selalu menolak", () => {
  for (const format of Object.keys(QC_POLICY_BY_FORMAT) as (keyof typeof QC_POLICY_BY_FORMAT)[]) {
    const policy = QC_POLICY_BY_FORMAT[format];
    const lulus: QcCheck[] = policy.requiredPass.map((code) => ({ code, name: code, status: "pass" as const }));
    assert.ok(
      (policy.permittedSkip as readonly string[]).includes("QC-11"),
      `${format}: QC-11 harus boleh skip — kalau tidak, matinya model visi menghentikan seluruh produksi`
    );
    assert.equal(evaluateQcPolicy(format, [...lulus, { code: "QC-11", name: "visi", status: "skip" }]), true);
    assert.equal(
      evaluateQcPolicy(format, [...lulus, { code: "QC-11", name: "visi", status: "fail" }]), false,
      `${format}: QC-11 fail WAJIB menolak output`
    );
  }
});

// Pemetaan detik -> shot. Ini yang memungkinkan cacat DIPERBAIKI, bukan cuma
// ditolak: QC menolak di detik 13,8, dan yang digenerate ulang cukup shot yang
// memuat detik itu. Untuk video 6 shot, ini beda antara membayar satu klip dan
// membayar enam.
test("shotUntukDetik menunjuk shot yang benar, dan menolak menebak", () => {
  const durasi = [5, 5, 5]; // 15 detik, 3 shot
  assert.equal(shotUntukDetik(durasi, 0), 0);
  assert.equal(shotUntukDetik(durasi, 4.9), 0);
  assert.equal(shotUntukDetik(durasi, 5), 1, "batas shot: detik 5 milik shot ke-2");
  assert.equal(shotUntukDetik(durasi, 13.8), 2);
  // Di luar durasi TIDAK dipetakan ke shot terakhir. Menebak berarti membayar
  // generate ulang shot yang mungkin baik-baik saja.
  assert.equal(shotUntukDetik(durasi, 15), -1);
  assert.equal(shotUntukDetik(durasi, 99), -1);
  assert.equal(shotUntukDetik(durasi, -1), -1);
  // Durasi shot tidak seragam (TVC 30 dtk, 6 shot @5 dtk vs 5 shot @6 dtk).
  assert.equal(shotUntukDetik([6, 6, 6, 6, 6], 26), 4);
  assert.equal(shotUntukDetik([6, 6, 6, 6, 6], 11.9), 1);
});

// QC-01 berhenti jadi stub (2026-08-14). Sebelumnya SELALU skip dengan alasan
// "verifikasi viseme belum ada", dan itu menyesatkan: di tier bersuara biasa
// VO terpisah SENGAJA menggantikan audio model, jadi mulut yang tidak sinkron
// adalah keputusan desain — bukan pekerjaan tertunda. Lubangnya cuma di satu
// tier, dan sekarang tier itu benar-benar diperiksa.
test("QC-01 fail menolak output di semua format", () => {
  for (const format of Object.keys(QC_POLICY_BY_FORMAT) as (keyof typeof QC_POLICY_BY_FORMAT)[]) {
    const lulus: QcCheck[] = QC_POLICY_BY_FORMAT[format].requiredPass.map((code) => ({ code, name: code, status: "pass" as const }));
    assert.equal(evaluateQcPolicy(format, [...lulus, { code: "QC-01", name: "mulut", status: "skip" }]), true,
      `${format}: QC-01 skip harus diizinkan — N/A di hampir semua mode`);
    assert.equal(evaluateQcPolicy(format, [...lulus, { code: "QC-01", name: "mulut", status: "fail" }]), false,
      `${format}: QC-01 fail WAJIB menolak — presenter membeku adalah cacat yang terlihat`);
  }
  // Ambangnya harus berada di antara dua kasus nyata yang diukur:
  // presenter bicara 0,29-0,32 rata-rata; frame beku tepat 0,0.
  assert.ok(AMBANG_GERAK_MULUT > 0 && AMBANG_GERAK_MULUT < 0.29,
    "ambang harus di atas nol (derau) dan jauh di bawah kasus bicara terukur");
});

// Liputan sampel visi harus konsisten dalam WAKTU, bukan dalam fraksi durasi.
//
// Delapan titik tetap membuat video 30 detik diperiksa tiap 3,75 detik dan
// video 15 detik tiap 1,9 detik — lubangnya dua kali lebih lebar justru di
// video yang paling mahal. Kebalikan dari yang masuk akal.
test("jarak sampel visi konsisten lintas durasi", () => {
  for (const durasi of [15, 30, 45]) {
    const p = posisiSampel(durasi);
    const jarak = (p[1] - p[0]) * durasi;
    assert.ok(jarak <= 3.0, `durasi ${durasi} dtk: jarak sampel ${jarak.toFixed(1)} dtk, terlalu renggang`);
    // Setiap shot terpendek kita 4 detik, jadi jarak di bawah itu menjamin
    // tiap shot kena minimal satu sampel.
    assert.ok(jarak < 4, `durasi ${durasi} dtk: ada shot yang bisa terlewat sepenuhnya`);
    assert.ok(p[0] > 0 && p[p.length - 1] < 1, "sampel tidak boleh di detik 0 atau di ujung akhir");
  }
  // Video sangat pendek tetap diperiksa cukup.
  assert.ok(posisiSampel(8).length >= 6);
});
