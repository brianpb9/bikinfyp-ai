import type { Metadata, Viewport } from "next";
import { Inter, Sora } from "next/font/google";
import "./globals.css";
import { SiteChrome } from "./_components/SiteChrome";

const inter = Inter({ subsets: ["latin"], variable: "--font-inter" });
const sora = Sora({ subsets: ["latin"], variable: "--font-sora", weight: ["600", "700", "800"] });

export const metadata: Metadata = {
  title: "AIUGC.ID — Video jualan tanpa syuting",
  description: "Bikin video jualan 15 detik dari foto produk. Bahasa Indonesia, dengan label AIGC untuk membantu mengikuti aturan konten AI TikTok.",
  manifest: "/manifest.json",
  // KARTU SOSIAL (board review 20 Agu). Sebelumnya tidak ada satu pun tag
  // openGraph/twitter — dan distribusi utama produk ini adalah WhatsApp dan
  // bio TikTok, tempat tautan tanpa kartu muncul sebagai URL telanjang.
  // Untuk produk web, itu setara memasang etalase kosong di jalan paling ramai.
  //
  // metadataBase wajib: tanpanya Next merender URL gambar relatif, dan
  // pengurai kartu (WhatsApp) menolaknya.
  // ALAMAT MASIH DOMAIN LAMA, DAN ITU DISENGAJA.
  //
  // Nama merek sudah AIUGC.ID di seluruh layar dan email, tapi alamatnya belum
  // boleh ikut: diperiksa 4 Sep 2026, aiugc.id menunjuk 104.21.0.184 /
  // 172.67.128.48 (Cloudflare) sementara server ini 187.77.148.89, dan
  // https://aiugc.id belum menjawab sama sekali.
  //
  // metadataBase dan og:url menjadi alamat kanonik yang dibagikan dan
  // di-crawl. Mengarahkannya ke domain yang belum hidup berarti setiap tautan
  // yang dibagikan pembeli menuju halaman mati — lebih buruk daripada nama
  // domain lama yang masih berfungsi.
  //
  // Pergantiannya satu baris di sini plus APP_BASE_URL, begitu DNS menunjuk
  // server ini dan sertifikatnya terbit.
  metadataBase: new URL("https://bikinfyp.com"),
  openGraph: {
    type: "website",
    siteName: "AIUGC.ID",
    locale: "id_ID",
    title: "AIUGC.ID — Video jualan tanpa syuting",
    // Angka harga SENGAJA tidak ada di sini. Metadata layout bersifat statis
    // dan berlaku untuk seluruh situs, sementara harga per video kini diatur
    // admin tanpa deploy — menuliskannya berarti menyiarkan angka yang cepat
    // atau lambat berbeda dari yang ditagih. Harga hidup ada di /harga.
    description: "Bikin video jualan 15 detik dari foto produk. Bayar per video, tanpa langganan.",
    url: "https://bikinfyp.com",
    images: [{ url: "/icons/icon-512.png", width: 512, height: 512, alt: "AIUGC.ID" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "AIUGC.ID — Video jualan tanpa syuting",
    // Angka harga SENGAJA tidak ada di sini. Metadata layout bersifat statis
    // dan berlaku untuk seluruh situs, sementara harga per video kini diatur
    // admin tanpa deploy — menuliskannya berarti menyiarkan angka yang cepat
    // atau lambat berbeda dari yang ditagih. Harga hidup ada di /harga.
    description: "Bikin video jualan 15 detik dari foto produk. Bayar per video, tanpa langganan.",
    images: ["/icons/icon-512.png"],
  },
  icons: {
    icon: [
      { url: "/icons/icon-32.png", sizes: "32x32", type: "image/png" },
      { url: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { url: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  // maximumScale: 1 DIHAPUS. Ia memblokir pinch-zoom, jadi siapa pun yang perlu
  // memperbesar teks — mata lelah, layar kecil, penglihatan terbatas — tidak
  // bisa. Alasan aslinya biasanya mencegah iOS melompat-zoom saat fokus ke
  // input, tapi itu diselesaikan dengan ukuran font input >=16px, bukan dengan
  // mencabut zoom dari semua orang (temuan aksesibilitas audit QA 16 Agu 2026).
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="id" className={`${inter.variable} ${sora.variable}`}>
      <body className="bg-zinc-100 text-zinc-900 antialiased">
        <SiteChrome>{children}</SiteChrome>
      </body>
    </html>
  );
}
