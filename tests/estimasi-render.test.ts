// Progress bar render: bergerak, jujur, dan tidak pernah berbohong.
//
// Permintaan Brian 4 Sep 2026: "tambahkan feature progress bar sehingga
// keliatan progressnya ketika proses generating dan buatkan estimasi waktunya
// sehingga tidak jelek dari sisi ux".
//
// Yang ada sebelumnya `w-1/2 animate-pulse`: setengah penuh, berkedip, dan
// tidak pernah bergerak. Pada render Ultra yang terukur 962 detik, bar yang
// diam di tengah selama 16 menit lebih buruk daripada tidak ada bar — ia
// menyiratkan sesuatu macet.
//
// Tiga aturan yang membuat bar ini tidak berbohong, dan tes ini menjaganya:
//   1. tidak pernah mundur
//   2. tidak pernah 100% sebelum selesai
//   3. kelewat waktu DIKATAKAN, bukan dibekukan di "1 menit lagi"

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { hitungProgres, perkiraanDetik, teksSisa, TAHAP_RENDER } from "../lib/estimasi-render";
import { JOB_STATES } from "../lib/jobs";

test("bobot tahap berjumlah 1 — kalau tidak, bar tidak pernah sampai ujung", () => {
  const total = TAHAP_RENDER.reduce((a, t) => a + t.bobot, 0);
  assert.ok(Math.abs(total - 1) < 1e-9, `jumlah bobot ${total}, seharusnya 1`);
});

test("perkiraan per paket memakai angka terukur, bukan satu angka untuk semua", () => {
  // Premium 352 dtk dan Ultra 962 dtk terukur di produksi. Memakai satu angka
  // untuk keduanya berarti Ultra selalu terlihat terlambat 10 menit.
  assert.ok(perkiraanDetik("ultra") > perkiraanDetik("premium") * 2, "Ultra harus jauh lebih lama");
  assert.ok(perkiraanDetik("standard") < perkiraanDetik("premium"), "Standard harus paling cepat");
  assert.equal(perkiraanDetik("paket-karangan"), perkiraanDetik(null), "paket asing jatuh ke bawaan");
});

test("TIDAK PERNAH MUNDUR", () => {
  // Bar yang turun membuat orang mengira ada yang gagal dan diulang dari awal.
  const a = hitungProgres({ state: "QC_CHECK", berjalanDetik: 300, tier: "premium", sebelumnya: 0.8 });
  assert.ok(a.rasio >= 0.8, `mundur dari 0,8 ke ${a.rasio}`);
  // Bahkan ketika state melompat mundur (retry mengembalikan job ke COMPOSITING).
  const b = hitungProgres({ state: "COMPOSITING", berjalanDetik: 310, tier: "premium", sebelumnya: 0.9 });
  assert.ok(b.rasio >= 0.9, `mundur saat job diulang: ${b.rasio}`);
});

test("TIDAK PERNAH 100% sebelum READY", () => {
  // Bar penuh yang masih berputar menghancurkan kepercayaan pada bar berikutnya.
  for (const detik of [0, 100, 1000, 100000]) {
    const p = hitungProgres({ state: "QC_CHECK", berjalanDetik: detik, tier: "premium" });
    assert.ok(p.rasio < 1, `rasio ${p.rasio} pada detik ${detik}`);
    assert.ok(p.rasio <= 0.97, `melewati batas keras: ${p.rasio}`);
  }
  assert.equal(hitungProgres({ state: "READY", berjalanDetik: 10, tier: "premium" }).rasio, 1);
});

test("bar TERUS BERGERAK di tahap terpanjang, tidak diam di langit-langitnya", () => {
  // GENERATING_VISUAL memakan 70% durasi. Kalau bar menyentuh langit-langit
  // tahap lalu diam, pengguna Ultra melihat angka yang sama selama 10 menit.
  const t = (d: number) => hitungProgres({ state: "GENERATING_VISUAL", berjalanDetik: d, tier: "ultra" }).rasio;
  const titik = [30, 120, 300, 600, 900];
  for (let i = 1; i < titik.length; i++) {
    assert.ok(t(titik[i]) > t(titik[i - 1]), `tidak bergerak antara ${titik[i - 1]} dan ${titik[i]} dtk`);
  }
});

test("tahap yang lebih jauh memberi LANTAI yang lebih tinggi", () => {
  // QC_CHECK tidak mungkin 20% — tahapnya sendiri yang menentukan lantainya.
  const awal = hitungProgres({ state: "GENERATING_VISUAL", berjalanDetik: 5, tier: "premium" }).rasio;
  const akhir = hitungProgres({ state: "QC_CHECK", berjalanDetik: 5, tier: "premium" }).rasio;
  assert.ok(akhir > awal + 0.5, `QC_CHECK (${akhir}) harus jauh di atas GENERATING_VISUAL awal (${awal})`);
});

test("KELEWAT WAKTU dikatakan, bukan dibekukan", () => {
  const p = hitungProgres({ state: "QC_CHECK", berjalanDetik: 5000, tier: "premium" });
  assert.equal(p.kelewat, true);
  assert.equal(p.sisaDetik, null, "sisa waktu negatif tidak boleh ditampilkan");
  assert.match(teksSisa(null), /lebih lama dari biasanya/, "kelewat waktu harus dikatakan apa adanya");
});

test("hitungan mundur dibulatkan KE ATAS — jangan menjanjikan lebih cepat", () => {
  assert.match(teksSisa(61), /2 menit/, "61 detik harus dibaca 2 menit, bukan 1");
  assert.match(teksSisa(45), /50 detik/);
  assert.match(teksSisa(5), /10 detik/, "jangan menjanjikan 5 detik");
});

test("halaman proses benar-benar memakai bar ini, bukan bar palsu lama", () => {
  const hal = fs.readFileSync(path.join(process.cwd(), "app/bikin/proses/page.tsx"), "utf8");
  // Komentar dibuang dulu: catatan yang MENJELASKAN bar lama ikut tercocoki,
  // dan menghukum penjelasan yang benar mengajari orang berikutnya menghapus
  // penjelasannya, bukan memperbaiki kodenya.
  const kode = hal.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  assert.doesNotMatch(kode, /w-1\/2 animate-pulse/, "bar palsu setengah-penuh masih ada");
  assert.match(hal, /aria-valuenow=\{Math\.round\(rasio \* 100\)\}/, "bar tidak terbaca pembaca layar");
  assert.match(hal, /hitungProgres\(/, "progres tidak dihitung dari state & waktu");
  // Waktu dari created_at job, bukan dari saat halaman dibuka: pembeli boleh
  // menutup dan membuka lagi, dan angkanya harus tetap benar.
  assert.match(hal, /new Date\(job\.created_at\)\.getTime\(\)/, "waktu berjalan dihitung dari halaman dibuka");
});

// ── State di luar TAHAP_RENDER ──────────────────────────────────────────────
// Ditemukan lewat smoke test produksi 5 Sep 2026: bobotSebelum() mengembalikan
// jumlah SELURUH bobot untuk state tak dikenal, sehingga setiap state di luar
// daftar tampil 97%. Yang kena state SAH, bukan khayalan.

test("state sah di luar tahap render TIDAK menampilkan bar hampir penuh", () => {
  const diluar = JOB_STATES.filter(
    (s) => s !== "READY" && !TAHAP_RENDER.some((t) => t.state === s),
  );
  assert.ok(diluar.length > 0, "uji ini kehilangan maknanya kalau semua state ada di TAHAP_RENDER");
  for (const state of diluar) {
    const p = hitungProgres({ state, berjalanDetik: 60, tier: "premium" });
    assert.ok(
      p.rasio <= 0.75,
      `state ${state} menampilkan ${Math.round(p.rasio * 100)}% — bar hampir penuh untuk sesuatu yang belum/tidak dirender`,
    );
  }
});

test("job yang gagal membekukan bar, bukan menaikkannya", () => {
  for (const state of ["FAILED", "REFUNDED"] as const) {
    const p = hitungProgres({ state, berjalanDetik: 900, tier: "premium", sebelumnya: 0.42 });
    assert.equal(p.rasio, 0.42, `${state} seharusnya membeku di posisi terakhir`);
    assert.equal(p.sisaDetik, null, `${state} tidak boleh menjanjikan sisa waktu`);
    assert.equal(p.label, "Berhenti");
  }
});

test("menunggu persetujuan: hitungan mundur mati, sebab yang ditunggu bukan mesin", () => {
  const p = hitungProgres({ state: "AWAITING_APPROVAL", berjalanDetik: 60, tier: "premium" });
  assert.equal(p.sisaDetik, null);
  assert.equal(p.label, "Menunggu persetujuanmu");
  // Duduk sesudah syuting (0,04 antre + 0,7 syuting), bukan di 0,97.
  assert.ok(Math.abs(p.rasio - 0.74) < 0.001, `rasio ${p.rasio} bukan batas sesudah syuting`);
});

test("DRAFT belum mulai: nol, bukan penuh", () => {
  const p = hitungProgres({ state: "DRAFT", berjalanDetik: 5, tier: "premium" });
  assert.equal(p.rasio, 0);
  assert.equal(p.label, "Menyiapkan studio");
});

test("state yang belum dikenal versi ini menebak ke BAWAH", () => {
  const p = hitungProgres({ state: "TAHAP_MASA_DEPAN", berjalanDetik: 120, tier: "premium" });
  assert.equal(p.rasio, 0, "menebak ke atas berbohong; ke bawah hanya kurang informatif");
});

test("tahap render yang normal tidak ikut berubah", () => {
  const p = hitungProgres({ state: "GENERATING_VISUAL", berjalanDetik: 60, tier: "premium" });
  assert.ok(p.rasio > 0.04 && p.rasio < 0.74, `rasio ${p.rasio} keluar dari tahap syuting`);
  assert.equal(p.label, "Kreator AI syuting produkmu");
  assert.ok(p.sisaDetik !== null && p.sisaDetik > 0);
});
