import { NAMA_PLATFORM_PANJANG } from "./identitas-platform";
// Identitas & kontak merchant — SATU sumber untuk footer, halaman /kontak, dan
// halaman legal. Reviewer gateway pembayaran (temuan onboarding Duitku,
// 2026-08-19) mensyaratkan telepon, email, dan alamat terlihat di website;
// dua salinan yang harus dijaga sama selamanya cepat atau lambat berbeda.
// Identitas badan usaha mengikuti form registrasi Duitku (keputusan Brian,
// 2026-08-19): PT Bastara Capital Asia, nama merchant HDRV Studio. Telepon =
// nomor di form registrasi; WhatsApp = kanal dukungan operasional.
export const KONTAK = {
  produk: NAMA_PLATFORM_PANJANG,
  usaha: "PT Bastara Capital Asia (HDRV Studio)",
  email: "hdrvstudio@gmail.com",
  teleponTampil: "+62 816-300-592",
  teleponTel: "+62816300592",
  whatsappTampil: "+62 817-0261-628",
  whatsapp: "628170261628",
  alamat:
    "Jl. Kebon Kacang 29 No.2A, Kel. Kebon Kacang, Kec. Tanah Abang, Kota Adm. Jakarta Pusat, DKI Jakarta 10240",
  jamLayanan: "Senin–Sabtu, 09.00–18.00 WIB",
} as const;
