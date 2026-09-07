// PENGENAL YANG TIDAK BOLEH IKUT DIGANTI SAAT MEREK BERGANTI.
//
// Brian meminta (7 Sep 2026) tidak ada lagi tulisan "BikinFYP" di retail maupun
// brand. Seluruh teks yang dilihat pengguna memang sudah bersih. Yang tersisa
// BUKAN teks merek — ia pengenal yang terikat pada artefak yang sudah
// diterbitkan, dan menggantinya merusak, bukan merapikan.
//
// Tes ini ada supaya penyisiran merek berikutnya tidak "menyelesaikan"
// pekerjaan yang memang sengaja tidak diselesaikan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const baca = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("package_name Android TIDAK diganti — ia terikat sertifikat penandatangan", () => {
  // assetlinks.json memasangkan nama paket dengan sidik jari sertifikat.
  // Mengganti namanya berarti aplikasi BARU di Play Store: pemasangan yang ada
  // tidak bisa memperbaruinya, dan tautan dalam aplikasi berhenti terverifikasi.
  // APK dan AAB yang sudah ditandatangani ada di twa/ — ini bukan kemungkinan
  // teoretis.
  const d = JSON.parse(baca("public/.well-known/assetlinks.json")) as {
    target: { package_name: string; sha256_cert_fingerprints: string[] };
  }[];
  assert.equal(d[0]!.target.package_name, "com.hdrvstudio.bikinfyp", "nama paket Android berubah — pemasangan lama akan putus");
  assert.ok(d[0]!.target.sha256_cert_fingerprints[0]!.length > 40, "sidik jari sertifikat hilang");
});

test("purpose HKDF TIDAK diganti — ia menurunkan kunci, bukan label", () => {
  // Menggantinya menghasilkan kunci berbeda: setiap URL video bertanda tangan
  // jadi 403, OTP berjalan gagal, dan kredensial partner yang tersimpan tidak
  // bisa didekripsi lagi. Rotasi yang benar menaikkan versinya (v1 -> v2)
  // berikut jalur migrasinya.
  const s = baca("lib/secrets.ts");
  for (const p of ["bikinfyp/media-url/v1", "bikinfyp/otp-hash/v1", "bikinfyp/kredensial/v1"]) {
    assert.ok(s.includes(p), `purpose "${p}" hilang — kunci turunannya ikut berubah`);
  }
  assert.ok(baca("lib/gambar-provider.ts").includes("bikinfyp/gambar-provider/v1"));
});

test("TIDAK ADA sisa 'bikinfyp' lain di kode maupun aset publik", () => {
  // Selain dua kelompok di atas, tidak boleh ada lagi.
  const kecuali = /bikinfyp\/(media-url|otp-hash|kredensial|gambar-provider)\/v1|com\.hdrvstudio\.bikinfyp/;
  const temuan: string[] = [];
  const telusuri = (dir: string) => {
    for (const e of fs.readdirSync(path.join(process.cwd(), dir), { withFileTypes: true })) {
      const rel = path.join(dir, e.name);
      if (e.isDirectory()) { telusuri(rel); continue; }
      if (!/\.(tsx?|json|css|html)$/.test(e.name)) continue;
      baca(rel).split("\n").forEach((baris, i) => {
        if (!/bikinfyp/i.test(baris)) return;
        if (kecuali.test(baris)) return;
        if (/^\s*(\/\/|\*|\/\*)/.test(baris)) return; // komentar sejarah boleh
        temuan.push(`${rel}:${i + 1}`);
      });
    }
  };
  for (const d of ["app", "lib", "public"]) telusuri(d);
  assert.deepEqual(temuan, [], `masih ada "bikinfyp" di luar pengecualian: ${temuan.join(", ")}`);
});
