/**
 * Satu tempat yang membangun string cookie.
 *
 * Sebelum ini atribut cookie diketik ulang di ENAM tempat (dev-login,
 * verify-otp, callback Google, route Google, logout, events), dan tidak satu
 * pun memakai `Secure`. Token sesi tanpa `Secure` boleh dikirim browser lewat
 * HTTP polos — cukup satu permintaan yang tidak terenkripsi untuk membocorkan
 * seluruh sesi, dan HSTS tidak menolong pada kunjungan pertama sebelum
 * headernya pernah diterima.
 *
 * Menyalin string enam kali juga melahirkan masalah kedua yang komentarnya
 * sudah ada di app/api/auth/logout: cookie hanya bisa DIHAPUS dengan atribut
 * yang sama persis seperti saat dipasang. Satu huruf berbeda dan browser
 * menyimpan cookie lama — logout yang terlihat berhasil padahal sesinya masih
 * hidup. Helper ini membuat kedua sisi mustahil menyimpang.
 */
import { config } from "./config";

/**
 * `Secure` menempel HANYA saat aplikasi memang dilayani lewat HTTPS.
 *
 * Diturunkan dari APP_BASE_URL, bukan dari header permintaan: header bisa
 * dipalsukan, konfigurasi deploy tidak. Pengembangan lokal di http://localhost
 * tetap jalan karena URL-nya memang bukan https — bukan karena ada pengecualian
 * yang ditulis khusus untuk mematikannya.
 */
export function cookieAman(): boolean {
  return config.appBaseUrl.startsWith("https://");
}

function rakit(nama: string, nilai: string, opsi: { maxAge: number; sameSite?: "Lax" | "Strict" }): string {
  const bagian = [
    `${nama}=${nilai}`,
    "Path=/",
    "HttpOnly",
    `SameSite=${opsi.sameSite ?? "Lax"}`,
    `Max-Age=${opsi.maxAge}`,
  ];
  if (cookieAman()) bagian.push("Secure");
  return bagian.join("; ");
}

/** Cookie sesi login. */
export function cookieSesi(nama: string, token: string, maxAgeSec: number): string {
  return rakit(nama, encodeURIComponent(token), { maxAge: maxAgeSec });
}

/** Penghapus cookie sesi — atribut WAJIB identik dengan cookieSesi. */
export function cookieHapus(nama: string): string {
  return rakit(nama, "", { maxAge: 0 });
}

/** Cookie state OAuth: umur pendek, sekali pakai. */
export function cookieState(nama: string, nilai: string, maxAgeSec: number): string {
  return rakit(nama, nilai, { maxAge: maxAgeSec });
}

/**
 * Cookie identitas anonim untuk analitik. BUKAN HttpOnly-nya yang berbeda —
 * yang berbeda cuma bahwa ia tidak membawa kewenangan apa pun. Tetap Secure
 * di produksi supaya tidak jadi penanda yang bisa dibaca di jaringan terbuka.
 */
export function cookieAnon(nama: string, nilai: string, maxAgeSec: number): string {
  const bagian = [`${nama}=${nilai}`, "Path=/", `SameSite=Lax`, `Max-Age=${maxAgeSec}`];
  if (cookieAman()) bagian.push("Secure");
  return bagian.join("; ");
}
