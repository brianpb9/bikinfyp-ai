import { Film } from "lucide-react";
import { createSignedUrl } from "@/lib/signed-url";

// Gambar kartu kampanye, dipakai bersama oleh Beranda dan Proyek.
//
// Dulu blok ini disalin di kedua halaman, dan itu persis yang membuat bug
// "kartu hitam" hanya terperbaiki di satu tempat: thumb_key cuma ada untuk job
// yang melewati gerbang tinjau scene, jadi kampanye yang sudah SELESAI tanpa
// gerbang itu tetap tampil kotak hitam. Urutan cadangannya sekarang satu:
//
//   1. thumb_key  — frame scene pertama, paling murah dan paling representatif
//   2. video_key  — frame pertama video jadinya sendiri (preload metadata saja)
//   3. ikon       — benar-benar belum ada apa pun untuk ditampilkan
export function CampaignThumb({
  thumbKey,
  videoKey,
}: {
  thumbKey: string | null;
  videoKey: string | null;
}) {
  if (thumbKey) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={createSignedUrl(thumbKey)}
        alt=""
        className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
      />
    );
  }
  if (videoKey) {
    return (
      <video
        src={createSignedUrl(videoKey)}
        preload="metadata"
        muted
        playsInline
        className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
      />
    );
  }
  return (
    <div className="flex h-full w-full items-center justify-center text-zinc-700">
      <Film size={26} />
    </div>
  );
}
