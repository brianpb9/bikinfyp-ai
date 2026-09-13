// LINGKUNGAN DUITKU DITENTUKAN OLEH DUITKU, BUKAN OLEH DUITKU_IS_PRODUCTION.
//
// 13 Sep 2026: merchant production D24570 dipasang dari halaman kredensial,
// tapi env masih berkata sandbox. Setiap checkout dikirim ke host sandbox,
// dijawab "404 Merchant not found", dan pembeli menerima 500.
//
// Data uji di bawah PALSU. Kunci sungguhan tidak pernah boleh ada di repo.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-duitku-deteksi-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-duitku-deteksi-storage-${process.pid}`;
process.env.AUTH_SECRET = "kunci-uji-yang-cukup-panjang-untuk-lolos-penjagaan";
process.env.PAYMENT_GATEWAY = "duitku";
process.env.DUITKU_IS_PRODUCTION = "false";
process.env.DUITKU_MERCHANT_CODE = "";
process.env.DUITKU_API_KEY = "";

const { deteksiLingkunganDuitku, HOST_V2 } = await import("../lib/duitku-deteksi");
const K = await import("../lib/kredensial");
const { config } = await import("../lib/config");
const baca = (p: string) => fs.readFileSync(path.join(process.cwd(), p), "utf8");

const KANAL = { paymentFee: [{ paymentMethod: "I1", paymentName: "BNI VA", totalFee: "0" }, { paymentMethod: "BC", paymentName: "BCA VA", totalFee: "5000" }] };

/** fetch palsu: tiap host menjawab sesuai peta. */
function fetchPalsu(peta: Record<string, { status: number; body: unknown } | "putus">): typeof fetch {
  return (async (url: string | URL) => {
    const host = Object.values(HOST_V2).find((h) => String(url).startsWith(h))!;
    const j = peta[host];
    if (j === "putus") throw new TypeError("fetch failed");
    return new Response(JSON.stringify(j.body), { status: j.status });
  }) as unknown as typeof fetch;
}

const TOLAK = { status: 404, body: { Message: "Merchant not found." } };

test("merchant yang hanya dikenali host production -> production, dengan kanalnya", async () => {
  const h = await deteksiLingkunganDuitku("DCONTOH1", "kunci-palsu", {
    fetchImpl: fetchPalsu({ [HOST_V2.production]: { status: 200, body: KANAL }, [HOST_V2.sandbox]: TOLAK }),
  });
  assert.equal(h.status, "dikenali");
  assert.ok(h.status === "dikenali" && h.lingkungan === "production");
  assert.deepEqual(h.status === "dikenali" && h.kanal, [
    { kode: "I1", nama: "BNI VA", biayaIdr: 0 },
    { kode: "BC", nama: "BCA VA", biayaIdr: 5000 },
  ]);
});

test("merchant yang hanya dikenali host sandbox -> sandbox", async () => {
  const h = await deteksiLingkunganDuitku("DSCONTOH", "kunci-palsu", {
    fetchImpl: fetchPalsu({ [HOST_V2.production]: TOLAK, [HOST_V2.sandbox]: { status: 200, body: KANAL } }),
  });
  assert.ok(h.status === "dikenali" && h.lingkungan === "sandbox");
});

test("ditolak keduanya -> ditolak; host putus atau 5xx -> tidak_terjangkau, BUKAN ditolak", async () => {
  const tolak = await deteksiLingkunganDuitku("X", "k", { fetchImpl: fetchPalsu({ [HOST_V2.production]: TOLAK, [HOST_V2.sandbox]: TOLAK }) });
  assert.equal(tolak.status, "ditolak");
  const putus = await deteksiLingkunganDuitku("X", "k", { fetchImpl: fetchPalsu({ [HOST_V2.production]: "putus", [HOST_V2.sandbox]: TOLAK }) });
  assert.equal(putus.status, "tidak_terjangkau");
  const galat = await deteksiLingkunganDuitku("X", "k", { fetchImpl: fetchPalsu({ [HOST_V2.production]: { status: 503, body: {} }, [HOST_V2.sandbox]: TOLAK }) });
  assert.equal(galat.status, "tidak_terjangkau");
});

test("403/408/429 = belum pasti, bukan merchant ditolak", async () => {
  for (const status of [403, 408, 429]) {
    const h = await deteksiLingkunganDuitku("X", "k", { fetchImpl: fetchPalsu({ [HOST_V2.production]: { status, body: {} }, [HOST_V2.sandbox]: TOLAK }) });
    assert.equal(h.status, "tidak_terjangkau", `HTTP ${status} dianggap penolakan merchant`);
  }
});

test("kanal aktif digabung dari nominal kecil DAN besar", async () => {
  // getPaymentMethod hanya mengembalikan kanal yang menampung nominalnya.
  const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
    if (String(url).startsWith(HOST_V2.sandbox)) return new Response(JSON.stringify(TOLAK.body), { status: 404 });
    const amount = JSON.parse(String(init?.body)).amount as number;
    const paymentFee = amount >= 1_000_000
      ? [{ paymentMethod: "I1", paymentName: "BNI VA", totalFee: "0" }, { paymentMethod: "XX", paymentName: "Kanal minimum tinggi", totalFee: "0" }]
      : [{ paymentMethod: "I1", paymentName: "BNI VA", totalFee: "0" }, { paymentMethod: "NQ", paymentName: "QRIS", totalFee: "0" }];
    return new Response(JSON.stringify({ paymentFee }), { status: 200 });
  }) as unknown as typeof fetch;
  const h = await deteksiLingkunganDuitku("X", "k", { fetchImpl });
  assert.ok(h.status === "dikenali");
  assert.deepEqual(h.status === "dikenali" && h.kanal.map((k) => k.kode), ["I1", "NQ", "XX"]);
});

test("dikenali di KEDUANYA tidak ditebak", async () => {
  // Menebak production = uang sandbox mengisi dompet sungguhan.
  const h = await deteksiLingkunganDuitku("X", "k", {
    fetchImpl: fetchPalsu({ [HOST_V2.production]: { status: 200, body: KANAL }, [HOST_V2.sandbox]: { status: 200, body: KANAL } }),
  });
  assert.notEqual(h.status, "dikenali");
});

test("jawaban Duitku MENIMPA DUITKU_IS_PRODUCTION, dan terikat ke pasangan kuncinya", async () => {
  const pasang = (mc: string, key: string) => {
    (config as unknown as Record<string, string>).duitkuMerchantCode = mc;
    (config as unknown as Record<string, string>).duitkuApiKey = key;
  };
  let dipanggil = 0;
  const produksi = async () => { dipanggil++; return { status: "dikenali" as const, lingkungan: "production" as const, kanal: [{ kode: "I1", nama: "BNI VA", biayaIdr: 0 }] }; };

  pasang("DCONTOH1", "kunci-palsu-a");
  assert.equal(config.duitkuIsProduction, false, "prasyarat: env berkata sandbox");
  assert.equal(K.lingkunganDuitkuPasti(), false, "lingkungan dianggap pasti sebelum Duitku menjawab");
  const h = await K.pastikanLingkunganDuitku({ deteksi: produksi });
  assert.equal(h?.status, "dikenali");
  assert.equal(config.duitkuIsProduction, true, "merchant production tetap diperlakukan sandbox karena env");
  assert.equal(K.lingkunganDuitkuPasti(), true);
  assert.deepEqual(K.kanalAktifDuitku(), ["I1"]);
  assert.equal(K.statusLingkunganDuitku().sumber, "terdeteksi");

  // Pasangan yang sama tidak ditanyakan ulang.
  await K.pastikanLingkunganDuitku({ deteksi: produksi });
  assert.equal(dipanggil, 1, "Duitku ditanya di setiap permintaan");

  // KUNCI DIGANTI: catatan lama tidak berlaku, env kembali jadi cadangan
  // sampai Duitku menjawab untuk pasangan baru.
  pasang("DCONTOH1", "kunci-palsu-b");
  let gagal = 0;
  const tolak = async () => { gagal++; return { status: "ditolak" as const, alasan: "uji" }; };
  const h2 = await K.pastikanLingkunganDuitku({ deteksi: tolak });
  assert.equal(h2?.status, "ditolak");
  assert.equal(config.duitkuIsProduction, false, "catatan pasangan lama menempel ke pasangan baru");
  // Tiga tanda yang TIDAK bergantung pada nilai env: kanal, sumber, dan
  // kepastian. Nilai false di atas kebetulan sama dengan env, jadi sendirian
  // ia tidak membuktikan catatan lama sudah terlepas.
  assert.equal(K.kanalAktifDuitku(), null);
  assert.equal(K.statusLingkunganDuitku().sumber, "env");
  assert.equal(K.lingkunganDuitkuPasti(), false, "webhook akan bekerja di atas tebakan env");

  // Kembali ke pasangan LAMA: catatannya masih berlaku tanpa bertanya ulang.
  pasang("DCONTOH1", "kunci-palsu-a");
  await K.pastikanLingkunganDuitku({ deteksi: produksi });
  assert.equal(dipanggil, 1);
  assert.equal(config.duitkuIsProduction, true);
  pasang("DCONTOH1", "kunci-palsu-b");

  // Kegagalan ditahan — gateway yang menolak tidak ditanya di setiap permintaan.
  await K.pastikanLingkunganDuitku({ deteksi: tolak });
  assert.equal(gagal, 1, "kegagalan tidak ditahan");
  // ...kecuali dipaksa, seperti saat operator menyimpan kunci baru.
  await K.pastikanLingkunganDuitku({ deteksi: tolak, paksa: true });
  assert.equal(gagal, 2);

  pasang("", "");
});

test("daftar kanal KOSONG dari Duitku = tidak diketahui, bukan 'tidak ada kanal'", async () => {
  (config as unknown as Record<string, string>).duitkuMerchantCode = "DKOSONG";
  (config as unknown as Record<string, string>).duitkuApiKey = "kunci-palsu-kosong";
  await K.pastikanLingkunganDuitku({ deteksi: async () => ({ status: "dikenali" as const, lingkungan: "production" as const, kanal: [] }) });
  assert.equal(K.kanalAktifDuitku(), null, "daftar kosong menyembunyikan seluruh tombol bayar");
  (config as unknown as Record<string, string>).duitkuMerchantCode = "";
  (config as unknown as Record<string, string>).duitkuApiKey = "";
});

test("WEBHOOK MENOLAK BEKERJA DI ATAS TEBAKAN ENV", () => {
  // 13 Sep 2026: env "sandbox" + merchant production. Tanpa gerbang ini
  // pembayaran sungguhan ditandai sandbox_paid, dijawab 200, dan Duitku
  // berhenti mengirim ulang — kreditnya hilang.
  const w = baca("app/api/webhooks/duitku/route.ts");
  const gerbang = w.indexOf("if (!lingkunganDuitkuPasti())");
  assert.ok(gerbang > 0, "webhook tidak memeriksa kepastian lingkungan");
  assert.ok(gerbang > w.indexOf("verifyDuitkuCallbackSignature(payload)"), "gerbang sebelum tanda tangan diverifikasi");
  // Harus SEBELUM status apa pun ditulis dan sebelum gerbang sandbox.
  for (const sesudah of ["tandaiStatus(", 'paymentsEnv() === "sandbox"', "pgGetPayment(orderId)"]) {
    const i = w.indexOf(sesudah, w.indexOf("export async function POST"));
    assert.ok(i > gerbang, `${sesudah} terjadi sebelum lingkungan dipastikan`);
  }
  const blok = w.slice(gerbang, w.indexOf("}", w.indexOf("status: 503", gerbang)));
  assert.match(blok, /status: 503/, "callback tidak ditunda — Duitku tidak akan mengulang");
  assert.match(w.slice(0, gerbang), /await pastikanLingkunganDuitku\(\)/);
});

test("checkout, meta, webhook, dan halaman admin memakai lingkungan yang terdeteksi", () => {
  // pastikanSegar menjalankan deteksi; webhook dan checkout sudah memanggilnya.
  const kred = baca("lib/kredensial.ts");
  const segar = kred.slice(kred.indexOf("export async function pastikanSegar"));
  assert.match(segar, /await pastikanLingkunganDuitku\(\)/, "pastikanSegar tidak memastikan lingkungan Duitku");
  for (const rute of ["app/api/kredit-video/checkout/route.ts", "app/api/webhooks/duitku/route.ts", "app/api/meta/route.ts"]) {
    assert.match(baca(rute), /await pastikanSegar\(\)/, `${rute} bisa memakai lingkungan merchant lama`);
  }
  // Menyimpan kode/kunci Duitku langsung menanyakan lingkungannya.
  assert.match(baca("app/api/admin/kredensial/route.ts"), /pastikanLingkunganDuitku\(\{ paksa: true \}\)/);
  // Kanal yang tidak aktif di merchant tidak ditawarkan.
  assert.match(baca("app/api/meta/route.ts"), /kanalAktif\.includes\(k\.kode\)/);
  // Host v2 berasal dari satu tempat yang sama dengan deteksi.
  assert.match(baca("lib/duitku.ts"), /HOST_V2\.production : HOST_V2\.sandbox/);
});
