// Siapa boleh MEMBELANJAKAN saldo organisasi.
//
// Kolom role sudah ada sejak M1, tapi komentarnya sendiri menyatakan ia
// "HANYA label, TIDAK PERNAH dicek untuk otorisasi" — RBAC ditunda ke v2.
// Yang tidak ikut ditunda adalah uangnya: anggota mana pun bisa menekan render
// dan memotong saldo bersama, termasuk orang yang baru diundang lima menit
// lalu. Di Matriks satu klik bisa bernilai jutaan rupiah.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { bolehBelanja, bolehSetujuiNaskah, pastikanBolehBelanja } from "../lib/dashboard-rbac";

const baca = (rel: string) => fs.readFileSync(path.join(process.cwd(), rel), "utf8");

test("hanya owner yang boleh membelanjakan dan menyetujui", () => {
  assert.equal(bolehBelanja("owner"), true);
  assert.equal(bolehBelanja("member"), false);
  assert.equal(bolehSetujuiNaskah("owner"), true);
  assert.equal(bolehSetujuiNaskah("member"), false);
  // Peran yang tidak dikenal TIDAK boleh lolos. Daftar putih, sama alasannya
  // dengan tierMasihDijual: untuk pemeriksaan yang menentukan uang, bawaan
  // yang benar adalah TIDAK.
  assert.equal(bolehBelanja("admin"), false);
  assert.equal(bolehBelanja(""), false);
});

test("penolakannya 403 dan menjelaskan jalan keluarnya", () => {
  assert.doesNotThrow(() => pastikanBolehBelanja("owner"));
  try {
    pastikanBolehBelanja("member");
    assert.fail("member seharusnya ditolak");
  } catch (err) {
    const e = err as { status?: number; body?: { code?: string; message_id?: string } };
    // 403, bukan 401: penggunanya sudah masuk — login ulang tidak akan menolong.
    assert.equal(e.status, 403);
    assert.equal(e.body?.code, "FORBIDDEN");
    assert.match(e.body?.message_id ?? "", /pemilik organisasi/i);
    assert.match(e.body?.message_id ?? "", /masih bisa menyiapkan produk/i,
      "penolakan harus menyebut apa yang MASIH bisa dikerjakan, bukan cuma menutup pintu");
  }
});

test("setiap jalur yang membelanjakan memeriksa perannya", () => {
  const jalurBerbayar = [
    "app/api/dashboard/campaign/confirm/route.ts",   // menahan kredit per video
    "app/api/dashboard/matrix/route.ts",             // sampai 24 video sekali klik
    "app/api/dashboard/campaign/job/[jobId]/route.ts", // regenerate membakar uang provider; approve memfinalkan biaya
  ];
  for (const rel of jalurBerbayar) {
    assert.match(baca(rel), /pastikanBolehBelanja\(membership\.role\)/,
      `${rel} membelanjakan tanpa memeriksa peran`);
  }
});

test("UI memberi tahu di depan, bukan menolak di akhir", () => {
  const klien = baca("app/dashboard/(app)/matrix/MatrixClient.tsx");
  assert.match(klien, /const bolehBelanja = katalog\?\.role === "owner"/);
  assert.match(klien, /render berbayar dijalankan pemilik organisasi/,
    "member harus tahu sebelum menyusun 12 sel, bukan sesudah");
  assert.match(baca("app/api/dashboard/matrix/route.ts"), /role: membership\.role/,
    "peran harus dikirim ke klien supaya UI bisa jujur");
});

// Celah tata kelola: anggota organisasi membuat produk di dashboard (baris
// produknya membawa org_id), lalu memanggil API RETAIL yang mengambil produk
// hanya dengan user_id. Saldo organisasi tidak terkuras — yang bocor tata
// kelolanya: RBAC belanja dilewati, gerbang review scene dilewati, dan
// hasilnya keluar dari library organisasi.
test("API retail menolak produk milik organisasi", async () => {
  const { pastikanBukanProdukOrg } = await import("../lib/dashboard-rbac");
  assert.doesNotThrow(() => pastikanBukanProdukOrg({ org_id: null }));
  assert.doesNotThrow(() => pastikanBukanProdukOrg(null));
  try {
    pastikanBukanProdukOrg({ org_id: "org-1" });
    assert.fail("produk org seharusnya ditolak di jalur retail");
  } catch (err) {
    const e = err as { status?: number; body?: { message_id?: string } };
    assert.equal(e.status, 403);
    assert.match(e.body?.message_id ?? "", /lewat dashboard/i);
  }
});

test("setiap route retail yang menyentuh produk memasang penjaganya", () => {
  const retail = [
    "app/api/jobs/route.ts",
    "app/api/scripts/generate/route.ts",
    "app/api/scripts/[id]/route.ts",
    "app/api/scripts/[id]/approve/route.ts",
    "app/api/products/[id]/route.ts",
    "app/api/products/[id]/photos/route.ts",
  ];
  for (const rel of retail) {
    assert.match(baca(rel), /pastikanBukanProdukOrg\(product\)/,
      `${rel} membiarkan produk organisasi dikerjakan lewat jalur retail`);
  }
});

// Produksi sempat menerima job berbayar sementara migrasi invarian uang masih
// pending, dan health tetap 200 sehingga platform menganggap semuanya sehat.
// Kode baru berjalan di atas database yang belum punya jaringnya.
test("pekerjaan berbayar ditolak selama migrasi invarian uang belum terpasang", async () => {
  const { invarianUangBelumTerpasang, MIGRASI_INVARIAN_UANG } = await import("../lib/job-intake");
  assert.deepEqual(invarianUangBelumTerpasang([]), [], "tidak ada pending = boleh jalan");
  assert.deepEqual(
    invarianUangBelumTerpasang(["0031_terminal_ledger_unique.sql"]),
    ["0031_terminal_ledger_unique.sql"]
  );
  // Kedua migrasi uang harus terdaftar — kalau salah satu lupa, gerbangnya
  // membuka diri sendiri secara diam-diam.
  assert.ok(MIGRASI_INVARIAN_UANG.includes("0030_regen_ledger_type.sql"));
  assert.ok(MIGRASI_INVARIAN_UANG.includes("0031_terminal_ledger_unique.sql"));

  // SEMUA jalur yang membuat pekerjaan, memanggil provider, menahan saldo,
  // atau memotong saldo memakai gerbang yang SAMA. Sebelumnya tiap jalur
  // memilih penjaganya sendiri dan pilihannya tidak pernah sama — promo dan
  // regenerate bahkan tidak punya penjaga sama sekali, jadi health bisa
  // mengumumkan intake "closed" sementara keduanya terus jalan. Status yang
  // memberi rasa aman palsu lebih berbahaya daripada tidak punya status.
  for (const rel of [
    "app/api/jobs/route.ts",                              // retail: menahan kredit
    "app/api/dashboard/campaign/confirm/route.ts",        // enterprise: menahan kredit
    "app/api/dashboard/matrix/route.ts",                  // enterprise: sampai 24 video
    "app/api/dashboard/campaign/job/[jobId]/route.ts",    // regenerate + approve: provider
    "app/api/promo/jobs/route.ts",                        // promo: job + provider + saldo
  ]) {
    assert.match(baca(rel), /await assertPaidAdmission\(\)/,
      `${rel} memakan uang tanpa lewat gerbang bersama`);
  }
});

test("health menutup intake sendiri dan membuktikan commit yang hidup", () => {
  const s = baca("app/api/health/route.ts");
  assert.match(s, /const intake = uangPending\.length > 0 \? "closed" : jobIntakeMode\(\)/,
    "intake yang dilaporkan harus mencerminkan kenyataan, bukan cuma env");
  assert.match(s, /build_sha/, "commit yang hidup harus bisa dibuktikan, bukan disimpulkan");
  assert.match(s, /Production wajib APP_BASE_URL https/,
    "Secure diturunkan dari APP_BASE_URL — kalau ia bukan https, cookie berangkat tanpa Secure tanpa ada yang mengeluh");
});

test("gerbang uang FAIL-CLOSED di setiap cara ia bisa gagal", () => {
  const s = baca("lib/job-intake.ts");
  assert.ok(!/\.catch\(\(\) => \[\] as string\[\]\)/.test(s), "gerbang uang tidak boleh fail-open");
  assert.match(s, /MONEY_INVARIANT_NOT_READY/, "tidak siap = tolak, dengan kode sendiri");
  assert.match(s, /export async function assertPaidAdmission/,
    "harus ada SATU gerbang bersama, bukan tiap jalur memilih sendiri");
  assert.match(s, /assertJobIntakeOpen\(\);\s*\n\s*await assertInvarianUangSiap\(\);/,
    "gerbang bersama harus memeriksa maintenance DAN invarian");

  // Ketiga cara gerbang ini bisa "gagal tanpa gagal" harus berakhir TIDAK SIAP.
  const m = baca("lib/migrasi-status.ts");
  assert.match(m, /DATABASE_URL kosong/, "URL kosong");
  assert.match(m, /produksi berjalan tanpa runtime PostgreSQL/, "runtime salah di produksi");
  assert.match(m, /status invarian tidak terbaca/, "query gagal");
});

test("jalur baca retail tidak bisa melihat job organisasi", () => {
  for (const rel of [
    "app/api/jobs/[id]/route.ts",
    "app/api/jobs/[id]/output/route.ts",
    "app/api/jobs/[id]/report/route.ts",
  ]) {
    assert.match(baca(rel), /AND org_id IS NULL/,
      `${rel} membocorkan job organisasi ke riwayat pribadi`);
  }
  const rt = baca("lib/postgres/smoke-runtime.ts");
  assert.match(rt, /FROM jobs WHERE id=\$1 AND user_id=\$2 AND org_id IS NULL/);
  assert.match(rt, /j\.user_id=\$2 AND j\.org_id IS NULL/);
});

test("gerbang uang memeriksa ARTEFAK, bukan catatan migrasi", () => {
  const s = baca("lib/migrasi-status.ts");
  // pendingMigrations() mengembalikan [] saat runtime bukan PostgreSQL atau
  // DATABASE_URL kosong — SUKSES secara logis, jadi try/catch tidak pernah
  // jalan. Terbukti: production-mode dengan DATABASE_URL='' membuka admission.
  assert.match(s, /export async function invarianUangTerpasang/);
  assert.match(s, /uniq_ledger_terminal_per_job/, "indeks diperiksa langsung");
  assert.match(s, /credit_ledger_capture_delta_check/, "CHECK diperiksa langsung");
  assert.match(s, /DATABASE_URL kosong/, "URL kosong = TIDAK SIAP, bukan 'aman'");
  const g = baca("lib/job-intake.ts");
  assert.match(g, /invarianUangTerpasang\(\)/, "gerbang harus memakai pemeriksa artefak");
  // PEMANGGILAN, bukan penyebutan: nama fungsinya masih muncul di komentar
  // yang menjelaskan kenapa ia ditinggalkan, dan itu justru harus tetap ada.
  assert.ok(!/await pendingMigrations\(\)/.test(g),
    "gerbang tidak boleh lagi memanggil pembaca catatan migrasi");
});

test("skrip audit tidak bisa menemukan pemblokir lalu bilang aman", () => {
  const s = baca("scripts/audit-ledger-sebelum-migrasi.mjs");
  // Versi pertama hanya menyalakan bendera dari query PERTAMA, jadi grup
  // terminal yang memuat release ditemukan di query ketiga dan tetap diakhiri
  // "Lanjutkan". Skrip keselamatan yang bisa berkata aman padahal tidak lebih
  // berbahaya daripada tidak ada skrip.
  assert.match(s, /pemblokir: true/, "tiap pemeriksaan menyatakan sendiri status pemblokirnya");
  assert.match(s, /if \(p\.pemblokir && belum\.length\) pemblokirDitemukan\.push/, "bendera dari SETIAP pemeriksaan, bukan satu");
  // Pengecualian hanya lewat DAFTAR SADAR, bukan tebakan dari angka: percobaan
  // pertama menyimpulkan "sudah dikompensasi" dari adanya bonus di dompet yang
  // sama, dan itu bisa membuat bonus pendaftaran menutupi hold yang benar-benar
  // hilang. Yang dikecualikan wajib tercatat satu per satu beserta alasannya.
  assert.match(s, /const SUDAH_DIREKONSILIASI = new Map\(/, "daftar rekonsiliasi eksplisit");
  assert.match(s, /\[sudah direkonsiliasi\]/, "kasus yang dikecualikan TETAP dicetak");
  assert.match(s, /alasan:/, "beserta alasannya, supaya bisa diperiksa orang lain");
  assert.match(s, /process\.exit\(1\)/, "pemblokir harus keluar dengan kode bukan nol");
  assert.match(s, /READ ONLY ISOLATION LEVEL REPEATABLE READ/, "semua angka dari satu snapshot");
  assert.match(s, /statement_timeout/);
  assert.ok(!/LIMIT 100/.test(s), "inventaris korban tidak boleh dipotong");
  // Refund PARSIAL dulu lolos karena cuma memeriksa "ada release".
  assert.match(s, /SUM\(-l\.delta\) FILTER \(WHERE l\.type='hold'\)[\s\S]{0,80}>[\s\S]{0,80}SUM\(l\.delta\)  FILTER \(WHERE l\.type='release'\)/,
    "hold vs release dibandingkan NOMINAL");
});

test("aset organisasi menuntut keanggotaan yang masih aktif", () => {
  const s = baca("app/api/files/[...path]/route.ts");
  // "Dulu saya yang membuat" bukan izin selamanya: anggota yang dikeluarkan
  // atau organisasi yang ditangguhkan tidak boleh tetap menarik asetnya.
  const cocok = s.match(/org\.status='active'/g) ?? [];
  assert.ok(cocok.length >= 3, `outputs, products, dan job_shots harus menuntut org aktif (ketemu ${cocok.length})`);
  assert.match(s, /j\.org_id IS NULL AND j\.user_id=\$2/, "jalur retail tetap murni per-user");
});
