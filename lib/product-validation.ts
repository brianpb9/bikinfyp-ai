/** Validasi input produk yang dipakai route create dan edit. */
export function validProductName(value: unknown): string | null {
  const name = String(value ?? "").trim();
  if (!name || name.length > 160 || !/[\p{L}\p{N}]/u.test(name)) return null;
  return name;
}

/** Harga hanya menerima bilangan rupiah positif utuh, tanpa sufiks/teks. */
export function validPriceIdr(value: unknown): number | null {
  const text = typeof value === "number" ? String(value) : String(value ?? "").trim();
  if (!/^[1-9]\d{0,8}$/.test(text)) return null;
  const price = Number(text);
  return Number.isSafeInteger(price) ? price : null;
}
