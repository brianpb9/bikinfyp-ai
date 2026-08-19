import Link from "next/link";
import { KONTAK } from "../../lib/kontak";

// Footer publik dengan identitas merchant LENGKAP: nama usaha, alamat, email,
// telepon. Sebelumnya footer hanya berisi tiga tautan legal — reviewer gateway
// pembayaran yang mencari kontak dukungan tidak menemukan apa-apa (temuan
// onboarding Duitku 2026-08-19). Tanpa hook — aman dipakai server component
// maupun client component.
export function SiteFooter() {
  return (
    <footer className="space-y-4 border-t border-zinc-100 pt-5 text-xs leading-5 text-zinc-500">
      <nav className="flex flex-wrap gap-x-4 gap-y-1 font-semibold">
        <Link href="/harga" className="hover:text-zinc-700">Harga</Link>
        <Link href="/kontak" className="hover:text-zinc-700">Kontak</Link>
        <Link href="/legal/terms" className="hover:text-zinc-700">Syarat &amp; Ketentuan</Link>
        <Link href="/legal/privacy" className="hover:text-zinc-700">Kebijakan Privasi</Link>
        <Link href="/legal/refund" className="hover:text-zinc-700">Kebijakan Refund</Link>
      </nav>
      <div className="space-y-1">
        <p className="font-semibold text-zinc-600">{KONTAK.produk} · {KONTAK.usaha}</p>
        <p>{KONTAK.alamat}</p>
        <p>
          Email: <a href={`mailto:${KONTAK.email}`} className="underline">{KONTAK.email}</a>
          {" · "}
          Telepon: <a href={`tel:${KONTAK.teleponTel}`} className="underline">{KONTAK.teleponTampil}</a>
          {" · "}
          WhatsApp: <a href={`https://wa.me/${KONTAK.whatsapp}`} className="underline">{KONTAK.whatsappTampil}</a>
        </p>
        <p>Layanan pelanggan: {KONTAK.jamLayanan}</p>
      </div>
      <p>{KONTAK.produk} — layanan pembuatan video iklan produk berbasis AI. Produk digital; tidak ada barang fisik yang dikirim.</p>
    </footer>
  );
}
