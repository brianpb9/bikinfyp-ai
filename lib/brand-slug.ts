/**
 * Slug organisasi brand dari namanya.
 *
 * TINGGAL DI lib/, BUKAN DI BERKAS ROUTE. Next.js hanya mengizinkan handler dan
 * beberapa field konfigurasi diekspor dari berkas route di dalam app/ — ekspor
 * lain menggagalkan build dengan "is not a valid Route export field". Ketahuan
 * saat build, bukan saat typecheck.
 */
export function slugBrand(nama: string): string {
  return nama
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}
