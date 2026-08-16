/**
 * Perangkat retoris untuk hook.
 *
 * MASALAH YANG DIPECAHKAN. Vonis Brian 16 Agu 2026: "skripnya sama semua
 * membosankan — ini masalah 99%". Setelah katalog dirapikan, jumlah kalimat unik
 * sudah tidak jadi soal (132 hook, semuanya berbeda). Yang tersisa terukur di
 * bentuknya: 57 dari 132 hook (43%) tidak memakai SATU PUN perangkat retoris —
 * cuma deskripsi datar "produk ini punya anu". Pertanyaan cuma 11%, kontras
 * harga 5%, segmentasi audiens 3%.
 *
 * Kalimat boleh 132 macam; kalau bentuknya sama semua, penonton tetap merasa
 * menonton video yang itu-itu juga.
 *
 * SUMBER DAN BATASNYA. Taksonomi di bawah disarikan dari bab hook jualan buku
 * "Mega Hook" (Samuel Christ, Seefluencer 2025) yang dikirim Brian. Buku itu
 * BERHAK CIPTA dan melarang penggunaan komersial isinya, sedangkan BikinFYP
 * produk komersial. Jadi yang diambil hanya PERANGKATNYA — mekanisme retoris
 * yang umum dipakai periklanan jauh sebelum buku itu terbit, dan ide/metode
 * memang tidak dilindungi hak cipta. Seluruh kalimat contoh di file ini ditulis
 * sendiri; tidak ada satu pun frasa yang disalin dari sana.
 *
 * Kebetulan itu juga satu-satunya cara yang berguna: kalimat jadi tidak bisa
 * dipakai generator yang produknya ditentukan pengguna. Yang bisa dipakai ulang
 * cuma polanya.
 */

import type { TemplateCtx } from "./templates";

export type PerangkatHook =
  | "pertanyaan-kesal"
  | "kontras-harga"
  | "subversi-kategori"
  | "segmentasi-audiens"
  | "larangan-terbalik"
  | "pembalikan-ekspektasi"
  | "ganti-kebiasaan"
  | "pengakuan-jujur"
  | "banding-kelas-atas"
  | "penemuan-setelah-gagal";

export interface Perangkat {
  nama: PerangkatHook;
  /** Mekanisme psikologisnya, satu kalimat. */
  cara: string;
  /** Kapan perangkat ini TIDAK cocok — sama pentingnya dengan kapan cocok. */
  hindari: string;
  /** Contoh orisinal, ditulis untuk file ini. */
  contoh: (c: TemplateCtx) => string;
}

export const PERANGKAT_HOOK: Perangkat[] = [
  {
    nama: "pertanyaan-kesal",
    cara: "Menyebut kekesalan yang sudah dialami penonton, sebagai pertanyaan — dia mengangguk sebelum sempat menilai produknya.",
    hindari: "Produk yang tidak menyelesaikan keluhan apa pun; pertanyaannya akan terasa dibuat-buat.",
    contoh: (c) => `Capek nggak sih tiap kali ${c.pain} balik lagi padahal baru kemarin diurus?`,
  },
  {
    nama: "kontras-harga",
    cara: "Menaruh harga bersebelahan dengan mutu yang tidak diduga di harga itu; jarak keduanya yang menahan penonton.",
    hindari: "Produk premium yang justru dijual lewat gengsi — menyebut murah malah menurunkan nilainya.",
    contoh: (c) => `${c.harga}. Saya kira segitu cuma dapat yang biasa saja.`,
  },
  {
    nama: "subversi-kategori",
    cara: "Menyebut kategori yang sudah dikenal, lalu membelokkannya — otak terlanjur menebak, dan tebakannya meleset.",
    hindari: "Produk yang memang lurus sesuai kategorinya; belokannya jadi bohong.",
    contoh: (c) => `Bentuknya ${c.noun} biasa. Cara pakainya sama sekali tidak.`,
  },
  {
    nama: "segmentasi-audiens",
    cara: "Memanggil satu golongan sempit; yang merasa dipanggil berhenti, yang tidak memang bukan pembeli.",
    hindari: "Produk yang pasarnya sangat luas — mempersempit di sini membuang penonton yang sebenarnya cocok.",
    contoh: (c) => `Khusus yang ${c.aktivitas} tapi paling malas urusan ribet.`,
  },
  {
    nama: "larangan-terbalik",
    cara: "Melarang membeli, lalu menyebut alasannya yang justru memuji — larangan menahan orang lebih lama daripada ajakan.",
    hindari: "Kategori sensitif atau klaim kesehatan; nada bercandanya bisa terbaca menyesatkan.",
    contoh: (c) => `Jangan beli ini kalau ${c.reg.you} nggak siap kehabisan alasan buat nunda.`,
  },
  {
    nama: "pembalikan-ekspektasi",
    cara: "Mengaku awalnya meragukan, lalu berbalik — pengakuan ragu terdengar lebih jujur daripada pujian langsung.",
    hindari: "Produk yang belum benar-benar dicoba pembuat konten; ini mengarang pengalaman.",
    contoh: (c) => `Awalnya saya kira ini cuma ${c.noun} yang lagi ramai. Ternyata bukan.`,
  },
  {
    nama: "ganti-kebiasaan",
    cara: "Menunjuk kebiasaan lama yang masih dipakai penonton, lalu menawarkan gantinya — bukan menjual barang, tapi menutup kebiasaan.",
    hindari: "Kalau kebiasaan lamanya sebetulnya baik-baik saja; penonton merasa dituduh.",
    contoh: (c) => `Masih urus ${c.pain} dengan cara yang sama sejak dulu?`,
  },
  {
    nama: "pengakuan-jujur",
    cara: "Menyebut satu kekurangan lebih dulu; kepercayaan naik justru karena tidak semuanya dipuji.",
    hindari: "Kalau kekurangannya menyangkut keamanan — itu bukan bumbu jujur, itu peringatan.",
    contoh: (c) => `Satu hal yang kurang dari ${c.noun} ini akan saya sebut duluan.`,
  },
  {
    nama: "banding-kelas-atas",
    cara: "Membandingkan dengan kelas di atasnya tanpa menyebut merek — penonton mengisi sendiri nama yang dimaksud.",
    hindari: "Menyebut merek pesaing secara langsung (dilarang L-15) atau menjanjikan setara padahal tidak.",
    contoh: (c) => `Dari semua yang pernah saya pakai, ${c.proof} ini yang paling mendekati kelas mahal.`,
  },
  {
    nama: "penemuan-setelah-gagal",
    cara: "Menyiratkan deretan percobaan yang gagal sebelum ini — kelegaan terasa lebih besar setelah ada kegagalan.",
    hindari: "Produk pertama di kategorinya; tidak ada kegagalan sebelumnya untuk dirujuk.",
    contoh: (c) => `Sudah ganti-ganti terus, dan baru yang ini bertahan sampai ${c.aktivitas} selesai.`,
  },
];

/** Pola yang dipakai tes untuk mengukur apakah sebuah hook memakai perangkat.
 *
 *  Diukur dari BENTUK kalimat, bukan dari selera. Sebuah hook boleh saja bagus
 *  tanpa masuk salah satu pola ini — yang dijaga tes adalah proporsinya, bukan
 *  setiap kalimat satu per satu. */
export const POLA_PERANGKAT: Record<string, RegExp> = {
  pertanyaan: /\?/,
  "sebut harga": /\bharga|\bbanderol|\bseharga|\bribu\b|\bjuta\b/i,
  // "tidak" sempat tertinggal padahal itu negasi paling baku — ketahuan karena
  // contoh perangkat "subversi-kategori" gagal mengenali polanya sendiri.
  "larangan atau negasi": /\bjangan\b|\bnggak\b|\bgak\b|\bbukan\b|\bbelum\b|\btidak\b|\btak\b/i,
  segmentasi: /\bbuat (kalian|yang|kamu)\b|\bkhusus\b|\bkalian yang\b/i,
  superlatif: /\bpaling\b|\bter[a-z]{3,}\b|\bbanget\b/i,
  "pengakuan pribadi": /\baku\b|\bgue\b|\bsaya\b|\bkirain?\b|\bternyata\b/i,
  perbandingan: /\bmirip\b|\bkayak\b|\bsetara\b|\bmendekati\b|\bdibanding/i,
  // Penanda "sudah coba banyak, baru ini yang berhasil". Ditambahkan setelah
  // contoh perangkat penemuan-setelah-gagal tidak dikenali polanya sendiri —
  // perangkatnya nyata, pengukurnya yang belum lengkap.
  "penemuan setelah gagal": /\bakhirnya\b|\bganti-ganti\b|\bberkali-kali\b|\bbaru (yang )?ini\b/i,
};

/** True kalau hook memakai minimal satu perangkat yang bisa dikenali. */
export function memakaiPerangkat(hook: string): boolean {
  return Object.values(POLA_PERANGKAT).some((re) => re.test(hook));
}
