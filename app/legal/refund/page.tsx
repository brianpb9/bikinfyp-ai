import Link from "next/link";

export const metadata = { title: "Kebijakan Refund — BikinFYP.AI" };

// Draf disiapkan tim produk berdasarkan mekanisme hold/capture/release kredit
// YANG NYATA berjalan di sistem (lib/credits.ts, QC otomatis di lib/media/qc.ts).
// BUKAN pengganti tinjauan hukum — isi bagian [ISI: ...] sebelum final.
export default function RefundPage() {
  return (
    <main className="min-h-dvh space-y-6 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Legal</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Kebijakan Refund</h1>
        <p className="mt-1 text-xs text-zinc-500">Berlaku sejak: 2026-08-03 · Terakhir diperbarui: 2026-08-03</p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        Draf ini menjelaskan mekanisme kredit yang benar-benar berjalan di sistem kami —{" "}
        <strong>bukan pengganti tinjauan hukum.</strong>
      </div>

      <section className="space-y-3 text-sm leading-6 text-zinc-700">
        <h2 className="font-display text-lg font-bold text-zinc-900">1. Cara Kerja Kredit</h2>
        <p>
          Saat kamu mulai membuat video, kredit sebesar harga paket <strong>ditahan (hold)</strong> dari
          saldomu — belum benar-benar terpakai. Kredit baru resmi terpakai (capture) setelah videomu
          <strong> lulus pemeriksaan kualitas otomatis (QC)</strong> kami dan berhasil dibuat.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">2. Refund Otomatis</h2>
        <p>Kredit yang ditahan otomatis dikembalikan penuh ke saldomu, tanpa perlu kamu minta, kalau:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li>Video gagal lulus pemeriksaan kualitas otomatis (misalnya identitas produk tidak konsisten, ada masalah audio, dsb).</li>
          <li>Terjadi kegagalan teknis di sistem kami saat memproses videomu.</li>
        </ul>
        <p>
          Kalau ini terjadi, kamu akan lihat pesan "kredit sudah kami balikin" dan saldomu kembali
          seperti semula — kamu bisa coba lagi (misalnya pakai foto produk yang berbeda) tanpa
          kehilangan kredit.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">3. Kredit yang Sudah Terpakai (Capture)</h2>
        <p>
          Kalau video sudah berhasil dibuat dan lulus QC, kredit yang terpakai untuk video itu{" "}
          <strong>tidak bisa direfund</strong> — sama seperti kamu sudah menerima layanan yang kamu
          bayar. Ini berlaku walau kamu merasa hasilnya kurang cocok secara selera (misalnya suara/gaya
          kreator), karena itu di luar pemeriksaan kualitas otomatis yang bisa kami ukur.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">4. Kredit Tidak Kadaluarsa</h2>
        <p>Kredit yang kamu beli tidak punya masa berlaku — bisa dipakai kapan saja.</p>

        <h2 className="font-display text-lg font-bold text-zinc-900">5. Refund Top-up (Uang ke Rekening)</h2>
        <p>
          Karena kredit yang belum terpakai tidak hilang (poin 4), kami tidak menyediakan refund uang
          tunai untuk top-up yang belum dipakai, kecuali diwajibkan oleh hukum yang berlaku atau atas
          kebijakan kami dalam kasus tertentu (misalnya kesalahan sistem pada saat pembayaran).
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">6. Kontak Soal Refund</h2>
        <p>
          Kalau ada transaksi yang menurutmu janggal (misalnya kredit terpotong tapi video tidak
          pernah muncul), hubungi hdrvstudio@gmail.com dengan menyertakan ID video/transaksi.
        </p>
      </section>

      <div className="flex gap-4 border-t border-zinc-100 pt-4 text-sm font-semibold text-amber-700">
        <Link href="/legal/terms">Syarat & Ketentuan →</Link>
        <Link href="/legal/privacy">Kebijakan Privasi →</Link>
      </div>
    </main>
  );
}
