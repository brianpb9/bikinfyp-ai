import Image from "next/image";

/**
 * Logo AIUGC.ID — satu komponen, satu berkas gambar.
 *
 * ---------------------------------------------------------------------------
 * KENAPA KOMPONEN, BUKAN <img> DI TIAP HALAMAN
 * ---------------------------------------------------------------------------
 * Sebelum ini logonya berupa TEKS yang diketik ulang di enam tempat, dan
 * bunyinya "AIUGC.ID AI" — terbaca berulang ("AI-UGC-ID AI") karena huruf AI
 * sudah ada di dalam nama mereknya. Enam salinan berarti enam peluang untuk
 * menyimpang, dan penggantian merek sebelumnya membuktikan itu bukan
 * kekhawatiran teoretis: dua halaman tertinggal saat namanya berubah.
 *
 * ---------------------------------------------------------------------------
 * KENAPA UKURANNYA DITULIS EKSPLISIT
 * ---------------------------------------------------------------------------
 * Rasio asli logonya 2037x600 (3.395:1). Tinggi ditentukan pemanggil, lebar
 * dihitung dari rasio itu — bukan ditebak — supaya logonya tidak pernah
 * gepeng atau melar. Menyerahkan lebar ke CSS membuat teks di sebelahnya
 * bergeser saat gambar selesai dimuat (layout shift), dan itu terlihat murah
 * di layar pertama yang dilihat calon pembeli.
 */
const RASIO = 2037 / 600;

export function Logo({ tinggi = 28, className = "" }: { tinggi?: number; className?: string }) {
  return (
    <Image
      src="/brand/logo-horizontal.png"
      alt="AIUGC.ID"
      width={Math.round(tinggi * RASIO)}
      height={tinggi}
      // Logo header dan hero ada di layar pertama — memuatnya malas justru
      // membuat kekosongan di tempat yang paling diperhatikan.
      priority
      className={className}
    />
  );
}
