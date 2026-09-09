// JATAH VIDEO PER JENIS UNTUK ORGANISASI (Brian 9 Sep 2026).
//
// Brand ditagih RUPIAH lewat credit_ledger sementara retail sudah lama memakai
// jatah per jenis. Dua sistem uang untuk satu produk berarti dua tempat yang
// bisa menyimpang — dan brand tidak pernah bisa diberi tahu "sisa 5 video
// standard", hanya "sisa Rp75.000".
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const kode = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*(\/\/|--)/.test(b)).join("\n");

test("brand memotong JATAH, bukan menahan rupiah", () => {
  const rc = kode("lib/dashboard/render-cell.ts");
  assert.match(rc, /pakaiKreditOrg\(/, "render-cell tidak memakai jatah");
  assert.doesNotMatch(rc, /holdCredits\(/, "render-cell masih menahan rupiah");
});

test("jalur retail TIDAK ikut melihat jatah organisasi", () => {
  // Anggota yang juga punya organisasi harus melihat jatah pribadinya saja.
  // Bug yang persis pernah terjadi pada credit_ledger; tidak boleh diulang.
  const kv = kode("lib/postgres/kredit-video.ts");
  const kueriRetail = [...kv.matchAll(/FROM kredit_video WHERE user_id = \$1[^"]*/g)].map((m) => m[0]);
  assert.ok(kueriRetail.length >= 2, "kueri retail tidak ditemukan");
  for (const q of kueriRetail) {
    assert.match(q, /org_id IS NULL/, `kueri retail tanpa penyaring org: ${q.slice(0, 80)}`);
  }
});

test("pemotongan org mengunci baris ORGANISASI, bukan baris pengguna", () => {
  // Dua anggota yang menekan bersamaan harus berbaris di dompet yang sama.
  // Mengunci baris pengguna masing-masing tidak menghalangi siapa pun, dan
  // keduanya sama-sama membaca sisa yang sama.
  const kv = kode("lib/postgres/kredit-video.ts");
  const i = kv.indexOf("async pakai(");
  const blok = kv.slice(i, i + 700);
  assert.match(blok, /FROM organizations WHERE id = \$1 FOR UPDATE/, "dompet org tidak dikunci");
  assert.ok(blok.indexOf("organizations") < blok.indexOf("pakaiDenganClient"),
    "kunci diambil setelah pemotongan");
});

test("kembalian mendarat di dompet yang MEMOTONG, bukan dompet pemanggil", () => {
  // failJob tahu job-nya tapi tidak selalu tahu dompet mana yang tadi dipotong.
  // Membaca org_id dari baris 'pakai' membuat jatah organisasi mustahil
  // dikembalikan ke kantong pribadi anggota yang menekan tombolnya.
  const kv = kode("lib/postgres/kredit-video.ts");
  const i = kv.indexOf("export async function kembalikanDenganClient");
  const blok = kv.slice(i, i + 1400);
  assert.match(blok, /SELECT jenis, ember, langganan_id, org_id FROM kredit_video/, "org_id tidak dibaca dari baris pakai");
  assert.match(blok, /org_id,\s*jenis, ember/, "org_id tidak ikut ditulis ke baris kembali");
});

test("langganan TIDAK berlaku untuk organisasi", () => {
  // Paket langganan dijual per pengguna retail. Mencampurnya berarti jatah
  // pribadi seorang anggota bisa terpakai diam-diam untuk pekerjaan organisasi.
  const kv = kode("lib/postgres/kredit-video.ts");
  const i = kv.indexOf("export async function pakaiDenganClient");
  const blok = kv.slice(i, i + 1800);
  assert.match(blok, /orgId\s*\n?\s*\?\s*\{ rows: \[\] as BarisLangganan\[\] \}/, "org masih menyentuh langganan");
});

test("setiap INSERT kredit_video seimbang kolom dan nilainya", () => {
  // Menambah org_id ke satu INSERT dan lupa menambah placeholder-nya
  // menghasilkan galat runtime yang hanya muncul saat orang membayar.
  const kv = readFileSync(join(process.cwd(), "lib/postgres/kredit-video.ts"), "utf8");
  const cocok = [...kv.matchAll(/INSERT INTO kredit_video \(([^)]*)\)\s*\n\s*VALUES \(([^)]*)\)/g)];
  assert.ok(cocok.length >= 4, "INSERT tidak ditemukan");
  for (const m of cocok) {
    const kol = m[1]!.split(",").length;
    const val = m[2]!.split(",").length;
    assert.equal(kol, val, `INSERT timpang: ${kol} kolom vs ${val} nilai`);
  }
});

test("top-up admin memberi JUMLAH VIDEO per jenis, bukan rupiah", () => {
  const r = kode("app/api/admin/org-token/route.ts");
  assert.match(r, /INSERT INTO kredit_video/, "masih menulis ke credit_ledger");
  assert.doesNotMatch(r, /INSERT INTO credit_ledger/, "masih memberi rupiah");
  assert.match(r, /JENIS_VIDEO\.includes\(jenis\)/, "jenis tidak divalidasi");
  assert.match(r, /MAKS_SEKALI_VIDEO/, "pagu salah ketik hilang");
});

test("dashboard brand mengembalikan sisa per jenis", () => {
  const r = kode("app/api/dashboard/org/route.ts");
  assert.match(r, /sisa_video/, "sisa per jenis tidak dikirim ke layar");
});

// ── BRAND MEMBELI JATAH SENDIRI DARI DASHBOARD ──────────────────────────────
test("dompet penerima ditentukan SERVER dari keanggotaan, bukan dikirim klien", () => {
  // Kalau org_id boleh datang dari body, siapa pun yang tahu sebuah id
  // organisasi bisa mengarahkan pembelian orang lain ke dompetnya sendiri.
  const r = kode("app/api/kredit-video/checkout/route.ts");
  assert.match(r, /async function orgUntukPembelian/, "penentu dompet tidak ada");
  assert.match(r, /FROM org_members m JOIN organizations o/, "dompet tidak dibaca dari keanggotaan");
  assert.doesNotMatch(r, /body\.org_id/, "org_id diterima dari klien");

  const ui = kode("app/dashboard/_components/BeliJatahOrg.tsx");
  assert.doesNotMatch(ui, /org_id/, "klien mengirim org_id");
});

test("pembelian org hanya untuk jatah satuan, bukan langganan", () => {
  // Paket langganan dijual per pengguna retail dan jalur pemakaiannya untuk org
  // memang belum ada — mengizinkannya berarti menjual barang yang tidak bisa
  // dipakai.
  const r = kode("app/api/kredit-video/checkout/route.ts");
  assert.match(r, /orgId && jenisPesanan !== "topup_video"/, "langganan org tidak ditolak");
});

test("webhook mengkreditkan dompet yang TERCATAT DI PEMBAYARAN", () => {
  // Callback Duitku tahu order-nya, bukan siapa dompetnya. Menebak di sana
  // berarti suatu hari brand membayar lalu jatahnya mendarat di kantong pribadi
  // orang yang menekan tombolnya.
  const kv = kode("lib/postgres/kredit-video.ts");
  const i = kv.indexOf("async kreditkanTopup");
  const blok = kv.slice(i, i + 1400);
  assert.match(blok, /SELECT org_id FROM payments/, "dompet tidak dibaca dari payments");
  assert.ok(blok.indexOf("SELECT org_id FROM payments") < blok.indexOf("INSERT INTO kredit_video"),
    "dompet dibaca setelah menulis jatah");

  // HASILNYA HARUS DIPAKAI, bukan sekadar dikueri.
  //
  // Versi pertama tes ini cuma memastikan kuerinya ADA. Mutasi yang mengganti
  // `const orgId = bayar.rows[0]?.org_id` jadi `const orgId = null` lolos
  // begitu saja: kuerinya tetap jalan, hasilnya dibuang, dan setiap pembelian
  // brand mendarat di dompet retail tanpa satu pun tanda.
  assert.match(blok, /const orgId = bayar\.rows\[0\]\?\.org_id/, "hasil kueri dompet tidak dipakai");
  assert.doesNotMatch(blok, /const orgId = null/, "dompet dipaku null");
  // Dan nilainya benar-benar sampai ke baris yang ditulis.
  assert.match(blok, /\[this\.uuid\(\), userId, orgId,/, "orgId tidak ikut ditulis ke baris jatah");
});

test("idempotensi callback TIDAK ikut berubah", () => {
  // Kunci uniknya (payment_id, jenis). Kalau ikut diubah saat menambah org_id,
  // callback ulangan untuk pembayaran LAMA lolos dan memberi jatah dua kali.
  const kv = kode("lib/postgres/kredit-video.ts");
  const i = kv.indexOf("async kreditkanTopup");
  assert.match(kv.slice(i, i + 1400), /ON CONFLICT DO NOTHING/, "penjaga idempotensi hilang");
});

test("halaman kredit brand menjual JUMLAH VIDEO, bukan token rupiah", () => {
  const hal = kode("app/dashboard/(app)/credits/page.tsx");
  assert.match(hal, /BeliJatahOrg/, "komponen beli jatah tidak dipasang");
  assert.doesNotMatch(hal, /CreditPlans/, "masih memasang penjual token rupiah");
  assert.doesNotMatch(hal, /1 token = Rp1/, "masih menyebut kurs token");
  assert.match(hal, /Sisa jatah organisasi/, "saldo tidak ditampilkan sebagai jatah");
});

test("total disebut sebelum tombol bayar", () => {
  // Yang menekan tombol harus sudah tahu angkanya, bukan menemukannya di
  // halaman gateway.
  const ui = kode("app/dashboard/_components/BeliJatahOrg.tsx");
  assert.ok(ui.indexOf("rupiah(total)") < ui.indexOf("Lanjut bayar"), "total muncul setelah tombol");
});
