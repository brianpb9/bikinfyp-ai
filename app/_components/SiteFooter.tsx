import Link from "next/link";
import { KONTAK } from "../../lib/kontak";

// Footer publik dengan identitas merchant LENGKAP (syarat onboarding gateway:
// telepon, email, alamat terlihat tanpa login) — tapi tetap tampil sebagai
// footer: kecil, redup, rapat. Versi pertama memakai ukuran teks isi halaman
// dan terlihat "kegedean" (feedback Brian 19 Agu). Tanpa hook — aman dipakai
// server component maupun client component.
export function SiteFooter() {
  return (
    <footer className="space-y-2 border-t border-zinc-100 pt-4 text-[10px] leading-4 text-zinc-400">
      <nav className="flex flex-wrap gap-x-3 gap-y-1 text-[11px] font-semibold text-zinc-500">
        <Link href="/harga" className="hover:text-zinc-700">Harga</Link>
        <Link href="/kontak" className="hover:text-zinc-700">Kontak</Link>
        <Link href="/legal/terms" className="hover:text-zinc-700">Syarat &amp; Ketentuan</Link>
        <Link href="/legal/privacy" className="hover:text-zinc-700">Privasi</Link>
        <Link href="/legal/refund" className="hover:text-zinc-700">Refund</Link>
      </nav>
      <p>
        <span className="font-semibold text-zinc-500">{KONTAK.produk} · {KONTAK.usaha}</span>
        {" — "}{KONTAK.alamat}
      </p>
      <p>
        <a href={`mailto:${KONTAK.email}`} className="underline">{KONTAK.email}</a>
        {" · Telp "}
        <a href={`tel:${KONTAK.teleponTel}`} className="underline">{KONTAK.teleponTampil}</a>
        {" · WA "}
        <a href={`https://wa.me/${KONTAK.whatsapp}`} className="underline">{KONTAK.whatsappTampil}</a>
        {" · "}{KONTAK.jamLayanan}
      </p>
      <p>Layanan pembuatan video iklan produk berbasis AI. Produk digital; tidak ada barang fisik yang dikirim.</p>
    </footer>
  );
}
