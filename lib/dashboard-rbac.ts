/**
 * Siapa boleh MEMBELANJAKAN saldo organisasi, dan siapa boleh MENYETUJUI
 * naskah atas nama merek.
 *
 * Sampai sekarang jawabannya "siapa saja". Kolom role sudah ada sejak M1 tapi
 * komentarnya sendiri menyatakan ia "HANYA label, TIDAK PERNAH dicek untuk
 * otorisasi" — RBAC ditunda ke v2. Yang tidak ikut ditunda adalah uangnya:
 * anggota mana pun bisa menekan render dan memotong saldo bersama, termasuk
 * orang yang baru diundang lima menit lalu.
 *
 * Model ini sengaja KECIL. Dua kemampuan, dua peran, tidak ada matriks izin
 * yang harus dipelajari orang. Menambah peran baru nanti mudah; membatalkan
 * uang yang sudah terbakar tidak.
 *
 *   owner  — boleh membelanjakan dan menyetujui naskah
 *   member — boleh menyiapkan produk, membuat naskah, dan melihat hasil
 *
 * Membuat naskah TIDAK memotong saldo (gerbang HITL memisahkan keduanya
 * dengan sengaja), jadi member tetap bisa mengerjakan bagian terbesar
 * pekerjaannya. Yang dijaga hanya langkah terakhir yang memindahkan uang.
 */
import { ERR } from "./errors";

export type PeranOrg = "owner" | "member";

/** Membelanjakan saldo organisasi: render berbayar, matriks, regenerasi scene. */
export function bolehBelanja(role: string): boolean {
  return role === "owner";
}

/**
 * Menyetujui naskah AI atas nama merek (gerbang HITL, aturan keras #5).
 *
 * Digabung dengan hak belanja BUKAN karena keduanya sama, tetapi karena di
 * produk ini persetujuan naskah adalah langkah yang MEMICU belanja. Memisahkan
 * keduanya sekarang akan menghasilkan peran yang boleh menyetujui tapi tidak
 * boleh membayar — dan itu bukan pembatasan, itu kebingungan.
 */
export function bolehSetujuiNaskah(role: string): boolean {
  return role === "owner";
}

/** Lempar 403 yang menjelaskan diri, bukan sekadar "akses ditolak". */
export function pastikanBolehBelanja(role: string): void {
  if (bolehBelanja(role)) return;
  throw ERR.FORBIDDEN(
    "Cuma pemilik organisasi yang bisa menjalankan render berbayar. Kamu masih bisa menyiapkan produk dan membuat naskahnya — minta pemilik menekan tombol terakhirnya.",
    "Spending requires the organization owner role."
  );
}

/**
 * Produk milik ORGANISASI tidak boleh dikerjakan lewat API retail.
 *
 * Celah governance yang nyata: anggota organisasi membuat produk di dashboard
 * (baris produknya membawa org_id, dan user_id-nya dia sendiri), lalu memanggil
 * /api/jobs atau /api/scripts/[id]/approve — API retail mengambil produk itu
 * HANYA dengan user_id, tidak pernah melihat org_id, dan merendernya dari
 * dompet PRIBADI.
 *
 * Saldo organisasi memang tidak terkuras, jadi mudah dikira tidak berbahaya.
 * Yang bocor bukan uangnya melainkan TATA KELOLANYA: RBAC belanja dilewati,
 * gerbang review scene brand dilewati, dan hasilnya keluar dari library
 * organisasi — merek kehilangan jejak video yang dibuat atas namanya sendiri.
 *
 * Jalur retail dan jalur organisasi karena itu dipisah tegas: produk yang
 * punya org_id hanya boleh lewat konteks organisasi.
 */
export function pastikanBukanProdukOrg(product: { org_id?: string | null } | null | undefined): void {
  if (!product?.org_id) return;
  throw ERR.FORBIDDEN(
    "Produk ini milik organisasi, jadi pembuatan videonya lewat dashboard — bukan dari sini.",
    "Organization-owned products must go through the org dashboard (RBAC + brand review)."
  );
}
