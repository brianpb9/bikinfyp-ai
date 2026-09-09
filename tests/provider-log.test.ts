// RIWAYAT PANGGILAN PROVIDER (Brian 9 Sep 2026).
//
// Sampai kini satu-satunya jejak panggilan BytePlus adalah log kontainer, dan
// deploy blue/green menghapusnya beberapa kali sehari: saat sebuah job gagal,
// mengetahui task id-nya bergantung pada apakah kita sempat membukanya sebelum
// deploy berikutnya. Itu bukan jejak audit; itu keberuntungan.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { bersihkan } from "../lib/provider-log";

const kode = (rel: string) =>
  readFileSync(join(process.cwd(), rel), "utf8")
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n").filter((b) => !/^\s*(\/\/|--)/.test(b)).join("\n");

test("kredensial TIDAK PERNAH mendarat di log", () => {
  // Jawaban gagal kadang memantulkan header permintaan. Satu baris log yang
  // memuat API key adalah kebocoran permanen — tabelnya dibaca admin, dicadangkan,
  // dan ikut ke mana pun cadangan itu pergi.
  const contoh = 'HTTP 401 {"error":"invalid","authorization":"Bearer sk-abc123def456ghi789"}';
  const hasil = bersihkan(contoh)!;
  assert.doesNotMatch(hasil, /sk-abc123def456ghi789/, "API key ikut tersimpan");
  assert.match(hasil, /disamarkan/);
});

test("gambar base64 dibuang, bukan disimpan", () => {
  // Permintaan BytePlus memuat foto produk pelanggan sebagai data URI. Satu
  // baris bisa ratusan kilobita, dan isinya bukan milik kita.
  const contoh = 'gagal: content[3] data:image/jpeg;base64,' + "A".repeat(3000) + ' ditolak';
  const hasil = bersihkan(contoh)!;
  assert.doesNotMatch(hasil, /A{100}/, "base64 ikut tersimpan");
  assert.match(hasil, /disamarkan/);
});

test("teks panjang dipotong, dan potongannya menyebut panjang aslinya", () => {
  const hasil = bersihkan("x".repeat(9_000))!;
  assert.ok(hasil.length < 5_000, "tidak dipotong");
  assert.match(hasil, /9000 karakter, dipotong/);
});

test("nilai kosong tetap kosong, tidak jadi string 'null'", () => {
  assert.equal(bersihkan(null), null);
  assert.equal(bersihkan(undefined), null);
  assert.equal(bersihkan(""), null);
});

test("generation id dicatat saat SUBMIT, bukan menunggu selesai", () => {
  // Kalau pollingnya yang gagal, id inilah satu-satunya cara menelusuri
  // pekerjaan itu di sisi BytePlus — dan itu justru saat paling dibutuhkan.
  const bp = kode("lib/providers/stubs/byteplus.ts");
  const i = bp.indexOf('fase: "submit"');
  const j = bp.indexOf('fase: "selesai"');
  assert.ok(i > 0, "fase submit tidak dicatat");
  assert.ok(j > i, "urutan pencatatan terbalik");
});

test("kegagalan provider ikut tercatat, dan galatnya tetap dilempar", () => {
  // Pencatatan tidak boleh mengubah perilaku: job yang gagal harus tetap gagal.
  const bp = kode("lib/providers/stubs/byteplus.ts");
  const i = bp.indexOf('fase: "gagal"');
  assert.ok(i > 0, "kegagalan tidak dicatat");
  assert.match(bp.slice(i, i + 300), /throw err;/, "galat ditelan pencatatan");
});

test("mencatat tidak boleh menggagalkan render", () => {
  // Baris log yang gagal ditulis adalah kehilangan catatan; render yang gagal
  // karena pencatatannya bermasalah adalah kehilangan uang pelanggan.
  const pl = kode("lib/provider-log.ts");
  const i = pl.indexOf("export async function catatProvider");
  assert.match(pl.slice(i, i + 2200), /catch \(e\)/, "catatProvider tidak menelan galatnya");
  // Dan dipanggil tanpa await di jalur render.
  assert.match(kode("lib/providers/stubs/byteplus.ts"), /void catatProvider\(/, "pencatatan menahan render");
});

test("ada pemangkasan — tabel tumbuh per SHOT, bukan per job", () => {
  assert.match(kode("lib/provider-log.ts"), /export async function pangkasProviderLog/);
  assert.match(kode("scripts/worker.ts"), /pangkasProviderLog\(\)/, "pemangkas tidak dijadwalkan");
});

test("admin punya tabnya, dan tabel tidak menyimpan badan permintaan", () => {
  const adm = kode("app/admin/page.tsx");
  assert.match(adm, /id: "provider", label: "Log Provider"/, "tab tidak ada");
  assert.match(adm, /FROM provider_log/, "tab tidak membaca tabelnya");

  // Komentar SQL dibuang dulu: migrasinya MENJELASKAN bahwa header
  // Authorization tidak disimpan, dan kalimat penjelasan itu memuat katanya.
  // Versi pertama tes ini gagal karena membaca komentar sebagai definisi kolom.
  const mig = readFileSync(join(process.cwd(), "migrations/postgres/0043_provider_log.sql"), "utf8")
    .split("\n").filter((b) => !/^\s*--/.test(b)).join("\n");
  assert.match(mig, /request_ringkas/, "kolom ringkasan tidak ada");
  assert.doesNotMatch(mig, /request_body|authorization|api_key/i, "ada tempat menaruh rahasia");
});

test("Seedream ikut tercatat — kegagalan gambar juga butuh root cause", () => {
  // Brian 9 Sep 2026: "ketika regenerate apabila gagal tidak diinformasikan
  // gagal disebabkan kenapa dan saya tidak bisa tracing root cause-nya."
  const sr = kode("lib/media/seedream.ts");
  assert.match(sr, /catatProvider\(/, "panggilan Seedream tidak dicatat");
  assert.match(sr, /provider: "byteplus-seedream"/, "tidak dibedakan dari jalur video");
  // Gagal DAN berhasil dicatat: tanpa pembanding, admin tidak bisa tahu apakah
  // sebuah kegagalan luar biasa atau memang selalu begitu.
  assert.match(sr, /fase: "gagal"/, "kegagalan tidak dicatat");
  assert.match(sr, /fase: "selesai"/, "keberhasilan tidak dicatat");
});

test("layar storyboard menyebut SEBAB, bukan kalimat umum", () => {
  // Penyebab berbeda menuntut tindakan berbeda: foto ditolak filter menuntut
  // ganti foto; gangguan penyedia cuma menuntut sabar. Menyamakannya membuat
  // orang mengganti foto yang tidak salah.
  const hal = kode("app/bikin/storyboard/page.tsx");
  assert.match(hal, /function pesanGagalStoryboard/, "tidak ada penerjemah sebab");
  assert.match(hal, /sensitive\|may contain/, "penolakan filter tidak dikenali");
  assert.match(hal, /Lihat pesan teknisnya/, "pesan teknis disembunyikan seluruhnya");
  // Dan pesan teknisnya benar-benar ditampilkan, bukan cuma disimpan.
  assert.match(hal, /\{data\.error\}/, "pesan teknis tidak pernah dirender");
});
