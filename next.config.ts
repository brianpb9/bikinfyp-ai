import type { NextConfig } from "next";

// Header keamanan. Diperiksa di produksi 2026-08-12 dan hasilnya NOL — tidak
// ada satu pun dari ini terkirim, padahal "Security Header" ada di daftar
// pengetatan yang diminta Brian. Ditambahkan di sini, bukan di middleware,
// supaya ikut ke SEMUA respons termasuk berkas statis dan halaman error yang
// tidak melewati middleware.
//
// CSP SENGAJA BELUM DIPASANG. Next.js menyuntikkan skrip dan gaya inline;
// CSP yang salah akan mematikan seluruh aplikasi, dan itu lebih berbahaya
// daripada tidak punya CSP. Perlu dipasang report-only dulu, diamati, baru
// ditegakkan — pekerjaan tersendiri, bukan tempelan.
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
