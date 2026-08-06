import Link from "next/link";

export const metadata = { title: "Syarat & Ketentuan — BikinFYP AI" };

// Draf disiapkan tim produk berdasarkan perilaku aktual sistem (kredit,
// QC otomatis, refund) — BUKAN pengganti tinjauan hukum. Isi bagian
// [ISI: ...] sebelum dianggap final/mengikat.
export default function TermsPage() {
  return (
    <main className="min-h-dvh space-y-6 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Legal</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Syarat & Ketentuan</h1>
        <p className="mt-1 text-xs text-zinc-500">Berlaku sejak: 2026-08-03 · Terakhir diperbarui: 2026-08-03</p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        Draf ini disiapkan berdasarkan perilaku sistem yang sebenarnya (kredit, QC otomatis, refund).
        Ini <strong>bukan pengganti tinjauan hukum</strong> — mohon direview kuasa hukum sebelum
        dianggap final, terutama bagian identitas badan usaha dan kepatuhan UU PDP.
      </div>

      <section className="space-y-3 text-sm leading-6 text-zinc-700">
        <h2 className="font-display text-lg font-bold text-zinc-900">1. Tentang Layanan</h2>
        <p>
          BikinFYP AI ("Layanan") adalah aplikasi yang membantu penjual online membuat video jualan
          bergaya UGC menggunakan kecerdasan buatan (AI), dari foto produk atau klip video milikmu sendiri.
          Layanan dioperasikan oleh HDRV Studio (usaha perorangan), Jl. Kb. Kacang 29 No.2a, RT.8/RW.4, Kb. Kacang, Kecamatan Tanah Abang, Kota Jakarta Pusat, Daerah Khusus Ibukota Jakarta 10240.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">2. Siapa yang Boleh Pakai</h2>
        <p>
          Layanan ini untuk pelaku usaha (penjual online) berusia minimal 18 tahun atau sudah cakap
          hukum untuk membuat perjanjian. Dengan mendaftar, kamu menyatakan memenuhi syarat ini dan
          bahwa data yang kamu masukkan (nomor HP/email, nama, foto produk) adalah benar dan milikmu
          sendiri atau kamu punya hak untuk menggunakannya.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">3. Konten yang Kamu Unggah</h2>
        <p>
          Kamu bertanggung jawab penuh atas foto produk, deskripsi, dan (untuk fitur AI UGC Ads)
          klip video yang kamu unggah. Dengan mengunggahnya, kamu menyatakan:
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Kamu punya hak untuk menggunakan foto/video tersebut (produk milikmu, atau kamu berwenang menjualnya).</li>
          <li>Konten tidak melanggar hukum, HAKI pihak lain, atau kebijakan platform (TikTok/Shopee).</li>
          <li>Untuk klip wajah/suara di AI UGC Ads: itu adalah dirimu sendiri atau orang yang sudah memberi izin.</li>
        </ul>
        <p>
          Kami berhak menolak atau menghapus konten yang melanggar filter kata terlarang (klaim
          berlebihan, klaim medis, dsb.) sebagaimana ditegakkan otomatis oleh sistem validasi skrip kami.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">4. Konten Buatan AI</h2>
        <p>
          Video yang dihasilkan Layanan adalah konten buatan AI (AI-generated content). Setiap video
          membawa label "Dibuat dengan AI" yang tertanam permanen — dilarang menghapus, menutup dengan
          stiker, atau mengklaim video sebagai rekaman asli tanpa AI. Kamu wajib menyalakan toggle
          "Konten yang dibuat AI" saat mengunggah ke TikTok atau platform lain yang mensyaratkannya —
          ini kewajibanmu sebagai pengunggah, bukan tanggung jawab kami.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">5. Kredit & Pembayaran</h2>
        <p>
          Layanan menggunakan sistem kredit prabayar. Kredit dipakai (di-hold) saat kamu memulai
          pembuatan video, dan baru benar-benar terpakai (capture) setelah video lulus pemeriksaan
          kualitas otomatis (QC) kami. Lihat <Link href="/legal/refund" className="font-semibold text-amber-700 underline">Kebijakan Refund</Link> untuk
          detail kapan kredit dikembalikan otomatis.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">6. Batasan Layanan</h2>
        <p>
          Layanan disediakan "sebagaimana adanya". Kualitas video AI bisa bervariasi tergantung foto
          produk dan kondisi model AI pihak ketiga. Kami tidak menjamin video yang dihasilkan akan
          meningkatkan penjualanmu. Kami berhak menjeda pembuatan video baru sementara untuk
          pemeliharaan tanpa pemberitahuan lebih dulu; job yang sudah berjalan tidak terpengaruh.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">7. Penghentian Akun</h2>
        <p>
          Kami berhak menonaktifkan akun yang berulang kali mengunggah konten melanggar hukum, mencoba
          menyalahgunakan sistem kredit, atau melanggar syarat di atas.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">8. Hukum yang Berlaku</h2>
        <p>Syarat & Ketentuan ini tunduk pada hukum Republik Indonesia.</p>

        <h2 className="font-display text-lg font-bold text-zinc-900">9. Kontak</h2>
        <p>Pertanyaan seputar layanan: hdrvstudio@gmail.com.</p>
      </section>

      <div className="flex gap-4 border-t border-zinc-100 pt-4 text-sm font-semibold text-amber-700">
        <Link href="/legal/privacy">Kebijakan Privasi →</Link>
        <Link href="/legal/refund">Kebijakan Refund →</Link>
      </div>
    </main>
  );
}
