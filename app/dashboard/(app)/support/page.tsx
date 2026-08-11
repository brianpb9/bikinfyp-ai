import { HelpCircle, MessageCircle, Mail } from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { config } from "@/lib/config";

export const dynamic = "force-dynamic";

// Bantuan (permintaan Brian: "support faq dan whatsapp support").
//
// Jawaban di bawah ditulis dari perilaku sistem yang SEBENARNYA — durasi
// render dari pengukuran nyata, aturan kredit dari lib/credits.ts, batas
// regenerate dari route review scene. Menulis FAQ yang menjanjikan sesuatu
// yang tidak dilakukan kode adalah cara tercepat kehilangan kepercayaan brand.
const FAQ: { q: string; a: string }[] = [
  {
    q: "Satu video jadi berapa lama?",
    a: "Biasanya 3–8 menit. Kalau antrean AI sedang padat bisa sampai 45 menit. Halaman hasil memperbarui sendiri, jadi boleh ditinggal.",
  },
  {
    q: "Kenapa harus meninjau scene dulu sebelum video digabung?",
    a: "Supaya kamu melihat gambar dan pesan tiap adegan sebelum jadi satu video. Kalau ada yang kurang pas, cukup ganti adegan itu — yang lain tetap. Setelah disetujui, barulah suara dan penggabungan dijalankan.",
  },
  {
    q: "Kapan kredit dipotong?",
    a: "Kredit ditahan saat render dimulai, dan baru benar-benar terpakai saat video selesai. Kalau rendernya gagal, kredit dikembalikan otomatis ke saldo organisasi.",
  },
  {
    q: "Berapa kali satu scene boleh diganti?",
    a: "Tiga kali per scene. Batas ini ada karena tiap penggantian memanggil AI video lagi. Setelah disetujui dan masuk penggabungan, scene tidak bisa diganti lagi.",
  },
  {
    q: "Bisa pakai foto avatar sendiri?",
    a: "Bisa. Di langkah Konsep ada tombol + sebelum daftar avatar. Fotonya dibaca AI untuk mengambil deskripsi tampilan, lalu deskripsi itu yang dipakai — fotonya sendiri tidak dikirim ke penyedia video.",
  },
  {
    q: "Apa bedanya AI UGC Affiliate dan AI TVC?",
    a: "Affiliate meniru konten kreator: tangan memegang produk atau presenter bicara santai. TVC adalah iklan TV — kamera terkontrol, pencahayaan ditata, ditutup hero shot produk.",
  },
  {
    q: "Kenapa video saya gagal pemeriksaan kualitas?",
    a: "Pemeriksaan otomatis menolak video yang produknya berubah bentuk, labelnya tidak terbaca, durasinya meleset, atau audionya bermasalah. Kalau gagal, kredit dikembalikan dan kamu tidak ditagih.",
  },
  {
    q: "Videonya ditandai sebagai konten AI?",
    a: "Ya. Semua video ditandai sebagai konten AI sesuai ketentuan platform.",
  },
  {
    q: "Bisa unduh banyak video sekaligus?",
    a: "Bisa. Di Library dan halaman hasil kampanye ada tombol Unduh semua. Berkasnya tersimpan dengan nama produk, bukan kode acak.",
  },
];

export default async function SupportPage() {
  await requireOrgContext();
  const wa = config.supportWhatsapp.replace(/[^\d]/g, "");

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Bantuan</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Ada yang bisa kami bantu?</h1>
      </div>

      <section className="grid gap-4 sm:grid-cols-2">
        {/* Tombol WhatsApp hanya muncul kalau nomornya memang dikonfigurasi.
            Tautan wa.me ke nomor kosong akan membuka WhatsApp ke nomor asing. */}
        {wa ? (
          <a
            href={`https://wa.me/${wa}`}
            target="_blank"
            rel="noopener noreferrer"
            className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-emerald-400"
          >
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600">
              <MessageCircle size={19} />
            </span>
            <span>
              <span className="block text-sm font-bold text-zinc-900">WhatsApp</span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
                Paling cepat. Untuk kendala render, top-up kredit, atau pertanyaan teknis.
              </span>
            </span>
          </a>
        ) : (
          <div className="flex items-start gap-3 rounded-2xl border border-dashed border-zinc-300 bg-white p-5">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-zinc-100 text-zinc-400">
              <MessageCircle size={19} />
            </span>
            <span>
              <span className="block text-sm font-bold text-zinc-900">WhatsApp</span>
              <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
                Nomor dukungan belum disetel. Sementara ini hubungi kami lewat kontak yang kamu pakai saat pendaftaran.
              </span>
            </span>
          </div>
        )}

        <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-50 text-amber-600">
            <Mail size={19} />
          </span>
          <span>
            <span className="block text-sm font-bold text-zinc-900">Kontak pendaftaran</span>
            <span className="mt-0.5 block text-xs leading-5 text-zinc-500">
              Untuk urusan penagihan dan penambahan anggota tim, balas dari email atau nomor yang kamu daftarkan.
            </span>
          </span>
        </div>
      </section>

      <section className="space-y-3">
        <h2 className="flex items-center gap-2 text-sm font-bold text-zinc-900">
          <HelpCircle size={15} className="text-zinc-400" /> Pertanyaan yang sering ditanya
        </h2>
        <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {FAQ.map((item, i) => (
            <li key={item.q} className={i > 0 ? "border-t border-zinc-100" : ""}>
              {/* <details> asli: bisa dibuka tanpa JavaScript, ramah pembaca
                  layar, dan tidak butuh state klien. */}
              <details className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-semibold text-zinc-800 transition-colors hover:bg-zinc-50">
                  {item.q}
                  <span className="shrink-0 text-lg font-normal text-zinc-300 transition-transform group-open:rotate-45">+</span>
                </summary>
                <p className="px-5 pb-4 text-sm leading-6 text-zinc-600">{item.a}</p>
              </details>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
