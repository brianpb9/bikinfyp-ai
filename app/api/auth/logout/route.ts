import { cookieName } from "@/lib/auth";
import { cookieHapus } from "@/lib/cookies";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Keluar akun. Sebelumnya tidak ada sama sekali — satu-satunya cara keluar
// adalah menghapus cookie lewat devtools. Cookie dimatikan dengan Max-Age=0
// memakai atribut yang SAMA persis seperti saat dipasang (Path, HttpOnly,
// SameSite); kalau atributnya beda, browser menyimpan cookie lama dan
// pengguna tetap terlihat login.
export async function POST() {
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "content-type": "application/json",
      "set-cookie": cookieHapus(cookieName()),
    },
  });
}
