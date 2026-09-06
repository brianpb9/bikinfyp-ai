/**
 * Apakah permintaan ini datang dari sisi BRAND.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA
 * ---------------------------------------------------------------------------
 * Ditemukan 6 Sep 2026 saat menjalankan pendaftaran brand dari ujung ke ujung.
 * Rute /api/brands/daftar memang tidak menulis satu pun baris ledger — dan itu
 * sudah dijaga tes. Tapi akun brand tetap lahir dengan saldo 1, karena
 * bonusnya diberikan JAUH LEBIH AWAL: di transaksi pembuatan AKUN
 * (insertSignupSideEffects), yang dipakai bersama oleh retail dan brand.
 *
 * Jadi tes saya benar dan tetap tidak cukup: ia menjaga satu rute, sementara
 * uangnya keluar dari rute lain. Hanya menjalankan alurnya sungguhan yang
 * menunjukkannya.
 *
 * ---------------------------------------------------------------------------
 * DUA SUMBER, KEDUANYA PERLU
 * ---------------------------------------------------------------------------
 * - Hostname dashboard brand (DASHBOARD_HOSTNAME), atau awalan "brand." untuk
 *   lingkungan yang belum menyetelnya.
 * - Parameter ?audience=brand, dipakai tautan dari /brands dan tetap berlaku
 *   bila suatu saat brand dilayani dari hostname yang sama.
 */
export function dariBrand(req: Request): boolean {
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim().toLowerCase();
  const dash = (process.env.DASHBOARD_HOSTNAME ?? "").trim().toLowerCase();
  if (host && dash && host === dash) return true;
  if (host.startsWith("brand.")) return true;
  try {
    return new URL(req.url).searchParams.get("audience") === "brand";
  } catch {
    return false;
  }
}
