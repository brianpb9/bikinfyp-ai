import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Rewrite dashboard hostname (F-ENT-01) ke /dashboard/** — mati total
// (no-op) selama DASHBOARD_HOSTNAME belum di-set di env produksi. Ini
// harus jalan SEBELUM guard login di bawah, supaya /dashboard yang hasil
// rewrite tetap kena guard yang sama (dashboard juga butuh racun_token).
const DASHBOARD_HOST = process.env.DASHBOARD_HOSTNAME;

// Guard sederhana: belum login (tanpa cookie racun_token) -> /onboarding.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (DASHBOARD_HOST && req.headers.get("host") === DASHBOARD_HOST && !pathname.startsWith("/dashboard") && !pathname.startsWith("/api")) {
    const url = req.nextUrl.clone();
    url.pathname = `/dashboard${pathname === "/" ? "" : pathname}`;
    return NextResponse.rewrite(url);
  }
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/coba") || pathname.startsWith("/mulai") || pathname.startsWith("/legal") || pathname.startsWith("/.well-known")) return NextResponse.next();
  const hasToken = req.cookies.has("racun_token");
  if (!hasToken) {
    const url = req.nextUrl.clone();
    url.pathname = "/onboarding";
    url.search = "";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|favicon.ico|onboarding|legal|demo|showcase|manifest.json|icons|apple-touch-icon.png|\\.well-known).*)",
  ],
};
