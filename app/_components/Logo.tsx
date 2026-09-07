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

/**
 * Kunci-mati brand: logo + kata "Brands" di sebelahnya.
 *
 * ---------------------------------------------------------------------------
 * KENAPA TULISANNYA DIPERTAHANKAN, BUKAN DIGANTI GAMBAR JUGA
 * ---------------------------------------------------------------------------
 * Permintaan Brian 7 Sep 2026: "sisakan tulisan brand setelah image supaya
 * terlihat signifikan perbedaannya".
 *
 * Alasannya benar dan layak dicatat: retail dan brand memakai logo yang SAMA
 * PERSIS. Kalau sisi brand cuma menampilkan logo itu, tidak ada satu pun
 * penanda di layar yang memberi tahu orang ia sedang berada di produk yang
 * berbeda — dan dua produk dengan harga, mata uang, dan alur pendaftaran yang
 * berbeda terlihat seperti satu. Katanya yang membedakan, bukan gambarnya.
 *
 * Warnanya diserahkan pemanggil: kunci-mati ini dipakai di atas putih (halaman
 * depan brand) DAN di atas gelap (sidebar dashboard). Satu warna tetap akan
 * hilang di salah satunya.
 */
export function LogoBrands({
  tinggi = 26,
  warnaKata = "text-amber-500",
  className = "",
}: {
  tinggi?: number;
  warnaKata?: string;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2 ${className}`}>
      <Logo tinggi={tinggi} />
      {/* Ukurannya diikatkan ke tinggi logo, bukan diketik terpisah: kalau
          logonya diperbesar dan katanya tidak, kunci-matinya jadi timpang. */}
      <span
        className={`font-display font-bold tracking-tight ${warnaKata}`}
        style={{ fontSize: Math.round(tinggi * 0.72), lineHeight: 1 }}
      >
        Brands
      </span>
    </span>
  );
}
