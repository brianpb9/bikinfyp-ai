/**
 * LINGKUNGAN DUITKU DITENTUKAN OLEH DUITKU SENDIRI, BUKAN OLEH FLAG ENV.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA INI ADA
 * ────────────────────────────────────────────────────────────────────────────
 * 13 Sep 2026 kode merchant production (D24570) dan API key-nya dipasang dari
 * halaman kredensial. DUITKU_IS_PRODUCTION di .env masih "false", jadi setiap
 * checkout dikirim ke host SANDBOX — yang menjawab "404 Merchant not found" —
 * dan pembeli menerima 500. Kredensialnya benar; lingkungannya yang tertinggal
 * di berkas yang tidak bisa disentuh dari dashboard.
 *
 * Satu merchant hanya hidup di SATU lingkungan, dan getPaymentMethod
 * ditandatangani dengan API key. Jadi pertanyaan "production atau sandbox?"
 * punya jawaban pasti yang bisa ditanyakan langsung: tanyakan ke kedua host,
 * lihat mana yang mengenali pasangan kode + kunci ini. Kunci sandbox tidak
 * akan pernah lolos di host production, begitu pula sebaliknya.
 *
 * Modul ini SENGAJA bebas impor aplikasi: dipakai lib/kredensial.ts, yang
 * dimuat worker dan web, dan tidak boleh menyeret rantai modul lain.
 */

import crypto from "node:crypto";

export type LingkunganDuitku = "production" | "sandbox";

/**
 * Host API v2 per lingkungan.
 *
 * sandbox    — diverifikasi 2 Sep 2026 (DS34363): getPaymentMethod + inquiry.
 * production — diverifikasi 13 Sep 2026 (D24570): getPaymentMethod menjawab
 *              200 dengan daftar kanal, host sandbox menjawab 404 untuk
 *              merchant yang sama.
 */
export const HOST_V2: Record<LingkunganDuitku, string> = {
  production: "https://passport.duitku.com/webapi",
  sandbox: "https://sandbox.duitku.com/webapi",
};

export type KanalAktif = { kode: string; nama: string; biayaIdr: number };

export type HasilDeteksi =
  | { status: "dikenali"; lingkungan: LingkunganDuitku; kanal: KanalAktif[] }
  /** Kedua host menjawab, dan tidak satu pun mengenali pasangan ini. */
  | { status: "ditolak"; alasan: string }
  /** Minimal satu host tidak terjangkau — jawabannya belum bisa dipastikan. */
  | { status: "tidak_terjangkau"; alasan: string };

type JawabanHost =
  | { jenis: "kenal"; kanal: KanalAktif[] }
  | { jenis: "tolak"; alasan: string }
  | { jenis: "putus"; alasan: string };

async function tanyaHost(
  host: string, merchantCode: string, apiKey: string, fetchImpl: typeof fetch, timeoutMs: number, amount = 10000,
): Promise<JawabanHost> {
  const datetime = new Date().toISOString().replace("T", " ").slice(0, 19);
  const signature = crypto.createHash("sha256").update(merchantCode + amount + datetime + apiKey).digest("hex");
  try {
    const res = await fetchImpl(`${host}/api/merchant/paymentmethod/getpaymentmethod`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ merchantcode: merchantCode, amount, datetime, signature }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const teks = await res.text();
    let data: { paymentFee?: { paymentMethod?: string; paymentName?: string; totalFee?: string | number }[]; Message?: string; responseMessage?: string } = {};
    try { data = JSON.parse(teks); } catch { /* bukan JSON — alasannya dari teks mentah */ }
    if (res.ok && Array.isArray(data.paymentFee)) {
      return {
        jenis: "kenal",
        kanal: data.paymentFee
          .filter((p) => typeof p.paymentMethod === "string")
          .map((p) => ({ kode: String(p.paymentMethod), nama: String(p.paymentName ?? p.paymentMethod), biayaIdr: Number(p.totalFee ?? 0) || 0 })),
      };
    }
    // 5xx, blokir WAF (403), timeout (408), dan pembatasan laju (429) bukan
    // penolakan atas MERCHANT — jawabannya belum pasti, bukan "tidak dikenal".
    if (res.status >= 500 || [403, 408, 429].includes(res.status)) {
      return { jenis: "putus", alasan: `HTTP ${res.status}` };
    }
    return { jenis: "tolak", alasan: `HTTP ${res.status} ${data.Message ?? data.responseMessage ?? teks.slice(0, 120)}`.trim() };
  } catch (err) {
    return { jenis: "putus", alasan: err instanceof Error ? err.message : "galat jaringan" };
  }
}

export async function deteksiLingkunganDuitku(
  merchantCode: string,
  apiKey: string,
  opts: { fetchImpl?: typeof fetch; timeoutMs?: number } = {},
): Promise<HasilDeteksi> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8000;
  const [prod, sandbox] = await Promise.all([
    tanyaHost(HOST_V2.production, merchantCode, apiKey, fetchImpl, timeoutMs),
    tanyaHost(HOST_V2.sandbox, merchantCode, apiKey, fetchImpl, timeoutMs),
  ]);

  // DIKENALI DI KEDUANYA — secara praktik mustahil, tapi kalau terjadi
  // jawabannya TIDAK ditebak. Menebak production berarti uang sandbox bisa
  // mengisi dompet sungguhan; menebak sandbox berarti pembayaran sungguhan
  // tidak dikreditkan. Keduanya lebih buruk daripada mengatakan "tidak pasti".
  if (prod.jenis === "kenal" && sandbox.jenis === "kenal") {
    return { status: "ditolak", alasan: "merchant dikenali di production DAN sandbox — lingkungan tidak bisa dipastikan" };
  }
  // Satu host mengenali sementara host lain putus tetap diterima: API key
  // hanya diterbitkan untuk satu lingkungan, jadi tanda tangan yang lolos di
  // satu host sudah menjawab pertanyaannya. Pemeriksaan "dikenali di keduanya"
  // di atas adalah pagar pertahanan, bukan syarat.
  for (const [lingkungan, jawaban] of [["production", prod], ["sandbox", sandbox]] as const) {
    if (jawaban.jenis !== "kenal") continue;
    // KANAL AKTIF BERGANTUNG NOMINAL: getPaymentMethod hanya mengembalikan
    // kanal yang batas min/maks-nya menampung nominal yang ditanyakan. Ditanya
    // di dua ujung — nominal kecil dan besar — lalu digabung, supaya kanal
    // bernominal minimum tinggi tidak ikut tersembunyi.
    const besar = await tanyaHost(HOST_V2[lingkungan], merchantCode, apiKey, fetchImpl, timeoutMs, 1_000_000);
    const kanal = [...jawaban.kanal];
    if (besar.jenis === "kenal") {
      for (const k of besar.kanal) if (!kanal.some((x) => x.kode === k.kode)) kanal.push(k);
    }
    return { status: "dikenali", lingkungan, kanal };
  }
  // Tidak pernah terjadi — jawaban "kenal" sudah dikembalikan di loop. Baris ini
  // ada supaya TypeScript tahu kedua jawaban di bawah pasti membawa `alasan`.
  if (prod.jenis === "kenal" || sandbox.jenis === "kenal") throw new Error("deteksi Duitku: cabang mustahil tercapai");
  if (prod.jenis === "putus" || sandbox.jenis === "putus") {
    return {
      status: "tidak_terjangkau",
      alasan: `production: ${prod.alasan}; sandbox: ${sandbox.alasan}`,
    };
  }
  return { status: "ditolak", alasan: `production: ${prod.alasan}; sandbox: ${sandbox.alasan}` };
}
