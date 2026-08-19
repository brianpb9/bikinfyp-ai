/** Validasi input produk yang dipakai route create dan edit. */
export function validProductName(value: unknown): string | null {
  const name = String(value ?? "").trim();
  if (!name || name.length > 160 || !/[\p{L}\p{N}]/u.test(name)) return null;
  return name;
}

/**
 * Merek dari intake (audit C9, 19 Agu): dikonfirmasi PENGGUNA, bukan tebakan.
 * Disimpan di raw_meta.brand — alamat fallback yang sudah dibaca merekTepercaya()
 * di worker — sampai kolom products.brand (migrasi 0033, dimiliki sesi lain)
 * di-land; setelah itu raw_meta.brand tetap sah sebagai fallback.
 * Kosong/null = tidak ada merek tepercaya; gerbang QC-F1 tetap UNVERIFIED
 * (fail-honest). Panjang dibatasi: merek adalah token label, bukan kalimat.
 */
export function validBrand(value: unknown): string | null {
  const brand = String(value ?? "").trim().slice(0, 60);
  if (!brand || !/[\p{L}\p{N}]/u.test(brand)) return null;
  return brand;
}

/** Harga hanya menerima bilangan rupiah positif utuh, tanpa sufiks/teks. */
export function validPriceIdr(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^[1-9]\d{0,8}$/.test(text)) return null;
  const price = Number(text);
  return Number.isSafeInteger(price) ? price : null;
}
