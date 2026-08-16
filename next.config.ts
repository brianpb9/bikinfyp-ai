import type { NextConfig } from "next";

// Header keamanan. Diperiksa di produksi 2026-08-12 dan hasilnya NOL — tidak
// ada satu pun dari ini terkirim, padahal "Security Header" ada di daftar
// pengetatan yang diminta Brian. Ditambahkan di sini, bukan di middleware,
// supaya ikut ke SEMUA respons termasuk berkas statis dan halaman error yang
// tidak melewati middleware.
//
// CSP SUDAH DIPASANG (17 Agu 2026) — lihat arahannya di bawah. Komentar ini
// sempat menyatakan sebaliknya SETELAH CSP-nya ada, dan komentar yang
// bertentangan dengan kodenya lebih buruk daripada tidak ada komentar: ia
// membuat pembaca berikutnya mengambil keputusan dari kenyataan yang salah.
//
// Kekhawatiran aslinya tetap benar dan tetap dihormati: Next menyuntikkan
// skrip inline, jadi script-src memakai 'unsafe-inline' alih-alih nonce.
// Artinya CSP ini TIDAK menutup XSS inline — batas itu ditulis lagi di bawah,
// tepat di sebelah arahannya.
const securityHeaders = [
  // Paksa HTTPS setahun. Domain sudah HTTPS penuh di Render, jadi ini tidak
  // mengunci apa pun yang belum terkunci.
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  // Jangan menebak tipe berkas. Tanpa ini, unggahan yang isinya HTML bisa
  // dieksekusi browser sebagai halaman, bukan diunduh sebagai berkas.
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Anti clickjacking: dashboard tidak boleh dibingkai situs lain. Brand
  // menekan "Setujui & Render" di sini — tombol yang bisa dibingkai bisa
  // ditekan tanpa mereka sadari.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Tidak ada fitur perangkat yang kita pakai. Menutupnya berarti skrip pihak
  // ketiga yang lolos pun tidak bisa menyalakan kamera atau mikrofon.
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  // Content-Security-Policy.
  //
  // Aplikasi ini SELF-CONTAINED: next/font/google mengunduh fontnya saat build
  // lalu menyajikannya dari domain sendiri, tidak ada images.remotePatterns,
  // dan tidak ada skrip pihak ketiga di layout. Karena itu 'self' bisa jadi
  // bawaan yang ketat tanpa merusak apa pun.
  //
  // BATASNYA HARUS DIKATAKAN APA ADANYA: script-src memakai 'unsafe-inline'
  // karena Next menyuntikkan skrip bootstrap inline dan repo ini belum punya
  // infrastruktur nonce per-permintaan. Jadi CSP ini TIDAK menghentikan XSS
  // yang berhasil menyuntik skrip inline. Yang ia hentikan tetap banyak dan
  // nyata: memuat skrip dari domain luar, menyematkan objek/plugin, membajak
  // <base>, dan yang paling penting untuk aplikasi berisi saldo dan token —
  // form-action 'self' membuat data tidak bisa dikirim ke server penyerang,
  // dan connect-src 'self' menutup eksfiltrasi lewat fetch.
  //
  // Naik ke nonce adalah pekerjaan tersendiri; menuliskannya di sini supaya
  // tidak ada yang mengira CSP ini sudah menutup XSS.
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'",
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data: blob:",
      "media-src 'self' blob:",
      "font-src 'self'",
      "connect-src 'self'",
      "worker-src 'self' blob:",
      "manifest-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
      "upgrade-insecure-requests",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // Queue client is server-only. Externalizing it avoids bundling BullMQ's
  // optional Valkey client into the Next web artifact.
  serverExternalPackages: ["better-sqlite3", "bullmq"],
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
