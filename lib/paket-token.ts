/**
 * KATALOG PAKET TOKEN — satu sumber, dibaca UI dan server.
 *
 * Sebelumnya daftar paket hidup di komponen klien saja, dan rute pengajuan
 * menyimpan HARGA KIRIMAN KLIEN sebagai fakta. Board review 19 Agu menandainya:
 * siapa pun bisa mengirim {paket:"scale", harga_idr: 1} dan angka itulah yang
 * sampai ke tim penjualan. Harga yang menjadi dasar tagihan tidak boleh pernah
 * berasal dari klien.
 *
 * Angka-angka ini masih PENAWARAN early access (belum dikunci Brian) — tapi
 * penawaran pun harus punya satu sumber.
 */
export interface PaketToken {
  id: string;
  jenis: "subscription" | "topup";
  label: string;
  priceIdr: number;
  tokenIdr: number;
}

export const PAKET_TOKEN: readonly PaketToken[] = [
  { id: "starter", jenis: "subscription", label: "Starter", priceIdr: 490_000, tokenIdr: 600_000 },
  { id: "growth", jenis: "subscription", label: "Growth", priceIdr: 1_900_000, tokenIdr: 2_500_000 },
  { id: "scale", jenis: "subscription", label: "Scale", priceIdr: 4_900_000, tokenIdr: 7_000_000 },
  { id: "t1", jenis: "topup", label: "Top-up Rp250.000", priceIdr: 250_000, tokenIdr: 250_000 },
  { id: "t2", jenis: "topup", label: "Top-up Rp500.000", priceIdr: 500_000, tokenIdr: 550_000 },
  { id: "t3", jenis: "topup", label: "Top-up Rp1.000.000", priceIdr: 1_000_000, tokenIdr: 1_150_000 },
  { id: "t4", jenis: "topup", label: "Top-up Rp2.500.000", priceIdr: 2_500_000, tokenIdr: 3_000_000 },
] as const;

export function paketById(id: string): PaketToken | undefined {
  return PAKET_TOKEN.find((p) => p.id === id);
}
