import { headers } from "next/headers";
import OnboardingClient from "./OnboardingClient";

export const dynamic = "force-dynamic";

/**
 * Pembungkus SERVER untuk halaman masuk.
 *
 * Tugasnya satu: memutuskan SIAPA yang datang sebelum satu byte pun dikirim.
 *
 * Keputusan itu tidak bisa diambil di klien. Sebelum ini ia dibaca di
 * useEffect, sehingga HTML yang dikirim server selalu versi retail — calon
 * brand membaca "Daftar gratis — 1 video demo" (janji yang untuk mereka tidak
 * benar; akun brand mulai dengan token nol) sampai JavaScript selesai jalan.
 *
 * DUA SUMBER, dan keduanya diperlukan:
 * - ?audience=brand — dipakai tautan dari /brands, dan tetap berlaku kalau
 *   suatu saat halaman brand dilayani dari hostname yang sama.
 * - Hostname brand.* — orang bisa membuka /onboarding langsung di
 *   brand.aiugc.id tanpa lewat tautan ber-parameter, dan di sana ia jelas
 *   bukan calon retail.
 */
export default async function OnboardingPage({
  searchParams,
}: {
  searchParams: Promise<{ audience?: string }>;
}) {
  const [{ audience }, h] = await Promise.all([searchParams, headers()]);
  const host = (h.get("x-forwarded-host") ?? h.get("host") ?? "").split(",")[0]!.trim();
  const brand = audience === "brand" || host.startsWith("brand.");
  return <OnboardingClient brand={brand} />;
}
