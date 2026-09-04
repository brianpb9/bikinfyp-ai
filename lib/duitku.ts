// Duitku POP: buat invoice + verifikasi signature callback (uang sungguhan).
// Docs: https://docs.duitku.com/pop/en/ — formula diverifikasi terhadap SDK
// resmi duitkupg/duitku-php (Pop.php, 2026-08-19):
//  - createInvoice: POST {base}/api/merchant/createInvoice
//    header x-duitku-signature = sha256(merchantCode + timestampMs + apiKey)
//  - callback: POST x-www-form-urlencoded,
//    signature = md5(merchantCode + amount + merchantOrderId + apiKey)
//  - transactionStatus: POST {base}/api/merchant/transactionStatus,
//    signature = md5(merchantCode + merchantOrderId + apiKey)

import crypto from "node:crypto";
import { NAMA_PLATFORM_PANJANG } from "./identitas-platform";
import { config } from "./config";
import { TOPUP_PACKAGES } from "./credits";

export class DuitkuNotConfigured extends Error {
  constructor() {
    super("DUITKU_MERCHANT_CODE / DUITKU_API_KEY belum diisi di server — pembayaran online belum aktif.");
    this.name = "DuitkuNotConfigured";
  }
}

/** URL callback/return wajib berasal dari konfigurasi deploy, bukan request host. */
export class DuitkuCallbackNotConfigured extends Error {
  constructor() {
    super("APP_BASE_URL harus berupa origin HTTPS publik tanpa path untuk callback Duitku.");
    this.name = "DuitkuCallbackNotConfigured";
  }
}

/** Aturan validasi sama persis dengan midtransNotificationUrl: origin HTTPS bersih. */
function publicUrl(path: string, appBaseUrl = config.appBaseUrl): string {
  try {
    const base = new URL(appBaseUrl);
    if (
      base.protocol !== "https:" ||
      base.username ||
      base.password ||
      base.port ||
      base.search ||
      base.hash ||
      (base.pathname !== "" && base.pathname !== "/")
    ) {
      throw new Error("invalid APP_BASE_URL");
    }
    return new URL(path, base.origin).toString();
  } catch {
    throw new DuitkuCallbackNotConfigured();
  }
}

export function duitkuBase(): string {
  return config.duitkuIsProduction
    ? "https://api-prod.duitku.com"
    : "https://api-sandbox.duitku.com";
}

/**
 * Host API v2 (inquiry + getPaymentMethod) — BERBEDA dari host POP di atas.
 *
 * Ini bukan kelalaian penamaan Duitku, dan bukan hal yang bisa ditebak:
 * createInvoice hidup di api-sandbox/api-prod, sedangkan v2 hidup di
 * sandbox.duitku.com/webapi. Memakai host yang salah menjawab 404, bukan galat
 * yang menjelaskan.
 *
 * Host sandbox DIVERIFIKASI langsung 2 Sep 2026 dengan merchant DS34363.
 * Host produksi BELUM diverifikasi — belum ada akun produksi untuk mengujinya,
 * jadi ia ditandai di sini alih-alih dianggap benar diam-diam.
 */
export function duitkuBaseV2(): string {
  return config.duitkuIsProduction
    ? "https://passport.duitku.com/webapi" // BELUM DIUJI — konfirmasi sebelum go-live
    : "https://sandbox.duitku.com/webapi";
}

/**
 * KANAL PEMBAYARAN YANG KITA TERIMA — QRIS dan Virtual Account.
 *
 * Kodenya BUKAN dari dokumentasi maupun ingatan. Diambil langsung dari
 * getPaymentMethod milik merchant DS34363 pada 2 Sep 2026, karena kanal yang
 * aktif berbeda per merchant — daftar dari sumber lain bisa memuat kanal yang
 * akun ini tidak punya, dan itu baru ketahuan saat pembeli menekannya.
 *
 * BCA VA (kode BC) SENGAJA TIDAK ADA DI SINI. Ia satu-satunya kanal yang
 * berbiaya: totalFee Rp5.000, sementara semua kanal di bawah nol. Kalau
 * dimasukkan tanpa keputusan sadar, setiap pembelian lewat BCA menyusutkan
 * margin diam-diam sebesar itu. BCA bank paling umum di Indonesia, jadi
 * ketiadaannya berbiaya juga — tapi itu keputusan harga, bukan keputusan kode.
 */
export type KanalDuitku = { kode: string; nama: string; jenis: "qris" | "va" };

export const KANAL_DUITKU: readonly KanalDuitku[] = [
  { kode: "NQ", nama: "QRIS", jenis: "qris" },
  { kode: "I1", nama: "BNI Virtual Account", jenis: "va" },
  { kode: "BR", nama: "BRI Virtual Account", jenis: "va" },
  { kode: "M2", nama: "Mandiri Virtual Account", jenis: "va" },
  { kode: "BT", nama: "Permata Virtual Account", jenis: "va" },
  { kode: "B1", nama: "CIMB Niaga Virtual Account", jenis: "va" },
];

export function kanalSah(kode: string): boolean {
  return KANAL_DUITKU.some((k) => k.kode === kode);
}

export type TransaksiDuitku = {
  providerRef: string;
  redirectUrl: string;
  /** Terisi untuk kanal VA. */
  vaNumber?: string;
  /** Terisi untuk QRIS — muatan mentah untuk digambar jadi kode QR. */
  qrString?: string;
};

/**
 * Buat transaksi pada SATU kanal yang dipilih pembeli (Duitku API v2).
 *
 * Bedanya dengan createDuitkuInvoice (POP): POP menyerahkan pemilihan kanal ke
 * halaman Duitku dan menampilkan SELURUH kanal milik merchant, termasuk yang
 * berbiaya dan yang tidak kita tawarkan. Jalur ini memilihkan kanalnya di sisi
 * kita, jadi daftar yang dilihat pembeli sama dengan daftar yang benar-benar
 * kita terima.
 *
 * Formula tanda tangan diverifikasi terhadap sandbox nyata, bukan disalin:
 *   md5(merchantCode + merchantOrderId + paymentAmount + apiKey)
 */

/**
 * Rincian tagihan yang DITENTUKAN PEMANGGIL.
 *
 * Sebelum ini nilai tagihan selalu diturunkan dari TOPUP_PACKAGES — daftar
 * paket rupiah tetap. Kredit per jenis video tidak muat di sana: jumlahnya
 * disusun pembeli (3 standard + 1 ultra, misalnya), jadi nilainya tidak bisa
 * dicari di daftar mana pun.
 *
 * Nilainya tetap DIHITUNG DI SERVER dan hanya diserahkan ke sini; rute
 * checkout tidak pernah menerima angka rupiah dari klien.
 */
export interface RincianTagihan {
  amountIdr: number;
  label: string;
  items: { name: string; price: number; quantity: number }[];
}

/** Rincian dari paket rupiah lama — jalur yang sudah berjalan, tidak diubah. */
function rincianPaket(packageId: string): RincianTagihan {
  const pkg = TOPUP_PACKAGES.find((p) => p.id === packageId);
  if (!pkg) throw new Error(`Paket tidak dikenal: ${packageId}`);
  return {
    amountIdr: pkg.priceIdr,
    label: `${pkg.name} ${NAMA_PLATFORM_PANJANG}`,
    items: [{ name: `${pkg.name} ${NAMA_PLATFORM_PANJANG}`, price: pkg.priceIdr, quantity: 1 }],
  };
}

/**
 * Rincian yang dipakai — dari pemanggil kalau ada, kalau tidak dari paket.
 *
 * Dijaga di satu tempat supaya tagihan yang ditandatangani, yang dikirim ke
 * Duitku, dan yang tampil di rincian item TIDAK MUNGKIN berbeda. Tanda tangan
 * Duitku menutup nilai tagihan; nilai yang berbeda antara tanda tangan dan
 * badan permintaan ditolak mereka — dan kalau lolos, yang tertagih bukan yang
 * dijanjikan ke pembeli.
 */
function rincianDari(packageId: string, rincian?: RincianTagihan): RincianTagihan {
  if (!rincian) return rincianPaket(packageId);
  if (!Number.isInteger(rincian.amountIdr) || rincian.amountIdr <= 0) {
    throw new Error(`Nilai tagihan tidak sah: ${rincian.amountIdr}`);
  }
  // DUITKU MENJUMLAHKAN `price` SAJA — `quantity` TIDAK ikut dikalikan.
  //
  // Diverifikasi langsung ke sandbox mereka 3 Sep 2026: mengirim
  // {price: 14000, quantity: 2} dengan paymentAmount 28000 ditolak HTTP 409
  // "Payment amount must be equal to all item price". Jadi `price` harus berisi
  // TOTAL BARIS, bukan harga satuan.
  //
  // Karena itu pemeriksaan di sini memakai aturan MEREKA, bukan aritmetika yang
  // terasa benar bagi kita. Rincian yang tidak menjumlah ke nilai tagihan bukan
  // cuma kuitansi yang bohong — ia pesanan yang pasti ditolak.
  const jumlahItem = rincian.items.reduce((n, i) => n + i.price, 0);
  if (jumlahItem !== rincian.amountIdr) {
    throw new Error(
      `Rincian item (${jumlahItem}) tidak sama dengan nilai tagihan (${rincian.amountIdr}). ` +
        "Duitku menjumlahkan price saja — isi price dengan total baris, bukan harga satuan.",
    );
  }
  return rincian;
}

export async function createDuitkuTransaction(opts: {
  orderId: string;
  packageId: string;
  method: string;
  phone: string;
  email: string;
  customerName?: string;
  /** Tagihan yang disusun pemanggil (kredit per jenis / langganan). */
  rincian?: RincianTagihan;
}): Promise<TransaksiDuitku> {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) throw new DuitkuNotConfigured();
  if (!kanalSah(opts.method)) throw new Error(`Kanal pembayaran tidak dikenal: ${opts.method}`);

  const tagihan = rincianDari(opts.packageId, opts.rincian);

  const callbackUrl = publicUrl("/api/webhooks/duitku");
  const returnUrl = publicUrl("/kredit");
  const signature = crypto
    .createHash("md5")
    .update(config.duitkuMerchantCode + opts.orderId + String(tagihan.amountIdr) + config.duitkuApiKey)
    .digest("hex");

  const res = await fetch(`${duitkuBaseV2()}/api/merchant/v2/inquiry`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      merchantCode: config.duitkuMerchantCode,
      paymentAmount: tagihan.amountIdr,
      paymentMethod: opts.method,
      merchantOrderId: opts.orderId,
      productDetails: tagihan.label,
      email: opts.email || "hdrvstudio@gmail.com",
      phoneNumber: opts.phone,
      // Nama pemilik VA yang tampil di aplikasi bank pembeli.
      customerVaName: opts.customerName?.slice(0, 20) || NAMA_PLATFORM_PANJANG,
      itemDetails: tagihan.items,
      callbackUrl,
      returnUrl,
      signature,
      expiryPeriod: 60,
    }),
  });

  // Badan jawaban dibaca sebagai TEKS dulu.
  //
  // Duitku tidak selalu menjawab JSON saat menolak — dan `res.json()` yang
  // gagal diam-diam menghasilkan objek kosong, sehingga pesan galatnya menjadi
  // "HTTP 409 inquiry gagal" tanpa satu pun petunjuk kenapa. Itu kalimat yang
  // membuang waktu berjam-jam: penolakannya punya alasan, tapi alasannya
  // dibuang sebelum sempat terbaca.
  const mentah = await res.text();
  let data: {
    statusCode?: string;
    statusMessage?: string;
    Message?: string;
    reference?: string;
    paymentUrl?: string;
    vaNumber?: string;
    qrString?: string;
  } = {};
  try { data = JSON.parse(mentah); } catch { /* jawaban bukan JSON — teks mentahnya ikut di bawah */ }
  if (!res.ok || data.statusCode !== "00" || !data.reference) {
    const alasan = data.statusMessage ?? data.Message ?? mentah.slice(0, 300) ?? "inquiry gagal";
    throw new Error(`duitku v2: HTTP ${res.status} ${alasan}`);
  }
  return {
    providerRef: data.reference,
    redirectUrl: data.paymentUrl ?? returnUrl,
    ...(data.vaNumber ? { vaNumber: data.vaNumber } : {}),
    ...(data.qrString ? { qrString: data.qrString } : {}),
  };
}

export async function createDuitkuInvoice(opts: {
  orderId: string;
  packageId: string;
  phone: string;
  email: string;
  rincian?: RincianTagihan;
}): Promise<{ providerRef: string; redirectUrl: string }> {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) throw new DuitkuNotConfigured();
  const callbackUrl = publicUrl("/api/webhooks/duitku");
  // Duitku menempelkan merchantOrderId/resultCode/reference sebagai query di
  // returnUrl; /kredit membacanya untuk melanjutkan cek status order.
  const returnUrl = publicUrl("/kredit");
  const tagihan = rincianDari(opts.packageId, opts.rincian);

  const timestamp = Date.now();
  const signature = crypto
    .createHash("sha256")
    .update(config.duitkuMerchantCode + timestamp + config.duitkuApiKey)
    .digest("hex");

  const res = await fetch(`${duitkuBase()}/api/merchant/createInvoice`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-duitku-signature": signature,
      "x-duitku-timestamp": String(timestamp),
      "x-duitku-merchantcode": config.duitkuMerchantCode,
    },
    body: JSON.stringify({
      paymentAmount: tagihan.amountIdr,
      merchantOrderId: opts.orderId,
      productDetails: tagihan.label,
      // Duitku mewajibkan email; user login-Google/OTP selalu punya, sisanya
      // jatuh ke email dukungan merchant agar invoice tetap bisa dibuat.
      email: opts.email || "hdrvstudio@gmail.com",
      phoneNumber: opts.phone,
      itemDetails: tagihan.items,
      callbackUrl,
      returnUrl,
      expiryPeriod: 60, // menit — selaras dengan janji "cek status" di /kredit
    }),
  });
  const data = (await res.json().catch(() => ({}))) as {
    statusCode?: string;
    statusMessage?: string;
    reference?: string;
    paymentUrl?: string;
  };
  if (!res.ok || data.statusCode !== "00" || !data.paymentUrl) {
    throw new Error(`duitku: HTTP ${res.status} ${data.statusMessage ?? "createInvoice gagal"}`);
  }
  return { providerRef: data.reference ?? opts.orderId, redirectUrl: data.paymentUrl };
}

/**
 * Verifikasi signature callback Duitku. WAJIB sebelum side effect apa pun.
 * Formula: md5(merchantCode + amount + merchantOrderId + apiKey) — pakai string
 * mentah persis seperti yang dikirim Duitku, tanpa normalisasi angka.
 */
export function verifyDuitkuCallbackSignature(payload: {
  merchantCode?: string;
  amount?: string;
  merchantOrderId?: string;
  signature?: string;
}): boolean {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) return false;
  const { merchantCode, amount, merchantOrderId, signature } = payload;
  if (!merchantCode || !amount || !merchantOrderId || !signature) return false;
  // Callback untuk merchant lain tidak pernah sah di sini.
  if (merchantCode !== config.duitkuMerchantCode) return false;
  const expected = crypto
    .createHash("md5")
    .update(merchantCode + amount + merchantOrderId + config.duitkuApiKey)
    .digest("hex");
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(String(signature).toLowerCase(), "utf8");
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/** Cek status transaksi ke Duitku (dipakai rekonsiliasi manual, bukan jalur utama). */
export async function duitkuTransactionStatus(orderId: string): Promise<{
  statusCode?: string;
  statusMessage?: string;
  reference?: string;
  amount?: string;
}> {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) throw new DuitkuNotConfigured();
  const signature = crypto
    .createHash("md5")
    .update(config.duitkuMerchantCode + orderId + config.duitkuApiKey)
    .digest("hex");
  const res = await fetch(`${duitkuBase()}/api/merchant/transactionStatus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ merchantCode: config.duitkuMerchantCode, merchantOrderId: orderId, signature }),
  });
  return (await res.json().catch(() => ({}))) as {
    statusCode?: string;
    statusMessage?: string;
    reference?: string;
    amount?: string;
  };
}

/**
 * Tanya Duitku status sebuah order — jaring pengaman kalau callback tidak tiba.
 *
 * Callback bisa hilang karena hal-hal yang di luar kendali kita: jaringan,
 * deploy yang kebetulan berlangsung, atau Duitku menyerah setelah beberapa
 * percobaan. Tanpa cara menanyakan ulang, satu callback yang hilang berarti
 * uang pembeli masuk tapi kreditnya tidak pernah ada — dan satu-satunya yang
 * tahu adalah pembeli yang komplain.
 *
 * Formula tanda tangan: md5(merchantCode + merchantOrderId + apiKey).
 * Endpoint POP, bukan v2 — verifikasi sebelum mengubah host-nya.
 */
export async function duitkuStatusTransaksi(orderId: string): Promise<{
  statusCode: string;
  statusMessage: string;
  /** "00" sukses · "01" diproses · "02" batal/gagal */
  amount?: string;
  reference?: string;
}> {
  if (!config.duitkuMerchantCode || !config.duitkuApiKey) throw new DuitkuNotConfigured();
  const signature = crypto
    .createHash("md5")
    .update(config.duitkuMerchantCode + orderId + config.duitkuApiKey)
    .digest("hex");
  const res = await fetch(`${duitkuBase()}/api/merchant/transactionStatus`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      merchantCode: config.duitkuMerchantCode,
      merchantOrderId: orderId,
      signature,
    }),
  });
  const d = (await res.json().catch(() => ({}))) as Record<string, string>;
  if (!res.ok) throw new Error(`duitku status: HTTP ${res.status} ${JSON.stringify(d).slice(0, 200)}`);
  return {
    statusCode: d.statusCode ?? "",
    statusMessage: d.statusMessage ?? "",
    amount: d.amount,
    reference: d.reference,
  };
}
