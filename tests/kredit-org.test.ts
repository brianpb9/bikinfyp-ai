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
