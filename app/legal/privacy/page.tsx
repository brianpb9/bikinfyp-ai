import Link from "next/link";

export const metadata = { title: "Kebijakan Privasi — BikinFYP.AI" };

// Draf disiapkan tim produk berdasarkan subprocessor & alur data YANG NYATA
// dipakai sistem (lihat lib/config.ts, lib/storage.ts, lib/providers/registry.ts).
// BUKAN pengganti tinjauan hukum UU PDP — isi bagian [ISI: ...] sebelum final.
export default function PrivacyPage() {
  return (
    <main className="min-h-dvh space-y-6 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Legal</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Kebijakan Privasi</h1>
        <p className="mt-1 text-xs text-zinc-500">Berlaku sejak: [ISI: tanggal] · Terakhir diperbarui: 2026-08-03</p>
      </div>

      <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4 text-xs leading-6 text-amber-900">
        Draf ini disiapkan berdasarkan alur data yang sebenarnya dipakai sistem kami. Ini{" "}
        <strong>bukan pengganti tinjauan hukum</strong> — mohon direview kuasa hukum sebelum final,
        khususnya soal kepatuhan UU Pelindungan Data Pribadi (UU PDP No. 27/2022).
      </div>

      <section className="space-y-3 text-sm leading-6 text-zinc-700">
        <h2 className="font-display text-lg font-bold text-zinc-900">1. Data yang Kami Kumpulkan</h2>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>Data akun:</strong> nomor HP atau email (untuk login), nama/foto profil Google bila kamu masuk pakai Google.</li>
          <li><strong>Data produk:</strong> nama produk, harga, kategori, foto produk, link toko (TikTok/Shopee) yang kamu masukkan.</li>
          <li><strong>Klip video pribadi:</strong> khusus fitur Video Promosi — klip talking-head yang kamu unggah sendiri.</li>
          <li><strong>Riwayat transaksi:</strong> saldo kredit, riwayat top-up dan pemakaian.</li>
          <li><strong>Log teknis:</strong> catatan aktivitas (audit log) untuk keamanan dan penelusuran masalah.</li>
        </ul>

        <h2 className="font-display text-lg font-bold text-zinc-900">2. Untuk Apa Data Dipakai</h2>
        <p>
          Semata untuk menjalankan Layanan: membuat skrip dan video AI dari data produkmu, mengirim
          kode login, memproses kredit, dan memperbaiki kualitas Layanan. Kami tidak menjual data
          pribadimu ke pihak ketiga untuk kepentingan iklan.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">3. Dibagikan ke Siapa (Subprocessor)</h2>
        <p>Untuk menjalankan Layanan, sebagian data diproses oleh pihak ketiga berikut:</p>
        <ul className="list-disc space-y-1 pl-5">
          <li><strong>BytePlus (ModelArk/Seedance):</strong> foto produk dan teks skrip dikirim untuk menghasilkan video AI. Server dapat berada di luar Indonesia.</li>
          <li><strong>ElevenLabs:</strong> teks skrip dikirim untuk menghasilkan suara AI (voice-over), khusus format VO+Foto dan Video Promosi.</li>
          <li><strong>Cloudflare (R2):</strong> penyimpanan file foto/video kamu.</li>
          <li><strong>Resend:</strong> pengiriman email kode login (OTP).</li>
          <li><strong>Google:</strong> bila kamu login pakai akun Google, kami menerima nama/email dari Google sesuai izin yang kamu berikan.</li>
          <li><strong>Midtrans:</strong> pemroses pembayaran top-up kredit (aktif setelah proses tinjauan bisnis selesai).</li>
        </ul>
        <p>Kami mewajibkan pihak ketiga ini memproses data hanya untuk keperluan menjalankan Layanan.</p>

        <h2 className="font-display text-lg font-bold text-zinc-900">4. Berapa Lama Data Disimpan</h2>
        <p>
          Data akun dan produk disimpan selama akunmu aktif. Kamu bisa minta penghapusan akun dan
          datanya kapan saja (lihat bagian Kontak) — foto/video akan dihapus dari penyimpanan kami,
          kecuali catatan yang wajib disimpan untuk kepatuhan hukum/pajak.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">5. Hak Kamu</h2>
        <p>
          Sesuai UU PDP, kamu berhak meminta salinan datamu, memperbaiki data yang salah, dan meminta
          penghapusan data pribadimu dari sistem kami, kecuali yang wajib disimpan secara hukum.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">6. Keamanan</h2>
        <p>
          Kami memakai koneksi terenkripsi (HTTPS) dan kontrol akses untuk melindungi datamu. Tidak
          ada sistem yang 100% aman, tapi kami berusaha menjaga datamu sebaik mungkin.
        </p>

        <h2 className="font-display text-lg font-bold text-zinc-900">7. Anak-anak</h2>
        <p>Layanan ini untuk pelaku usaha berusia 18 tahun ke atas, bukan untuk anak-anak.</p>

        <h2 className="font-display text-lg font-bold text-zinc-900">8. Kontak</h2>
        <p>Pertanyaan atau permintaan soal data pribadimu: [ISI: email/WhatsApp support].</p>
      </section>

      <div className="flex gap-4 border-t border-zinc-100 pt-4 text-sm font-semibold text-amber-700">
        <Link href="/legal/terms">Syarat & Ketentuan →</Link>
        <Link href="/legal/refund">Kebijakan Refund →</Link>
      </div>
    </main>
  );
}
