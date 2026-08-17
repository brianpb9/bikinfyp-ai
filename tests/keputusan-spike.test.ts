// Keputusan ADR-001 (docs/spike-2026-08-17) dijaga di sini.
//
// Ketiganya diambil dari render BERBAYAR, bukan dari teori — jadi kalau ada
// yang membaliknya nanti, ia harus membalik buktinya dulu, bukan cuma kodenya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baca = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("bawaan mode referensi adalah r2v, i2v hanya cadangan eksplisit", () => {
  const s = baca("lib/providers/stubs/byteplus.ts");
  // i2v merusak nama merek ("SCARLETT" -> "SCARLFTT") DAN memaksa pack shot di
  // detik pertama — yang kedua mustahil diperbaiki lewat prompt.
  assert.match(s, /const useR2v = modelDukungR2v && spec\.preferI2v !== true/,
    "r2v harus jadi bawaan, bukan menunggu foto tambahan");
  assert.ok(!/extras\.length > 0 \|\| spec\.referenceOnlyImages === true/.test(s),
    "syarat lama membuat jalur retail selalu jatuh ke i2v");
  assert.match(baca("lib/providers/types.ts"), /preferI2v\?: boolean/, "cadangan i2v harus eksplisit");
});

test("presenter yang terlihat benar-benar bicara, bukan dibungkam", () => {
  const w = baca("lib/postgres/worker.ts");
  assert.match(w, /const isPresenterLipsync = format === "talking_head" \|\| format === "tvc"/,
    "audio native jadi bawaan untuk format berpresenter");
  const p = baca("lib/media/shot-planner.ts");
  assert.match(p, /const lipSyncPresenter = format === "talking_head" \|\| format === "tvc"/);
  // Larangan itu dulu ada SEMATA karena VO-nya diganti Gemini TTS.
  assert.ok(!/no lip-sync to any specific words/.test(p) || /lipSyncPresenter/.test(p),
    "larangan lip-sync tidak boleh dipasang untuk presenter yang bicara sungguhan");
});

test("gerbang label intake memakai keyakinan OCR, bukan panjang huruf", () => {
  const s = baca("lib/media/label-terbaca.ts");
  // Percobaan pertama memakai panjang >=4 dan LOLOS pada foto AI-slop:
  // tesseract membaca "Sdadpgeer" dan "NNSONGO" sebagai kata.
  assert.match(s, /const MIN_CONF = 60/, "ambang keyakinan diturunkan dari sebaran terukur");
  assert.match(s, /"tsv"/, "butuh TSV untuk mendapat kolom keyakinan");
  assert.match(s, /Sdadpgeer/, "kenapa panjang huruf tidak cukup harus tertulis di kode");
  // Gerbangnya dipasang SEBELUM foto disimpan.
  const r = baca("app/api/products/[id]/photos/route.ts");
  assert.match(r, /periksaLabelFoto\(tmpFile, owned\.product\.name\)/);
  const iGerbang = r.indexOf("periksaLabelFoto");
  const iSimpan = r.indexOf("saveProductImages(id, blobs");
  assert.ok(iGerbang > 0 && iGerbang < iSimpan, "gerbang harus mendahului penyimpanan");
});

test("ketidakcocokan nama adalah peringatan, bukan penolakan", () => {
  const s = baca("lib/media/label-terbaca.ts");
  // Menolak karena nama tak cocok akan menghukum penamaan yang wajar
  // (pengguna sering menulis nama lebih pendek daripada yang tercetak).
  assert.match(s, /cocokNama/, "ketidakcocokan dilaporkan");
  const blokir = s.slice(s.indexOf("if (kata.length < MIN_KATA)"), s.indexOf("const tokens"));
  assert.ok(!/cocokNama/.test(blokir.replace(/cocokNama: false/, "")),
    "hanya keterbacaan yang memblokir, bukan kecocokan nama");
});

test("ADR mencatat BUKTI, bukan kesimpulan", () => {
  const adr = baca("docs/spike-2026-08-17/ADR-001-referensi-audio-identitas.md");
  // Tes ini dulu menuntut kata "belum terbukti" — benar saat spike C belum
  // pernah jalan. Sekarang C SUDAH dijalankan dan jawabannya tegas, jadi yang
  // dijaga bergeser: responsnya harus dikutip apa adanya supaya siapa pun bisa
  // membantahnya dengan uji baru, bukan dengan pendapat.
  assert.match(adr, /may contain real person/, "respons penolakan dikutip persis");
  assert.match(adr, /Request id: 0217869633553829/, "request id bisa ditelusuri");
  assert.match(adr, /429/, "kenapa C sempat tertunda tetap tercatat");
  // Batas yang ditemukan sendiri tidak boleh hilang dari catatan.
  assert.match(adr, /perlu diperiksa sebelum dipakai/, "batas frame turunan harus tertulis");
});

test("referensi berwajah MATI secara bawaan, dengan alasan terukur", () => {
  const cfg = baca("lib/config.ts");
  assert.match(cfg, /seedanceFaceRef: env\("SEEDANCE_FACE_REF", "false"\)/, "bawaannya harus false");
  // Alasannya bukan kehati-hatian, tapi respons API yang tercatat.
  assert.match(cfg, /may contain real person/, "respons penolakan harus tertulis di kode");
  assert.match(cfg, /0217869633553829/, "request id disimpan supaya bisa ditelusuri");
  const adr = baca("docs/spike-2026-08-17/ADR-001-referensi-audio-identitas.md");
  assert.match(adr, /Seedance MENOLAK frame berwajah/);
  assert.match(adr, /Seedance MENERIMA frame tanpa wajah/);
  // Batas yang ditemukan sendiri harus ikut tercatat, bukan cuma keberhasilan.
  assert.match(adr, /dropper jadi pump/, "pergeseran bentuk produk di tahap turunan harus dicatat");
});

test("QC-F1 wajib: frame turunan diperiksa terhadap foto ASLI, bukan turunan sebelumnya", () => {
  const s = baca("lib/media/qc-frame.ts");
  const c = baca("lib/media/cast-ref.ts");
  // Menurunkan produk dari frame turunan membuat pergeseran menumpuk: percobaan
  // kedua akan setia pada botol yang sudah salah di percobaan pertama.
  assert.match(c, /productPhotoPath: input\.productPhotoPath/,
    "foto ASLI dikirim ulang tiap percobaan");
  assert.match(c, /const MAKS_ULANG = 2/, "gulung ulang dibatasi dua");
  // Dua pemeriksa, karena menangkap kegagalan yang berbeda.
  assert.match(s, /gemini-flash-latest/, "vision untuk bentuk/tutup/warna/tata letak");
  assert.match(s, /tesseract/, "OCR untuk huruf mereknya sendiri");
  assert.match(s, /tutup_sama/, "jenis tutup diperiksa — dropper bukan pump");
  // Gagal MEMERIKSA tidak boleh dihitung sebagai gagal kesetiaan.
  assert.match(s, /tidak dapat dijalankan[\s\S]{0,80}diteruskan tanpa penilaian/,
    "pemeriksa yang error tidak boleh membakar biaya gulung-ulang");
  // Ketat OCR mengikuti peran: hanya hero yang wajib.
  assert.match(s, /const wajibOcr = \(input\.productState \?\? "hero"\) === "hero"/);
});
