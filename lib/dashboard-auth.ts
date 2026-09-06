// Gerbang auth+org khusus dashboard enterprise/brand (F-ENT-01, 2026-08-11).
// Server Component only (butuh next/headers) — TIDAK bisa dipakai di Edge
// middleware (driver `pg` butuh soket TCP asli, middleware.ts cuma bisa
// verifikasi JWT lewat jose). Dipanggil dari app/dashboard/layout.tsx DAN
// app/dashboard/page.tsx (masing-masing query sendiri — sengaja, App Router
// tidak punya jalur murah utk share data server-component antar segment;
// query-nya murah, single-row indexed lookup, bukan tempat optimasi).
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { verifyToken, cookieName, getAuthUser } from "./auth";
import { getDb, type UserRow } from "./db";
import { postgresRuntimeEnabled, smokeGetUser } from "./postgres/smoke-runtime";
import { getUserOrgs, type OrgMembership } from "./org";
import { pgGetUserOrgs } from "./postgres/org";
import { ERR } from "./errors";

export interface DashboardContext {
  user: UserRow;
  membership: OrgMembership;
}

/** Sama seperti getAuthUser(req) di lib/auth.ts tapi baca cookie dari
 * next/headers (Server Component), bukan dari Request. */
/** Diekspor supaya gerbang lain (mis. lib/admin-auth.ts) memakai jalur auth
 *  yang SAMA — bukan menyalin pembacaan cookie dan verifikasi JWT-nya sendiri.
 *  Dua salinan logika auth adalah dua tempat yang bisa berbeda pendapat soal
 *  siapa yang sedang login. */
export async function getAuthUserFromCookies(): Promise<UserRow | null> {
  const jar = await cookies();
  const raw = jar.get(cookieName())?.value;
  if (!raw) return null;
  const parsed = await verifyToken(raw);
  if (!parsed) return null;
  if (postgresRuntimeEnabled()) return smokeGetUser(parsed.userId);
  const user = getDb().prepare("SELECT * FROM users WHERE id = ?").get(parsed.userId) as UserRow | undefined;
  return user ?? null;
}

/** Belum login -> /onboarding (sama seperti middleware.ts). Login tapi nol
 * org_members -> /dashboard/request-access. MVP: 1 org per user diasumsikan,
 * pakai membership pertama (created_at ASC, lihat lib/org.ts). */

/** Membership pertama yang organisasinya AKTIF.
 *
 * Lubang keamanan enterprise, ditemukan audit QA 16 Agu 2026: kedua jalur
 * (Postgres dan SQLite) MENGAMBIL kolom org_status tapi tidak pernah
 * menyaringnya, dan pemanggilnya langsung memakai memberships[0]. Akibatnya
 * anggota organisasi yang sudah ditangguhkan tetap bisa masuk dashboard,
 * memakai kredit bersama, dan mengubah brand kit.
 *
 * Disaring di sini — lapisan keputusan akses — bukan di dalam query, supaya
 * daftar mentahnya tetap memuat organisasi tertangguh untuk keperluan admin
 * dan tampilan status nanti. */
function membershipAktif<T extends { org_status: string }>(semua: T[]): T | undefined {
  return semua.find((m) => m.org_status === "active");
}

/** Punya organisasi, TAPI semuanya ditangguhkan. Dibedakan dari "tidak punya
 *  organisasi sama sekali": memberi tahu pengguna tertangguh bahwa ia "belum
 *  terhubung ke organisasi" menyembunyikan keadaan sebenarnya dan membuatnya
 *  mengulang pendaftaran yang tidak akan pernah berhasil. */
function semuaTertangguh<T extends { org_status: string }>(semua: T[]): boolean {
  return semua.length > 0 && semua.every((m) => m.org_status === "suspended");
}

/**
 * Sudah mendaftar, belum ditinjau.
 *
 * DIBEDAKAN dari tertangguh dengan sengaja. "Ditangguhkan" berarti pernah aktif
 * lalu dihentikan, dan halaman /dashboard/suspended menyuruh menghubungi kami
 * untuk mengaktifkan LAGI. Mengatakan itu kepada brand yang baru mendaftar lima
 * menit lalu membuat kesan mereka sudah melakukan kesalahan.
 */
function menungguPersetujuan<T extends { org_status: string }>(semua: T[]): boolean {
  return semua.length > 0 && !semua.some((m) => m.org_status === "active") && semua.some((m) => m.org_status === "pending");
}

export async function requireOrgContext(): Promise<DashboardContext> {
  const user = await getAuthUserFromCookies();
  if (!user) redirect("/onboarding");

  const memberships = postgresRuntimeEnabled() ? await pgGetUserOrgs(user.id) : getUserOrgs(user.id);
  if (menungguPersetujuan(memberships)) redirect("/dashboard/menunggu");
  if (semuaTertangguh(memberships)) redirect("/dashboard/suspended");
  const membership = membershipAktif(memberships);
  if (!membership) redirect("/dashboard/request-access");

  return { user, membership };
}

/** Sama seperti requireOrgContext tapi untuk API route (Request, bukan
 * next/headers) — melempar ERR (JSON 401/400 lewat errorResponse), bukan
 * redirect. Dipakai app/api/dashboard/**. */
export async function requireOrgContextApi(req: Request): Promise<DashboardContext> {
  const user = await getAuthUser(req);
  if (!user) throw ERR.UNAUTHORIZED();

  const memberships = postgresRuntimeEnabled() ? await pgGetUserOrgs(user.id) : getUserOrgs(user.id);
  if (menungguPersetujuan(memberships))
    throw ERR.BAD_REQUEST("Pendaftaranmu sedang kami tinjau. Kami kabari lewat email begitu selesai.", "Organization pending approval.");
  if (semuaTertangguh(memberships))
    throw ERR.BAD_REQUEST("Organisasi ini sedang ditangguhkan. Hubungi kami untuk mengaktifkannya lagi.", "Organization suspended.");
  const membership = membershipAktif(memberships);
  if (!membership) throw ERR.BAD_REQUEST("Akun ini belum terhubung ke organisasi.", "User has no org membership.");

  return { user, membership };
}
