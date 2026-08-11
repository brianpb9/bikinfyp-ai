import { CAMPAIGN_TEMPLATES, type CampaignTemplate } from "./templates";
import { isServiceLike } from "./config/hooks";

// PEMILIH TEMPLATE OTOMATIS — otak di balik tombol "Bikinin aja".
//
// Ini bukan roda bantu untuk yang tidak paham. Penggunanya brand TikTok Shop
// yang justru SUDAH tahu konten itu penting — mereka tidak butuh diajari, mereka
// butuh tidak mengatur lima layar setiap kali mau bikin video. Yang dijual di
// sini KECEPATAN, bukan penyederhanaan.
//
// Karena itu tombol ini TAMBAHAN, bukan pengganti: semua pilihan manual tetap
// ada di tempatnya, dan pilihan otomatis apa pun harus bisa ditimpa. Alasan
// pemilihannya WAJIB ditampilkan — brand yang paham konten berhak tidak setuju,
// dan tidak bisa tidak setuju dengan keputusan yang tidak dijelaskan.
//
// Aturannya diambil dari tabel "PILIH TEMPLATE BERDASARKAN PRODUKMU" di
// dokumen bedah 12 video pemenang — bukan tebakan. Yang tidak bisa disimpulkan
// dari data yang kita punya (apakah produknya berbunyi, apakah variannya
// banyak) sengaja TIDAK dipakai sebagai syarat; pemilih ini hanya boleh
// bersandar pada yang benar-benar diketahui: kategori, harga, dan apakah
// produknya berwujud.
//
// TIGA TEMPLATE TIDAK PERNAH DIPILIH OTOMATIS: T05, T08, dan T10 adalah klaim
// hasil yang wajib direkam sungguhan. Mode otomatis harus menghasilkan sesuatu
// yang benar-benar bisa kita render; menawarkannya di sini sama dengan
// menjanjikan yang tidak bisa kita tepati.

export interface AutoPick {
  template: CampaignTemplate;
  /** Satu kalimat, ditampilkan ke brand. Kenapa ini yang dipilih. */
  alasan: string;
}

const byId = (id: string) => CAMPAIGN_TEMPLATES.find((t) => t.id === id)!;

/** Harga yang angkanya sendiri sudah menjual. Ambang sama dengan aturan
 *  "sebut harga hanya kalau murah" di lib/script-engine/templates.ts. */
const MURAH_IDR = 35_000;

export function pickTemplate(input: {
  category: string;
  priceIdr: number;
}): AutoPick {
  const { category, priceIdr } = input;

  // 1. Tidak punya barang fisik → tidak ada yang bisa diperagakan tangan.
  //    Formatnya wajib ads, dan yang dijual kemampuannya, bukan bendanya.
  if (isServiceLike(category)) {
    return {
      template: byId("kenalin-bisnis"),
      alasan: "Usahamu tidak menjual barang fisik, jadi yang dijual kemampuannya — presenter yang menjelaskan, bukan tangan yang memperagakan.",
    };
  }

  // 2. Harga murah → angkanya sendiri yang menjual. Aturan 3 dokumen bedah:
  //    tiga video pemenang yang menyebut harga semuanya di kisaran Rp27-30rb.
  if (priceIdr > 0 && priceIdr <= MURAH_IDR) {
    return {
      template: byId("diskon-gede"),
      alasan: `Harganya ${priceIdr.toLocaleString("id-ID")} — di angka segini harga itu sendiri yang jadi alasan orang berhenti scroll, jadi angkanya yang kita jadikan bintang.`,
    };
  }

  // 3. Sisanya ditentukan kategori, memakai baris "cocok untuk" tiap template.
  switch (category) {
    case "food":
      return {
        template: byId("t04-hook-indrawi"),
        alasan: "Makanan dan minuman menjual lewat indra. Videonya dibuka dengan menyuruh penonton mendengar, bukan melihat — itu yang memaksa mereka menyalakan suara.",
      };
    case "beauty":
      return {
        template: byId("t07-checklist-berjalan"),
        alasan: "Produk kecantikan dinilai dari klaimnya. Format ini mencentang tiap klaim tepat saat diperagakan, jadi penonton melihat daftar diselesaikan, bukan dijanjikan.",
      };
    case "fashion":
    case "muslim_fashion":
      return {
        template: byId("t06-swatch-shade"),
        alasan: "Fashion dibeli setelah orang membandingkan. Format katalog memberi tiap varian jatah waktu yang sama, dan memaksa penonton memilih.",
      };
    case "gadget":
    case "home":
    case "kitchen":
      return {
        template: byId("t02-bedah-fitur"),
        alasan: "Barangnya punya banyak bagian yang bisa dipegang dan ditekan. Satu fitur satu adegan makro — bukti fisik yang bisa dilihat, bukan diklaim.",
      };
    default:
      return {
        template: byId("racun-checkout"),
        alasan: "Belum ada yang menonjol dari kategorinya, jadi kita pakai andalan harian: dorong ke keranjang tanpa terasa memaksa.",
      };
  }
}

/** Template yang TIDAK boleh dipilih otomatis — klaim hasil, wajib rekaman
 *  asli. Diekspor supaya bisa diuji, bukan sekadar disepakati lewat komentar. */
export const TIDAK_OTOMATIS = ["t05-before-after", "t08-day-1-vs-day-7", "t10-bukti-di-lengan"];
