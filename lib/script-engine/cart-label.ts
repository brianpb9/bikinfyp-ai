/**
 * Label keranjang — dipisah dari index.ts supaya admisi.ts bisa memakainya
 * tanpa membuat lingkaran impor (index -> admisi -> index).
 *
 * index.ts tetap mengekspornya ulang, jadi tidak ada pemanggil yang berubah.
 */

/** "Keranjang kuning" cuma istilah TikTok Shop — Shopee/Tokopedia/manual pakai
 * "keranjang" polos (keputusan Brian, 2026-08-03: platform lain jangan
 * dibilang "kuning", itu branding TikTok doang). */
export function cartLabelForUrl(sourceUrl: string | null | undefined): "keranjang kuning" | "keranjang" {
  if (!sourceUrl) return "keranjang";
  try {
    const host = new URL(sourceUrl).hostname.toLowerCase();
    if (host === "tiktok.com" || host.endsWith(".tiktok.com")) return "keranjang kuning";
  } catch {
    /* URL tidak valid — default aman: istilah generik */
  }
  return "keranjang";
}
