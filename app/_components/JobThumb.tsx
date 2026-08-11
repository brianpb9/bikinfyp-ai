"use client";

// Gambar kecil satu job di daftar riwayat — dipakai Beranda dan halaman Video.
//
// SENGAJA SATU KOMPONEN. Sebelumnya markup yang sama disalin di dua halaman,
// dan akibatnya nyata: waktu thumbnail diperbaiki, perbaikannya hanya mendarat
// di satu halaman dan yang satunya tetap rusak. Kalau nanti perlu diubah lagi,
// ubah di sini saja.
//
// Yang ditampilkan adalah VIDEO HASILNYA, bukan foto produk. Satu produk bisa
// dipakai untuk banyak video, jadi foto produk membuat seluruh riwayat tampak
// kembar dan yang pertama dilihat pengguna justru bahan mentah, bukan hasil.
// preload="metadata" membuat browser hanya menarik frame pertama, bukan seluruh
// berkas — hemat kuota tetap terjaga, dan itulah alasan asli memakai foto dulu.

interface Props {
  preview_url: string | null;
  thumb_url: string | null;
  alt: string;
  className?: string;
}

export function JobThumb({ preview_url, thumb_url, alt, className = "" }: Props) {
  if (preview_url) {
    return (
      <video
        src={`${preview_url}#t=0.1`}
        className={`h-full w-full object-cover ${className}`}
        preload="metadata"
        muted
        playsInline
        // Tanpa ini iOS Safari menampilkan kotak hitam sampai video disentuh:
        // ia tidak menggambar frame apa pun sebelum ada permintaan waktu, dan
        // #t=0.1 di atas yang memaksanya mencari frame pertama.
        controls={false}
      />
    );
  }
  if (thumb_url) {
    // Cadangan: job belum selesai, jadi belum ada video. Foto produk lebih baik
    // daripada kotak kosong karena pengguna masih bisa mengenali barangnya.
    // eslint-disable-next-line @next/next/no-img-element
    return <img src={thumb_url} alt={alt} className={`h-full w-full object-cover ${className}`} loading="lazy" decoding="async" />;
  }
  return <div className="flex h-full w-full items-center justify-center text-xl">📦</div>;
}
