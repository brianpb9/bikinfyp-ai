// Penjaga untuk temuan audit QA 16 Agu 2026 yang sudah diperbaiki.
//
// Semuanya kelas "gagal diam": tidak ada yang error, tidak ada tes yang merah,
// tapi masing-masing merugikan pengguna atau membuka lubang keamanan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { TIER_HARGA, TIER_PENSIUN, tierMasihDijual } from "../lib/paket-kredit";

const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

// /harga sempat memajang "Video Teks" Rp5.000 sementara API menolaknya dengan
// pesan "sudah tidak tersedia" — halaman publik mengiklankan barang yang
// mesinnya sendiri tolak, dan yang membaca halaman itu termasuk reviewer Midtrans.
test("tier pensiun tidak dijual di mana pun", () => {
  for (const t of TIER_HARGA) assert.ok(tierMasihDijual(t.id), `${t.id} sudah pensiun tapi masih dipajang`);
  assert.ok(TIER_PENSIUN.length > 0, "daftar pensiun jangan dikosongkan");
});

test("API generate memakai daftar pensiun bersama, bukan string hardcode", () => {
  const s = baca("app/api/scripts/generate/route.ts");
  // Dua fungsi sekarang: tierMasihDijual (ditawarkan) dan tierMasihDiterima
  // (diterima, superset). Yang dijaga tes ini tetap sama — daftarnya datang
  // dari lib/paket-kredit, bukan diketik ulang di dalam route.
  assert.match(s, /tierMasihDi(jual|terima)/, "route harus memakai sumber bersama");
  assert.ok(!/=== "silent_caption"/.test(s), "jangan kembali ke perbandingan string hardcode");
});

// Tombol beli yang pasti gagal bukan CTA, itu jebakan.
test("tombol top-up mati sampai server menyatakan pembayaran aktif", () => {
  const s = baca("app/kredit/page.tsx");
  // "!== true", bukan "=== false": penanda dari server punya tiga keadaan, dan
  // null (selagi /api/meta belum menjawab) sempat membiarkan tombolnya hidup.
  //
  // PENANDANYA BERGANTI 26 Agu 2026, defaultnya TIDAK.
  // Dulu paymentsLive ("ini uang sungguhan?"), sekarang bisaBayar ("kuncinya
  // sudah terpasang?"). Penggantian ini WAJIB, bukan pelonggaran: payments_live
  // selalu false di sandbox, jadi asersi lama mengunci checkout mati persis di
  // lingkungan yang diminta Duitku untuk diperlihatkan — dan pendaftaran
  // merchant kita ditolak karenanya. Klaim uang sungguhan tetap dijaga
  // payments_live, diperiksa di tests/pembayaran-sandbox.test.ts.
    // Syarat kanal (QRIS/VA) ditambahkan 2 Sep dan MEMPERKETAT, bukan
  // melonggarkan: tombol kini juga tertutup selama pembeli belum memilih
  // cara bayar. Asersi memeriksa awalan ekspresinya, supaya syarat baru
  // yang menambah ketat tidak dianggap regresi.
  // Bentuknya berubah 3 Sep: syaratnya dihitung sebagai `kurang` — SATU alasan
  // yang bisa dibaca — lalu `tombolMati` diturunkan darinya. Alasannya bukan
  // kosmetik: versi sebelumnya mematikan tombol tanpa menjelaskan apa pun, dan
  // menekan paket bulanan tidak menghasilkan APA PUN. Tombol diam tanpa
  // penjelasan adalah cara tercepat membuat orang mengira sistemnya rusak.
  //
  // Yang dijaga tetap sama: defaultnya TERTUTUP sampai server bilang boleh
  // ("!== true", bukan "=== false", supaya keadaan null ikut menutup).
  assert.match(s, /bisaBayar !== true\s*\n?\s*\?/, "default harus tertutup sampai server bilang boleh");
  assert.match(s, /const tombolMati = busy !== null \|\| kurang !== null/, "penjaga tombol tidak diturunkan dari alasan yang bisa dibaca");
  assert.ok(!/bisaBayar === false\}/.test(s), "jangan kembali memeriksa hanya keadaan false");
  // Dan alasannya BENAR-BENAR ditampilkan, bukan cuma dihitung.
  assert.match(s, /\{kurang && </, "alasan tombol mati tidak pernah sampai ke layar");
  assert.match(s, /Pembayaran online belum aktif/, "halaman harus menjelaskan kenapa pembelian mati");
});

// Putaran kedua audit menemukan lima cacat DI DALAM perbaikan putaran pertama.
// Penjaga di bawah menahan tiap satunya supaya tidak kembali.
test("avatar premium mengikat wajah ke suaranya", () => {
  const s = baca("app/bikin/gaya/page.tsx");
  assert.match(s, /setCreatorCategory\(a\.voice\)/, "voice preset harus ikut dipasang");
  assert.ok(!/setAvatarId\(a\.id\); setCreatorCategory\(""\)/.test(s),
    "mengosongkan kategori membuat worker jatuh ke default hijaber — avatar pria jadi bersuara perempuan");
});

test("seluruh route dashboard memakai gerbang akses bersama", () => {
  const dir = path.join(process.cwd(), "app", "api", "dashboard");
  const bocor: string[] = [];
  const telusuri = (d: string) => {
    for (const nama of fs.readdirSync(d)) {
      const f = path.join(d, nama);
      if (fs.statSync(f).isDirectory()) telusuri(f);
      else if (nama === "route.ts" && !/requireOrgContextApi/.test(fs.readFileSync(f, "utf8"))) {
        bocor.push(path.relative(process.cwd(), f));
      }
    }
  };
  telusuri(dir);
  assert.deepEqual(bocor, [], "route ini melewati gerbang organisasi — org tertangguh bisa membacanya");
});

test("Enterprise tidak menjual tier yang sudah pensiun", () => {
  const wizard = baca("app/dashboard/(app)/campaign/page.tsx");
  assert.match(wizard, /TIER_OPTIONS = SEMUA_TIER\.filter\(\(t\) => tierMasihDijual\(t\.id\)\)/, "wizard harus menyaring tier pensiun");
  const gen = baca("app/api/dashboard/campaign/generate/route.ts");
  assert.match(gen, /\.filter\(tierMasihDi(jual|terima)\)/, "route generate Enterprise harus menolak tier pensiun");
});

// Anggota organisasi yang ditangguhkan sempat tetap bisa masuk dashboard,
// memakai kredit bersama, dan mengubah brand kit.
test("organisasi tertangguh tidak bisa masuk dashboard", () => {
  const s = baca("lib/dashboard-auth.ts");
  assert.match(s, /membershipAktif/, "harus menyaring membership aktif");
  assert.match(s, /org_status === "active"/, "penyaringan harus berdasar status organisasi");
  assert.ok(!/const membership = memberships\[0\]/.test(s), "jangan kembali memakai memberships[0] mentah");
});

// Kode sekali-pakai yang ternyata bisa dipakai berkali-kali.
test("OTP dihanguskan saat verifikasi berhasil", () => {
  const sqlite = baca("lib/otp.ts");
  assert.match(sqlite, /DELETE FROM otp_codes WHERE id = \?/, "jalur SQLite harus menghapus kode terpakai");
  assert.match(sqlite, /changes !== 1/, "harus memeriksa penghapusan benar-benar terjadi");
  const pg = baca("lib/postgres/auth-otp-audit.ts");
  assert.match(pg, /DELETE FROM otp_codes WHERE id = \$1/, "jalur Postgres harus menghapus kode terpakai");
});

// Panah kembali dari Skrip melempar ke beranda, bukan mundur ke Gaya.
test("panah kembali mundur satu langkah, bukan ke beranda", () => {
  const s = baca("app/_components/ui.tsx");
  assert.match(s, /LANGKAH_SEBELUMNYA/, "peta langkah sebelumnya hilang");
  assert.ok(!/<Link href="\/" className="flex min-h-\[44px\]/.test(s), "jangan kembali menaut keras ke beranda");
});

// Caption Shopee "cek keranjang" dinyatakan tidak punya CTA.
test("pemeriksa CTA menerima 'keranjang' polos, bukan hanya 'keranjang kuning'", () => {
  const s = baca("app/api/jobs/[id]/output/route.ts");
  assert.match(s, /ctaText\.includes\("keranjang"\)/, "pemeriksaan harus generik");
  assert.ok(!/includes\("keranjang kuning"\)/.test(s), "jangan kembali ke pemeriksaan literal");
});

// Audit putaran KETIGA (17 Agu 2026) menemukan cacat di dalam perbaikan
// putaran kedua. Penjaga di bawah menahan tiap satunya.
test("tab gender mengganti wajah, suara, dan register sebagai satu identitas", () => {
  const s = baca("app/bikin/gaya/page.tsx");
  assert.match(s, /if \(avatarId && getAvatarPreset\(avatarId\)\?\.gender !== avatarGender\)/,
    "berganti gender harus ikut melepas avatar yang tidak lagi cocok");
  assert.match(s, /setAvatarId\(next\.id\)/, "avatar pengganti harus berasal dari roster kanonik");
  assert.match(s, /setCreatorCategory\(next\.voice\)/, "suara harus ikut avatar pengganti");
  assert.match(s, /setRegister\(next\.register\)/, "register harus ikut avatar pengganti");
});

test("onboarding publik tidak menjanjikan checkout saat status belum diketahui", () => {
  const s = baca("app/onboarding/page.tsx");
  assert.ok(!/paymentsLive !== false/.test(s),
    "tiga keadaan, bukan dua — null berarti belum tahu, bukan berarti aktif");
  assert.match(s, /paymentsLive === true/, "klaim checkout hanya saat server bilang aktif");
});

test("route event menulis di KEDUA runtime, bukan cuma SQLite", () => {
  const s = baca("app/api/events/route.ts");
  assert.match(s, /if \(postgresRuntimeEnabled\(\)\)\s*\{\s*await pgInsertEvent/,
    "runtime PostgreSQL harus punya penulisnya sendiri");
  assert.ok(!/if \(!postgresRuntimeEnabled\(\)\) \{\s*getDb\(\)/.test(s),
    "syarat lama ini membuang SETIAP event di produksi");
  // Fire-and-forget dipertahankan lewat try/catch, bukan lewat tidak menulis.
  assert.match(s, /catch \(err\) \{[\s\S]*jalur produk tidak boleh terganggu/,
    "kegagalan telemetri tidak boleh menggagalkan permintaan");
});

// SQLite MATI DI PRODUCTION, dan audit adalah cara paling mudah lupa.
//
// `audit()` di lib/db.ts menulis ke SQLite. Di production ia melempar
// DatabaseConfigurationError — dan karena audit hampir selalu dipanggil di
// UJUNG operasi yang sudah berhasil, kegagalannya muncul sebagai HTTP 500
// pada permintaan yang sebenarnya sudah selesai. Itu yang terjadi pada
// /api/kredit-video/checkout 2 Sep 2026: pesanan tersimpan, invoice Duitku
// terbentuk, lalu satu baris audit menjatuhkan seluruh permintaan.
test("audit() sendiri yang sadar runtime — bukan tiap pemanggilnya", () => {
  // Sampai 2 Sep 2026 tiap pemanggil wajib membungkus audit() dengan
  // if (postgresRuntimeEnabled()). Cabang yang harus diulang di 16 berkas
  // adalah cabang yang cepat atau lambat lupa ditulis di salah satunya — dan
  // lupanya TIDAK ketahuan di dev, karena di dev SQLite justru hidup.
  // /api/kredit-video/checkout 500 di production karena persis itu.
  const src = fs.readFileSync(path.join(process.cwd(), "lib", "db.ts"), "utf8");
  const fungsi = src.slice(src.indexOf("export function audit("));
  const badan = fungsi.slice(0, fungsi.indexOf("\n}\n") + 2);
  assert.match(badan, /RACUN_DB_RUNTIME/, "audit() masih menulis ke SQLite tanpa memeriksa runtime");
  assert.match(badan, /pgAudit\(/, "audit() tidak punya jalur PostgreSQL");
  // ESM, bukan require(): percobaan pertama memakai require dan diam-diam
  // mematikan SELURUH penulisan audit — lemparannya tertangkap catch dan
  // fungsinya keluar tanpa menulis apa pun.
  const kode = badan
    .split("\n")
    .filter((b) => !b.trim().startsWith("//") && !b.trim().startsWith("*") && !b.trim().startsWith("/*"))
    .join("\n");
  assert.ok(!/require\(/.test(kode), "audit() memakai require() — tidak ada di modul ESM");

  // Nama env-nya harus sama persis dengan postgresRuntimeEnabled(); keduanya
  // ditulis terpisah supaya lib/db.ts tidak perlu mengimpor lapisan Postgres.
  const smoke = fs.readFileSync(path.join(process.cwd(), "lib", "postgres", "smoke-runtime.ts"), "utf8");
  for (const env of ["RACUN_POSTGRES_SMOKE", "RACUN_DB_RUNTIME"]) {
    assert.ok(badan.includes(env), `audit() tidak memeriksa ${env}`);
    assert.ok(smoke.includes(env), `${env} tidak lagi dipakai postgresRuntimeEnabled — penanda runtime hanyut`);
  }
  // Dan kegagalannya tidak boleh menjatuhkan pemanggil: audit adalah catatan
  // tentang sesuatu yang SUDAH terjadi.
  assert.match(badan, /\.catch\(/, "kegagalan audit bisa menjatuhkan permintaan yang sudah berhasil");
});

test("rute yang menulis audit tetap bisa dipakai di kedua runtime", () => {
  // Penjaga lama memeriksa posisi baris dan terbukti tidak bisa membedakan
  // panggilan yang aman dari yang tidak. Yang diperiksa sekarang: tidak ada
  // rute yang mengimpor `audit` dari tempat SELAIN lib/db — mis. seseorang
  // membuat salinan lokal yang melewati perbaikan di atas.
  const dir = path.join(process.cwd(), "app", "api");
  const bocor: string[] = [];
  const telusuri = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const f = path.join(d, entry.name);
      if (entry.isDirectory()) { telusuri(f); continue; }
      if (!entry.name.endsWith(".ts")) continue;
      const src = fs.readFileSync(f, "utf8");
      if (/function\s+audit\s*\(|const\s+audit\s*=/.test(src)) {
        bocor.push(path.relative(process.cwd(), f));
      }
    }
  };
  telusuri(dir);
  assert.deepEqual(bocor, [], "rute ini punya audit() sendiri yang melewati penjaga runtime");
});
