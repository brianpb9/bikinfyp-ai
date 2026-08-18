// Reviewer ronde 5: gerbang boleh benar tapi berdiri di tempat yang salah.
//
// assertVisualSpec() dulu hanya dipanggil registry, tepat sebelum request
// video — dan itu SESUDAH frame turunan/CAST-REF, yang memanggil model gambar
// berbayar. Jadi spec yang tidak sah tetap membakar uang sebelum ditolak.
//
// Yang diuji di sini URUTANNYA, dan urutan tidak bisa dibuktikan lewat satu
// pemanggilan fungsi — jadi tes ini membaca sumber worker dan menuntut posisi
// relatifnya. Kasar, tapi tepat sasaran: yang rusak dulu memang posisinya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.DB_PATH = `/tmp/racun-test-urutan-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-urutan-storage-${process.pid}`;
process.env.SCRIPT_LLM = "0";

const { kontradiksiNaskah } = await import("../lib/dashboard/render-cell");

test("assertVisualSpec dipanggil SEBELUM langkah berbayar mana pun", () => {
  for (const berkas of ["lib/postgres/worker.ts", "lib/worker.ts"]) {
    const src = fs.readFileSync(berkas, "utf8");
    const assertIdx = src.indexOf("assertVisualSpec(spec)");
    assert.ok(assertIdx > 0, `${berkas}: tidak memanggil assertVisualSpec sama sekali`);
    const planIdx = src.indexOf("planShots({");
    assert.ok(planIdx > 0 && planIdx < assertIdx, `${berkas}: assert harus sesudah planShots`);
    // Yang dicari PEMANGGILAN-nya, bukan deklarasinya: siapkanFrameTurunan
    // didefinisikan di atas, dan mencocokkan definisinya akan membuat tes ini
    // merah tanpa ada yang salah.
    for (const berbayar of ["siapkanFrameTurunan(spec", "await generateVideoWithFailover("]) {
      const idx = src.indexOf(berbayar);
      if (idx < 0) continue;
      assert.ok(assertIdx < idx, `${berkas}: ${berbayar} dipanggil SEBELUM assertVisualSpec — uang keluar duluan`);
    }
  }
});

test("gerbang prompt juga berdiri sebelum langkah berbayar", () => {
  const src = fs.readFileSync("lib/postgres/worker.ts", "utf8");
  const gerbang = src.indexOf("DIHENTIKAN sebelum provider");
  const turunan = src.indexOf("siapkanFrameTurunan(spec");
  assert.ok(gerbang > 0 && turunan > 0);
  assert.ok(gerbang < turunan, "frame turunan (berbayar) tidak boleh mendahului gerbang prompt");
});

test("permintaan render yang bertentangan dengan naskahnya ditolak", () => {
  // Naskah Ads dirender sebagai talking_head: dulu lolos, dan videonya tidak
  // cocok dengan kalimat yang diucapkan.
  assert.match(
    kontradiksiNaskah({ format: "ads" }, { format: "talking_head", templateId: null }) ?? "",
    /ditulis untuk format "ads"/
  );
  assert.match(
    kontradiksiNaskah({ templateId: "tvc-the-drop" }, { format: "tvc", templateId: "tvc-tersangka" }) ?? "",
    /ditulis dari template/
  );
  // Yang cocok tetap jalan.
  assert.equal(kontradiksiNaskah({ format: "ads", templateId: "ads-meja-kosong" }, { format: "ads", templateId: "ads-meja-kosong" }), null);
  // Naskah lama tanpa snapshot tidak dihalangi.
  assert.equal(kontradiksiNaskah(undefined, { format: "hands_only", templateId: null }), null);
  // Format yang memang baru dipilih di langkah confirm tidak dikunci naskah.
  assert.equal(kontradiksiNaskah({ format: null }, { format: "talking_head", templateId: null }), null);
});
