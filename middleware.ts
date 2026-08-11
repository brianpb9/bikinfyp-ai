import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";

// Rewrite dashboard hostname (F-ENT-01) ke /dashboard/** — mati total
// (no-op) selama DASHBOARD_HOSTNAME belum di-set di env produksi. Ini
// harus jalan SEBELUM guard login di bawah, supaya /dashboard yang hasil
// rewrite tetap kena guard yang sama (dashboard juga butuh racun_token).
const DASHBOARD_HOST = process.env.DASHBOARD_HOSTNAME;

const COOKIE = "racun_token";

// Kunci verifikasi. Middleware jalan di Edge, jadi TIDAK boleh mengimpor
// lib/config.ts (menyeret modul Node). AUTH_SECRET dibaca langsung — nilainya
// sama persis dengan yang dipakai lib/auth.ts saat menandatangani.
const secret = () => new TextEncoder().encode(process.env.AUTH_SECRET ?? "");

function toOnboarding(req: NextRequest, clearCookie: boolean) {
  const url = req.nextUrl.clone();
  url.pathname = "/onboarding";
  url.search = "";
  const res = NextResponse.redirect(url);
  // Token tidak sah dihapus, bukan dibiarkan. Kalau tidak, tiap permintaan
  // berikutnya mengulang verifikasi yang sama dan gagal lagi — pengguna
  // terjebak di lingkaran redirect tanpa tahu penyebabnya, dan satu-satunya
  // jalan keluar adalah menghapus cookie lewat devtools.
  if (clearCookie) res.cookies.set(COOKIE, "", { path: "/", maxAge: 0, httpOnly: true, sameSite: "lax" });
  return res;
}

// Guard login. SEBELUMNYA hanya memeriksa cookie ADA — cookie berisi teks
// sampah, token kedaluwarsa, atau token yang ditandatangani kunci lain semua
// lolos sampai ke layout, dan barulah ditolak di sana. Sekarang tanda
// tangannya benar-benar diverifikasi di tepi, sebelum satu pun halaman atau
// query database tersentuh.
export async function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (DASHBOARD_HOST && req.headers.get("host") === DASHBOARD_HOST && !pathname.startsWith("/dashboard") && !pathname.startsWith("/api")) {
    const url = req.nextUrl.clone();
    url.pathname = `/dashboard${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/coba") || pathname.startsWith("/mulai") || pathname.startsWith("/legal") || pathname.startsWith("/.well-known")) return NextResponse.next();
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return toOnboarding(req, false);

  // AUTH_SECRET kosong berarti salah konfigurasi, bukan pengguna yang salah.
  // Boot produksi sudah ditolak lebih dulu oleh lib/secrets.ts; pengecekan di
  // sini menjaga agar middleware tidak diam-diam meloloskan semua orang kalau
  // env-nya hilang di lingkungan lain.
  if (!process.env.AUTH_SECRET) return toOnboarding(req, true);

  try {
    await jwtVerify(token, secret());
  } catch {
    // Kedaluwarsa, tanda tangan salah, atau bukan JWT sama sekali — semuanya
    // diperlakukan sama: bukan sesi yang sah.
    return toOnboarding(req, true);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|onboarding|legal|demo|showcase|manifest.json|icons|apple-touch-icon.png|\\.well-known).*)",
  ],
};
