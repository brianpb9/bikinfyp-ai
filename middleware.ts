import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Guard sederhana: belum login (tanpa cookie racun_token) -> /onboarding.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname.startsWith("/onboarding") || pathname.startsWith("/legal")) return NextResponse.next();
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
    "/((?!api|_next/static|_next/image|favicon.ico|onboarding|legal|demo|showcase|manifest.json|icons|apple-touch-icon.png).*)",
  ],
};
