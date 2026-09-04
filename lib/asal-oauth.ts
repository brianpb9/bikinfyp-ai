import { config } from "@/lib/config";

/**
 * ASAL (origin) yang dipakai untuk redirect_uri Google OAuth.
 *
 * KENAPA TIDAK CUKUP config.appBaseUrl:
 * redirect_uri harus SAMA PERSIS dengan yang terdaftar di Google Cloud Console,
 * dan yang terdaftar itu per-domain. Waktu APP_BASE_URL dipindah ke aiugc.id,
 * redirect_uri ikut pindah untuk SEMUA pengunjung — termasuk yang masih membuka
 * bikinfyp.com — sehingga login Google mati di dua domain sekaligus dengan
 * "Error 400: redirect_uri_mismatch". Diverifikasi langsung ke Google
 * 2026-09-05: dari empat host yang diuji, hanya https://bikinfyp.com yang
 * terdaftar; aiugc.id, www.aiugc.id, dan www.bikinfyp.com semuanya mismatch.
 *
 * Jadi asalnya diambil dari domain yang SEDANG dibuka pengunjung. Selama masa
 * pindahan, pengunjung bikinfyp.com tetap bisa masuk, dan aiugc.id langsung
 * ikut hidup begitu URI-nya didaftarkan — tanpa deploy ulang.
 *
 * KENAPA PAKAI DAFTAR-PUTIH:
 * Host adalah header dari luar. Kalau dipercaya mentah-mentah, penyerang yang
 * bisa menyetel Host mengarahkan redirect_uri ke domainnya sendiri, dan
 * authorization code pengguna mendarat di sana. Daftar-putih menutup itu: host
 * yang tak dikenal jatuh ke appBaseUrl, bukan diikuti.
 */
function normalkan(asal: string): string | null {
  try {
    const u = new URL(asal.trim());
    if (u.protocol !== "https:" && u.hostname !== "localhost" && u.hostname !== "127.0.0.1") return null;
    return u.origin;
  } catch {
    return null;
  }
}

/** appBaseUrl + APP_ASAL_TAMBAHAN. Dihitung per panggilan supaya env yang berubah terbaca. */
export function asalDiizinkan(): string[] {
  const daftar = [config.appBaseUrl, ...(process.env.APP_ASAL_TAMBAHAN ?? "").split(",")]
    .map(normalkan)
    .filter((a): a is string => a !== null);
  return [...new Set(daftar)];
}

/**
 * Asal untuk permintaan ini. Jatuh ke appBaseUrl kalau host-nya tidak dikenal —
 * termasuk saat header-nya hilang atau dipalsukan.
 */
export function asalOauth(req: Request): string {
  const izin = asalDiizinkan();
  const h = req.headers;
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim();
  if (host) {
    // Skema diambil dari X-Forwarded-Proto (nginx menyetelnya), bukan ditebak:
    // menebak "https" membuat dev lokal http:// tidak pernah cocok.
    const proto = (h.get("x-forwarded-proto") ?? "").split(",")[0]!.trim() || "https";
    const calon = normalkan(`${proto}://${host}`);
    if (calon && izin.includes(calon)) return calon;
  }
  return normalkan(config.appBaseUrl) ?? config.appBaseUrl;
}

/** redirect_uri Google — satu tempat, dipakai jalur berangkat DAN jalur callback. */
export function redirectUriGoogle(req: Request): string {
  return `${asalOauth(req)}/api/auth/google/callback`;
}
