// Koreksi Brian 20 Agu: Duitku masih SANDBOX (approval merchant tertunda).
//
// Dua invarian uang yang dikunci di sini:
//   1. payments_live TIDAK BOLEH true selama payments_env = sandbox — apa pun
//      isi PAYMENTS_GO_LIVE. Sebelumnya health menjawab live hanya karena kunci
//      sandbox terpasang, jadi landing mengiklankan "checkout aman" dan tombol
//      beli terbuka padahal yang mengalir uang mainan.
//   2. Callback sandbox tidak boleh mengisi dompet nyata tanpa penanda uji.
//      Bukan kekhawatiran teoretis: 19 Agu satu callback sandbox benar-benar
//      mengkredit Rp60.000 ke dompet pengguna produksi.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-sandbox-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-sandbox-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";
process.env.PAYMENT_GATEWAY = "duitku";
process.env.DUITKU_MERCHANT_CODE = "DS34363";
process.env.DUITKU_API_KEY = "kunci-uji-sandbox";
process.env.DUITKU_IS_PRODUCTION = "false";
process.env.ADMIN_EMAILS = "penguji@bikinfyp.test";

const { paymentsEnv, paymentsLive, paymentsProvider, paymentsConfigured } = await import("../lib/config");

test("kontrak health: provider duitku, env sandbox, live FALSE", () => {
  assert.equal(paymentsProvider(), "duitku");
  assert.equal(paymentsEnv(), "sandbox");
  assert.equal(paymentsConfigured(), true, "kunci sandbox memang terpasang — itu kesiapan teknis, bukan izin");
  assert.equal(paymentsLive(), false, "sandbox tidak boleh mengaku live");
});

test("PAYMENTS_GO_LIVE=true TIDAK bisa membuat sandbox jadi live", async () => {
  const asli = process.env.PAYMENTS_GO_LIVE;
  process.env.PAYMENTS_GO_LIVE = "true";
  try {
    // config di-cache pada impor pertama, jadi izinnya dibaca ulang lewat modul
    // segar untuk menguji kombinasi env yang sebenarnya.
    const segar = await import(`../lib/config?sandbox-go-live=${Date.now()}`);
    assert.equal(segar.paymentsEnv(), "sandbox");
    assert.equal(
      segar.paymentsLive(),
      false,
      "izin manusia TIDAK boleh mengalahkan kenyataan lingkungan — sandbox tetap sandbox"
    );
  } finally {
    if (asli === undefined) delete process.env.PAYMENTS_GO_LIVE;
    else process.env.PAYMENTS_GO_LIVE = asli;
  }
});

test("production + kunci terpasang tapi TANPA izin -> tetap tidak live", async () => {
  const aslinya = { prod: process.env.DUITKU_IS_PRODUCTION, izin: process.env.PAYMENTS_GO_LIVE };
  process.env.DUITKU_IS_PRODUCTION = "true";
  delete process.env.PAYMENTS_GO_LIVE;
  try {
    const segar = await import(`../lib/config?prod-tanpa-izin=${Date.now()}`);
    assert.equal(segar.paymentsEnv(), "production");
    assert.equal(segar.paymentsLive(), false, "butuh keputusan eksplisit Brian, bukan sekadar flag production");
  } finally {
    process.env.DUITKU_IS_PRODUCTION = aslinya.prod ?? "false";
    if (aslinya.izin !== undefined) process.env.PAYMENTS_GO_LIVE = aslinya.izin;
  }
});

test("callback sandbox TIDAK mengkredit dompet pengguna biasa", async () => {
  const crypto = await import("node:crypto");
  const { getDb, now, uuid } = await import("../lib/db");
  const { findOrCreateUserByPhone } = await import("../lib/auth");
  const { getBalance } = await import("../lib/credits");
  const { POST: webhook } = await import("../app/api/webhooks/duitku/route");

  const db = getDb();
  const user = findOrCreateUserByPhone("085555111222"); // BUKAN ADMIN_EMAILS
  const orderId = `racun-sandbox-${uuid().slice(0, 8)}`;
  db.prepare(
    "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(uuid(), user.id, "duitku", orderId, 60000, 60000, "pending",
    JSON.stringify({ package_id: "hq5", payments_env: "sandbox" }), now());

  const sig = crypto.createHash("md5").update("DS34363" + "60000" + orderId + "kunci-uji-sandbox").digest("hex");
  const sebelum = getBalance(user.id);
  const res = await webhook(new Request("http://localhost/api/webhooks/duitku", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ merchantCode: "DS34363", amount: "60000", merchantOrderId: orderId, resultCode: "00", signature: sig }).toString(),
  }));

  assert.equal(res.status, 200, "Duitku harus berhenti mengulang");
  const body = await res.json();
  assert.equal(body.credited, false, "dompet pengguna biasa TIDAK boleh terisi dari sandbox");
  assert.equal(getBalance(user.id), sebelum, "saldo tidak boleh berubah");
  const pay = db.prepare("SELECT status FROM payments WHERE gateway_ref = ?").get(orderId) as { status: string };
  // ASERSI INI DULU BERBUNYI `pending`, DAN JUSTRU ITU CACATNYA.
  //
  // Maksud aslinya benar dan tetap dijaga: pembayaran sandbox TIDAK BOLEH
  // diam-diam menjadi "paid". Tapi memaksanya tetap "pending" berarti order
  // yang uangnya sudah terkonfirmasi Duitku tidak bisa dibedakan dari order
  // yang memang belum dibayar — dan layar pembeli berkata "belum masuk"
  // selamanya. Itu persis yang dilaporkan Brian 2 Sep 2026.
  //
  // "sandbox_paid" menjawab keduanya: bukan "paid" (jadi laporan keuangan
  // tidak menghitung uang mainan sebagai pendapatan), tapi juga bukan
  // "pending" (jadi kemacetannya terlihat).
  assert.equal(pay.status, "sandbox_paid", "hasil callback tidak dicatat — order akan menggantung selamanya");
  assert.notEqual(pay.status, "paid", "uang mainan tidak boleh tercatat sebagai lunas");
  const jejak = db.prepare("SELECT action FROM audit_log WHERE entity_id = ? ORDER BY rowid DESC LIMIT 1").get(orderId) as { action: string } | undefined;
  assert.equal(jejak?.action, "webhook.sandbox_ditolak", "penolakan wajib meninggalkan jejak audit");
});

test("callback sandbox TETAP mengkredit penguji terdaftar", async () => {
  const crypto = await import("node:crypto");
  const { getDb, now, uuid } = await import("../lib/db");
  const { getBalance } = await import("../lib/credits");
  const { POST: webhook } = await import("../app/api/webhooks/duitku/route");

  const db = getDb();
  const id = uuid();
  db.prepare("INSERT INTO users (id, phone, email, name, tier, locale, created_at) VALUES (?,?,?,?,?,?,?)")
    .run(id, null, "penguji@bikinfyp.test", "Penguji", "free", "id", now());
  const orderId = `racun-sandbox-admin-${uuid().slice(0, 8)}`;
  db.prepare(
    "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(uuid(), id, "duitku", orderId, 60000, 60000, "pending",
    JSON.stringify({ package_id: "hq5", payments_env: "sandbox" }), now());

  const sig = crypto.createHash("md5").update("DS34363" + "60000" + orderId + "kunci-uji-sandbox").digest("hex");
  const sebelum = getBalance(id);
  const res = await webhook(new Request("http://localhost/api/webhooks/duitku", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ merchantCode: "DS34363", amount: "60000", merchantOrderId: orderId, resultCode: "00", signature: sig }).toString(),
  }));
  const body = await res.json();
  assert.equal(body.credited, true, "penguji terdaftar harus tetap bisa menguji settlement");
  assert.equal(getBalance(id), sebelum + 60000);
});

// ── Checkout sandbox dibuka 26 Agu 2026 ──────────────────────────────────────
//
// Pendaftaran merchant Duitku DITOLAK dengan alasan: "Mohon menambahkan fitur
// checkout/fitur pembelian hingga pembayaran pada website (silakan
// mengintegrasikan website dengan Sandbox Duitku)."
//
// Penyebabnya bukan backend — jalur /api/credits/checkout -> invoice Duitku ->
// callback sudah lengkap. Penyebabnya halaman kredit menutup tombol beli
// berdasarkan payments_live, dan payments_live SELALU false di sandbox. Kita
// menutup sendiri alur yang diminta untuk diperlihatkan.
//
// Perbaikannya memisahkan dua pertanyaan yang selama ini satu boolean. Test di
// bawah menjaga agar pemisahan itu tidak berubah jadi pelonggaran: sandbox
// boleh CHECKOUT, tapi tidak pernah boleh MENGAKU uang sungguhan.

import fs from "node:fs";
import path from "node:path";

const HALAMAN = fs.readFileSync(path.join(process.cwd(), "app/kredit/page.tsx"), "utf8");
const META = fs.readFileSync(path.join(process.cwd(), "app/api/meta/route.ts"), "utf8");

test("meta memisahkan 'kunci terpasang' dari 'uang sungguhan'", () => {
  assert.match(META, /payments_configured:\s*paymentsConfigured\(\)/);
  assert.match(META, /payments_live:\s*paymentsLive\(\)/);
  // Invarian lama tetap: sandbox tidak pernah live.
  assert.equal(paymentsConfigured(), true);
  assert.equal(paymentsLive(), false);
});

test("tombol beli TIDAK lagi digantung pada payments_live", () => {
  // Kalau tombolnya kembali dikunci payments_live, checkout mati lagi di
  // sandbox dan penolakan Duitku terulang.
  // Awalan ekspresi, bukan seluruhnya. Sejak 2 Sep tombol juga menunggu
  // pembeli memilih kanal (QRIS/VA) — syarat yang MEMPERKETAT, jadi
  // memaksa kecocokan persis akan menandai pengetatan sebagai regresi.
  // Syaratnya kini diturunkan dari `kurang` — lihat catatan di
  // tests/audit-blocker.test.ts. Pertanyaannya tidak berubah: yang menutup
  // tombol adalah "kuncinya sudah terpasang?", bukan "ini uang sungguhan?".
  assert.match(HALAMAN, /const tombolMati = busy !== null \|\| kurang !== null/);
  assert.match(HALAMAN, /bisaBayar !== true\s*\n?\s*\?/);
  // Yang dilarang: tombol yang bergantung pada payments_live. Bukan
  // keberadaan paymentsLive itu sendiri — ia masih dipakai, dan memang harus,
  // untuk mengunci klaim uang sungguhan (lihat tes di bawah).
  assert.doesNotMatch(HALAMAN, /disabled=\{[^}]*paymentsLive/);
  assert.doesNotMatch(HALAMAN, /tombolMati[^;]*paymentsLive/);
});

test("default tetap TERTUTUP selagi server belum menjawab", () => {
  // "!== true", bukan "=== false": keadaan null (belum dijawab) harus ikut
  // menutup tombol. Ini temuan audit QA 16 Agu dan tidak boleh hilang hanya
  // karena pertanyaannya berganti.
  assert.match(HALAMAN, /bisaBayar !== true/);
  assert.doesNotMatch(HALAMAN, /bisaBayar === false \?\s*false/);
});

test("MODE UJI dikatakan terang-terangan, bukan disembunyikan", () => {
  // Membiarkan orang menyelesaikan pembayaran sandbox lalu heran kreditnya
  // tidak bertambah adalah kegagalan yang bisa diramalkan.
  assert.match(HALAMAN, /Mode uji coba/);
  assert.match(HALAMAN, /belum memotong uang sungguhan/);
  assert.match(HALAMAN, /modeSandbox/);
  // Kenapa kreditnya tidak bertambah HARUS ikut dikatakan — itu bagian yang
  // paling membingungkan kalau hilang.
  assert.match(HALAMAN, /jatah hanya bertambah untuk akun penguji terdaftar/);
});

test("klaim UANG SUNGGUHAN tetap dikunci payments_live", () => {
  // Yang boleh longgar cuma tombolnya. Klaim keamanan/uang sungguhan tetap
  // menunggu production + izin.
  // Klaimnya pindah ke spanduk mode uji (3 Sep 2026) — bagian "Bayar pakai"
  // di bawah halaman dihapus karena kanalnya sudah dipilih di ringkasan
  // pesanan, dan daftar kedua yang tidak bisa ditekan hanya membingungkan.
  // Yang dijaga tidak berubah: klaim soal uang sungguhan tetap menunggu
  // payments_live.
  assert.match(HALAMAN, /paymentsLive !== true &&/);
  assert.match(HALAMAN, /belum memotong uang sungguhan/);
});

// ── PEMBERITAHUAN OTOMATIS SAAT PEMBAYARAN MASUK ───────────────────────────
//
// Callback Duitku tiba di SERVER, bukan di layar pembeli. Tanpa polling,
// halaman kredit tidak akan pernah tahu pembayarannya lunas — dan satu-satunya
// cara mengetahuinya adalah menekan "Cek status" sendiri. Orang yang tidak tahu
// tombol itu ada akan menyimpulkan pembayarannya gagal, lalu membayar lagi.
// Dilaporkan Brian 3 Sep 2026 setelah membayar lewat simulator Duitku.
test("halaman kredit memeriksa sendiri, tidak menunggu ditekan", () => {
  assert.match(HALAMAN, /setInterval\(/, "tidak ada pemeriksaan berkala — pembayaran masuk tanpa ada yang tahu");
  assert.match(HALAMAN, /checkOrder\(pendingOrder, true\)/, "pemeriksaan berkala tidak memakai mode diam");
  // Berhenti sendiri: tab yang ditinggalkan terbuka tidak boleh memanggil
  // server selamanya.
  assert.match(HALAMAN, /sisa-- <= 0/, "polling tidak punya batas — tab yang ditinggal akan memanggil selamanya");
  assert.match(HALAMAN, /clearInterval/, "interval tidak pernah dibersihkan");
});

test("pemeriksaan latar tidak menampilkan galat maupun indikator sibuk", () => {
  // Kalau tidak, jaringan yang sekejap putus akan memunculkan pesan merah
  // pada layar orang yang tidak melakukan apa-apa.
  assert.match(HALAMAN, /if \(!diam\) setBusy\("cek"\)/);
  assert.match(HALAMAN, /if \(!diam\) setError\(/);
});

test("setelah lunas, pembeli diantar kembali ke alur bikin konten", () => {
  // Orang membuka halaman ini karena jatahnya habis DI TENGAH pekerjaan.
  // Meninggalkannya di halaman dompet memaksa ia mencari sendiri jalan pulang.
  assert.match(HALAMAN, /res\.status === "paid"/);
  assert.match(HALAMAN, /router\.push\(target\)/, "tidak ada kepulangan setelah pembayaran berhasil");
  assert.match(HALAMAN, /loadFlow\(\)\.returnTo \?\? "\/bikin\/jenis"/, "tujuan pulang bukan langkah pertama alur bikin");
  assert.match(HALAMAN, /Pembayaran diterima/, "layar tidak mengatakan pembayarannya berhasil");
});

test("bagian 'Bayar pakai' yang berdiri sendiri sudah tidak ada", () => {
  // Kanal dipilih di dalam ringkasan pesanan, tepat di atas tombol Bayar.
  // Daftar kedua di bawah halaman tidak bisa ditekan dan hanya membuat orang
  // bertanya-tanya mana yang berlaku.
  const jumlahDaftarKanal = (HALAMAN.match(/kanal\.map\(/g) ?? []).length;
  assert.equal(jumlahDaftarKanal, 1, `ada ${jumlahDaftarKanal} daftar kanal di halaman — seharusnya satu, di ringkasan pesanan`);
});

// ── PERILAKU HALAMAN BILLING UNTUK PELANGGAN YANG SUDAH BERLANGGANAN ────────
//
// Pertanyaan Brian 3 Sep 2026: halaman kredit tidak menyebut masa berlaku
// langganannya, dan paket yang sudah dimiliki tetap ditawarkan seolah ia belum
// punya apa-apa. Itu memang keliru — bukan karena membeli lagi terlarang
// (orang yang menghabiskan jatahnya dalam seminggu HARUS bisa menambah),
// melainkan karena layar tidak menyatakan keadaan yang sudah dia punya.
test("paket aktif dipajang lebih dulu, lengkap dengan masa berlakunya", () => {
  assert.match(HALAMAN, /Paket aktif/, "halaman tidak menyebut langganan yang sedang berjalan");
  assert.match(HALAMAN, /Berlaku sampai \{tanggal\(l\.berakhir_pada\)\}/, "tanggal berakhir langganan tidak dipajang");
  assert.match(HALAMAN, /hari lagi/, "sisa hari tidak ditampilkan");
  assert.match(HALAMAN, /Sisa \{l\.sisa\[j\]\}/, "sisa jatah per jenis tidak dipajang di kartu paket aktif");
});

test("paket yang sedang dipakai ditandai, dan aksinya disebut MENAMBAH", () => {
  // Membeli lagi tetap boleh — tapi tidak boleh tampil seperti pembelian
  // pertama. Yang dilarang adalah tombol yang diam soal akibatnya.
  assert.match(HALAMAN, /const sedangAktif = katalog\?\.langganan\.some\(\(l\) => l\.paket_id === p\.id\)/);
  assert.match(HALAMAN, /Paket aktif<\/span>|Paket aktif\s*\n/, "paket yang dimiliki tidak diberi lencana");
  assert.match(HALAMAN, /MENAMBAH paket yang sama/, "aksinya tidak menyebut bahwa paket ditambahkan, bukan diganti");
});

test("chip header menampilkan jatah video, bukan saldo rupiah warisan", async () => {
  const fs = await import("node:fs");
  const path = await import("node:path");
  const chip = fs.readFileSync(path.join(process.cwd(), "app/_components/CreditChip.tsx"), "utf8");
  // Angka yang tidak pernah berubah, di tempat paling terlihat, adalah cara
  // tercepat membuat orang menyimpulkan pembayarannya gagal.
  assert.match(chip, /\/api\/kredit-video/, "chip masih membaca dompet rupiah");
  assert.ok(!/\/api\/credits/.test(chip.replace(/^\s*\*.*$/gm, "")), "chip masih memanggil /api/credits");
  assert.match(chip, /video`/, "chip tidak menyatakan satuannya (video)");
});

test("tidak ada layar retail yang memajang RUPIAH sebagai kredit", async () => {
  // Dompet rupiah warisan tidak lagi membeli video. Layar mana pun yang
  // menampilkannya sebagai "kredit" akan menunjukkan angka MATI — dan itu
  // sudah terjadi dua kali: chip header, dan kartu ajakan top-up di beranda
  // yang berbunyi "Kredit tinggal Rp12.000" kepada orang yang baru saja
  // membeli sembilan video.
  const fs = await import("node:fs");
  const path = await import("node:path");
  const baca = (f: string) => fs.readFileSync(path.join(process.cwd(), f), "utf8");

  const beranda = baca("app/page.tsx");
  assert.match(beranda, /total_video/, "beranda tidak membaca sisa jatah video");
  assert.ok(!/d\.credits/.test(beranda), "beranda masih membaca saldo rupiah dari /api/auth/me");
  // Kalimatnya harus menyebut VIDEO, bukan nominal rupiah.
  assert.ok(!/Kredit tinggal/.test(beranda), "kalimat 'Kredit tinggal Rp...' masih ada");
  assert.match(beranda, /video lagi`|Jatah videomu habis/, "ajakan top-up tidak menyebut satuan video");

  // Rupiah TETAP sah di tempat yang memang uang — riwayat pembelian di profil.
  // Yang dilarang adalah menyebutnya "kredit" atau memakainya sebagai jatah.
  const profil = baca("app/profil/page.tsx");
  assert.match(profil, /sisaKredit\(user\.id\)/, "profil tidak membaca sisa jatah video");
  assert.ok(!/rupiah\(saldo\)/.test(profil), "profil masih memajang saldo rupiah");

  // Dan /api/auth/me benar-benar menyediakan angka penggantinya.
  const me = baca("app/api/auth/me/route.ts");
  assert.match(me, /total_video:/, "/api/auth/me tidak mengirim sisa jatah video");
  assert.match(me, /sisa_video: sisa/, "/api/auth/me tidak mengirim rincian per jenis");
});
