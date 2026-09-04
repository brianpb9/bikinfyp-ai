// KREDENSIAL PARTNER YANG BISA DIGANTI TANPA RESTART.
//
// Mengganti satu API key dulu berarti menyunting .env.server lewat SSH lalu
// me-recreate container — restart untuk sesuatu yang bukan perubahan kode, dan
// restart di tengah antrean render membunuh job yang sedang berjalan.
//
// Yang diuji di sini bukan "fiturnya ada", melainkan tiga janji yang kalau
// dilanggar membuat fitur ini lebih berbahaya daripada berguna:
// nilainya tidak bocor ke layar, tidak bocor ke audit, dan env tetap cadangan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-kredensial-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-kredensial-storage-${process.pid}`;
process.env.AUTH_SECRET = "kunci-uji-yang-cukup-panjang-untuk-lolos-penjagaan";

const K = await import("../lib/kredensial");
const { config } = await import("../lib/config");
const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

test("enkripsi bolak-balik, dan ciphertext tidak memuat nilai aslinya", () => {
  // NILAI PALSU, dan itu penting. Versi pertama test ini memakai kunci
  // BytePlus produksi yang asli sebagai data uji — GitHub push protection
  // menolak push-nya, dengan benar. Data uji harus terlihat seperti data uji;
  // kunci sungguhan di repo tetap kunci yang bocor, walau "cuma di test".
  const asli = "ark-CONTOH-0000-1111-2222-bukan-kunci-sungguhan";
  const enc = K.enkripsi(asli);
  assert.notEqual(enc, asli);
  assert.ok(!enc.includes(asli), "nilai asli terbaca di ciphertext");
  assert.equal(K.dekripsi(enc), asli);
});

test("dua enkripsi nilai SAMA menghasilkan ciphertext BERBEDA", () => {
  // IV acak. Tanpa ini, dua baris identik terlihat identik di dump database —
  // yang membocorkan bahwa dua partner memakai kunci yang sama.
  const a = K.enkripsi("nilai-sama");
  const b = K.enkripsi("nilai-sama");
  assert.notEqual(a, b);
  assert.equal(K.dekripsi(a), K.dekripsi(b));
});

test("ciphertext yang DIUBAH ditolak, bukan diterima diam-diam", () => {
  // GCM punya tag autentikasi. Tanpa pemeriksaan itu, siapa pun yang bisa
  // menulis ke database bisa mengganti kunci partner tanpa ketahuan.
  const enc = K.enkripsi("rahasia");
  const [iv, tag, ct] = enc.split(".");
  const rusak = [iv, tag, Buffer.from("palsu").toString("base64url")].join(".");
  assert.throws(() => K.dekripsi(rusak));
  void ct;
});

test("SAMARAN menyisakan 4 karakter terakhir, tidak lebih", () => {
  assert.equal(K.samarkan("1234567890abcd"), "••••••••abcd");
  assert.equal(K.samarkan("pendek"), "••••••");
  assert.equal(K.samarkan(""), "");
  // Yang penting: bagian depan kunci tidak pernah ikut.
  const kunci = "sk-live-RAHASIA-SEKALI-jangan-bocor";
  assert.ok(!K.samarkan(kunci).includes("RAHASIA"));
});

test("setiap kredensial menunjuk properti config yang MEMANG ADA", () => {
  // Salah ketik nama properti membuat penyimpanan berhasil tapi tidak pernah
  // terpakai — kegagalan paling membingungkan yang bisa dibuat fitur ini.
  for (const k of K.KREDENSIAL) {
    assert.ok(k.properti in config, `properti "${String(k.properti)}" tidak ada di config (${k.nama})`);
  }
  assert.ok(K.KREDENSIAL.length >= 15, "daftar kredensial menyusut — ada yang hilang dari cakupan");
});

test("nama di luar daftar DITOLAK", () => {
  assert.equal(K.kredensialDikenal("AUTH_SECRET"), undefined, "AUTH_SECRET tidak boleh diganti dari web");
  assert.equal(K.kredensialDikenal("DATABASE_URL"), undefined, "DATABASE_URL tidak boleh diganti dari web");
  assert.ok(K.kredensialDikenal("BYTEPLUS_ARK_API_KEY"));
});

test("NILAINYA TIDAK PERNAH MASUK AUDIT", () => {
  // Log audit dibaca lebih banyak orang dan berpindah lebih jauh daripada
  // database. Menaruh kunci partner di sana membatalkan seluruh gunanya
  // menyimpannya terenkripsi.
  const rute = baca("app/api/admin/kredensial/route.ts");

  // Yang diperiksa ISI OBJEK meta, bukan seluruh blok. Versi pertama menyapu
  // blok dan tersandung pada perbandingan `value === ""` — menandai kebocoran
  // yang tidak ada. Asersi yang menuduh salah sama tidak bergunanya dengan
  // asersi yang melewatkan.
  const meta = rute.slice(rute.indexOf("const meta = {"), rute.indexOf("};", rute.indexOf("const meta = {")) + 2);
  assert.ok(meta.includes("name"), "audit tidak mencatat kredensial mana yang diganti");
  // Objek audit tidak boleh menyebut `value` DALAM BENTUK APA PUN — termasuk
  // shorthand `{ name, value }`, yang lolos dari versi pertama test ini.
  assert.doesNotMatch(meta, /\bvalue\b/, "nilai kredensial ikut tercatat di audit");
  assert.doesNotMatch(meta, /\benkripsi\b/, "ciphertext ikut tercatat di audit");
  assert.match(rute, /const aksi = value === "" \? "dikembalikan ke env" : "diganti";/);

  // Dan pgAudit dipanggil dengan meta itu, bukan dengan body mentah.
  assert.match(rute, /pgAudit\(admin\.id, "admin\.kredensial", "runtime_secrets", name, meta\)/);
});

test("rute tulis dijaga gerbang admin, bukan hanya disembunyikan dari menu", () => {
  const rute = baca("app/api/admin/kredensial/route.ts");
  assert.match(rute, /await wajibAdminApi\(req\)/, "rute tulis tanpa gerbang admin");
  const auth = baca("lib/admin-auth.ts");
  assert.match(auth, /if \(!apakahAdmin\(user\.email\)\) throw ERR\.FORBIDDEN/);
});

test("env tetap CADANGAN — baris kosong berarti kembali ke .env", () => {
  const src = baca("lib/kredensial.ts");
  assert.match(src, /export async function hapusKredensial/);
  const rute = baca("app/api/admin/kredensial/route.ts");
  assert.match(rute, /if \(value === ""\) \{\s*await hapusKredensial/);
});

test("worker ikut menyegarkan — kalau tidak, ia memakai kunci lama selamanya", () => {
  // web dan worker adalah proses terpisah dengan memori sendiri. Perubahan di
  // web tidak akan pernah terlihat worker tanpa penyegaran berkala.
  const worker = baca("scripts/worker.ts");
  assert.match(worker, /mulaiPenyegaranKredensial\(\)/, "worker tidak menyegarkan kredensial");

  // Proses web disegarkan dari RUTE yang memakai kredensial, bukan dari
  // instrumentation.ts. Percobaan pertama memakai instrumentation dan
  // menjatuhkan build: Next mengompilasinya untuk edge runtime juga, dan di
  // sana `fs` tidak ada — penjagaan NEXT_RUNTIME berlaku saat jalan, webpack
  // menelusuri saat build.
  for (const rute of [
    "app/api/credits/checkout/route.ts",
    "app/api/auth/request-otp/route.ts",
    "app/api/auth/google/route.ts",
    "app/api/webhooks/duitku/route.ts",
  ]) {
    assert.match(baca(rute), /await pastikanSegar\(\)/, `${rute} memakai kredensial tanpa menyegarkannya`);
  }
});

test("redirect URI Google diturunkan dari APP_BASE_URL, bukan diketik", () => {
  // redirect_uri_mismatch adalah kegagalan yang paling mudah dibuat dan paling
  // sulit didiagnosis: Google menolak SEBELUM callback kita tersentuh, jadi
  // tidak ada satu pun log di sisi kita yang menunjukkan penyebabnya. Operator
  // lalu menebak — dengan atau tanpa www, dengan atau tanpa garis miring.
  const semula = config.appBaseUrl;
  const pasang = (v: string) => { (config as unknown as Record<string, string>).appBaseUrl = v; };

  pasang("https://bikinfyp.com");
  assert.deepEqual(K.redirectUriGoogleTerdaftar(), ["https://bikinfyp.com/api/auth/google/callback"]);

  // Garis miring berlebih tidak boleh bocor jadi "//callback".
  pasang("https://bikinfyp.com/");
  assert.deepEqual(K.redirectUriGoogleTerdaftar(), ["https://bikinfyp.com/api/auth/google/callback"]);

  // KOSONG HARUS KOSONG, bukan path relatif. "/api/auth/google/callback"
  // terlihat masuk akal dan akan disalin operator ke Google Console, lalu
  // ditolak dengan galat yang tidak menunjuk penyebabnya sama sekali.
  pasang("");
  assert.deepEqual(K.redirectUriGoogleTerdaftar(), [], "APP_BASE_URL kosong menghasilkan alamat yang menyesatkan");

  pasang(semula);

  // Dan nilainya benar-benar ditampilkan di halaman kredensial, bukan cuma ada.
  assert.match(baca("app/admin/kredensial/page.tsx"), /redirectUriGoogleTerdaftar\(\)/, "halaman tidak menampilkan alamatnya");
});

test("yang dikirim ke Google SAMA dengan yang ditampilkan ke operator", () => {
  // Kalau rute memakai rumus berbeda dari yang dipamerkan halaman admin,
  // operator akan memasang alamat yang benar untuk halaman tapi salah untuk
  // Google — dan tetap ditolak.
  // Dijaga lewat SUMBER yang sama, bukan lewat dua rumus kembar: kedua rute dan
  // halaman admin sama-sama berpangkal pada asalDiizinkan(). Rumus kembar itulah
  // yang membuat login Google mati 5 Sep 2026 — APP_BASE_URL pindah, rute ikut,
  // dan daftar di Google Console tidak.
  for (const f of ["app/api/auth/google/route.ts", "app/api/auth/google/callback/route.ts"]) {
    const isi = baca(f);
    assert.match(isi, /redirectUriGoogle\(req\)/, `${f} tidak memakai helper bersama`);
    assert.doesNotMatch(isi, /\$\{config\.appBaseUrl\}\/api\/auth\/google\/callback/, `${f} kembali memakai rumus sendiri`);
  }
  assert.match(baca("lib/kredensial.ts"), /asalDiizinkan\(\)/, "halaman admin tidak berpangkal pada daftar yang sama");
});
