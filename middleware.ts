import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { jwtVerify } from "jose";
import { runtimeAuthSecret } from "./lib/auth-secret-policy";

// Rewrite dashboard hostname (F-ENT-01) ke /dashboard/** — mati total
// (no-op) selama DASHBOARD_HOSTNAME belum di-set di env produksi. Ini
// harus jalan SEBELUM guard login di bawah, supaya /dashboard yang hasil
// rewrite tetap kena guard yang sama (dashboard juga butuh racun_token).
const DASHBOARD_HOST = process.env.DASHBOARD_HOSTNAME;

const COOKIE = "racun_token";

// Kunci verifikasi. Middleware berjalan di Edge, jadi memakai accessor runtime
// tervalidasi yang Edge-compatible. Accessor yang sama dipakai lib/auth.ts,
// sehingga verifikasi selalu memakai secret saat ini dan gagal tertutup bila
// nilainya hilang, default pengembangan, atau terlalu pendek.
const secret = () => new TextEncoder().encode(runtimeAuthSecret());

function toOnboarding(req: NextRequest, clearCookie: boolean) {
  const url = req.nextUrl.clone();
  // Pengunjung di hostname dashboard yang belum login adalah CALON BRAND,
  // bukan penjual retail. Melemparnya ke /onboarding retail memberi halaman
  // yang salah sama sekali — mereka dikirim ke halaman depan enterprise.
  // Yang menentukan TUJUAN YANG DIMINTA, bukan cuma hostname.
  //
  // Audit kedalaman 18 Agu: brand yang membuka bikinfyp.com/dashboard mendarat
  // di onboarding retail "Rp12.000 per video", daftar akun biasa, lalu buntu
  // karena tidak punya organisasi. Siapa pun yang mengetik /dashboard sedang
  // mencari halaman brand — hostname mana pun ia datang.
  const onDashboardHost = Boolean(DASHBOARD_HOST) && req.headers.get("host") === DASHBOARD_HOST;
  const mintaDashboard = req.nextUrl.pathname.startsWith("/dashboard");
  url.pathname = onDashboardHost || mintaDashboard ? "/brands" : "/onboarding";
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
  // /harga WAJIB publik. Seluruh daftar harga dulu hanya ada di /kredit yang
  // butuh login, jadi siapa pun yang menilai kita dari luar — calon pelanggan
  // maupun reviewer Midtrans — cuma melihat dinding login. Itu persis dua
  // temuan onboarding Midtrans 13 Agustus 2026.
  // /kontak juga publik: syarat onboarding Duitku — kontak dukungan (telepon,
  // email, alamat) harus terlihat tanpa login, sama alasannya dengan /harga.
  if (pathname.startsWith("/brands") || pathname.startsWith("/onboarding") || pathname.startsWith("/coba") || pathname.startsWith("/mulai") || pathname.startsWith("/harga") || pathname.startsWith("/kontak") || pathname.startsWith("/legal") || pathname.startsWith("/.well-known")) return NextResponse.next();
  const token = req.cookies.get(COOKIE)?.value;
  if (!token) return toOnboarding(req, false);

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
    // `previews` DAN aturan ekstensi berkas WAJIB ada di sini.
    //
    // Bug nyata yang ditemukan saat membangun halaman /brands (2026-08-11):
    // /previews/*.mp4 ikut kena guard login dan dijawab 307 ke /onboarding,
    // jadi SEMUA video contoh rusak untuk pengunjung yang belum masuk —
    // persis audiens halaman depan. Di dashboard tidak ketahuan karena di
    // sana user selalu sudah login.
    //
    // Aturan ekstensi ditambahkan supaya aset statis berikutnya tidak
    // mengulang jebakan yang sama hanya karena lupa didaftarkan.
    "/((?!api|_next/static|_next/image|favicon.ico|onboarding|legal|demo|showcase|manifest.json|icons|previews|apple-touch-icon.png|\\.well-known|.*\\.(?:mp4|webm|mov|png|jpg|jpeg|webp|avif|svg|ico|gif|woff2?|txt|xml|json)$).*)",
  ],
};
