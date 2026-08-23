import type { TemplateCtx } from "./templates";
import { isServiceLike } from "../config/hooks";

/**
 * Copy katalog bersifat template-owned. Setiap template aktif mempunyai satu
 * naskah utama dan tiga alternatif lengkap; tidak ada kolam kalimat bersama.
 * Fakta produk hanya berasal dari TemplateCtx, sehingga layer ini tidak
 * mengarang bahan, durasi pemakaian, stok, diskon, atau hasil terukur.
 */
export interface CopyTriple {
  hook: string;
  demo: string;
  cta: string;
  /**
   * Ads Story OS tidak muat di bentuk warisan hook/demo/cta: dua friction,
   * spike, dan button adalah lima beat yang berbeda. Field ini hanya diisi
   * copy Ads; tiga string di atas tetap ada untuk kompatibilitas layar lama.
   */
  story?: AdsStoryBeat[];
}

export interface AdsStoryBeat {
  role: "hook" | "demo" | "story" | "cta";
  label: "HOOK" | "FRICTION" | "SPIKE" | "BUTTON";
  text: string;
  action: string;
  product_state: "hidden" | "partial" | "hero";
  saksi?: string;
}

type CopyFn = (c: TemplateCtx) => CopyTriple;

/** Satu naskah utama dan tiga alternatif lengkap per template. */
export const TEMPLATE_COPY_CAPACITY = 4 as const;

export const COMPACTED_TEMPLATE_IDS = new Set([
  "racun-checkout", "review-jujur", "unboxing", "before-after", "diskon-gede",
  "buat-kamu-yang", "spill-rahasia", "t01-tempat-susah", "t02-bedah-fitur",
  "t03-liputan-event", "t04-hook-indrawi", "t07-checklist-berjalan",
  "t09-bahan-aktif", "t10-bukti-di-lengan", "t12-vox-pop", "kenalin-bisnis",
  "promo-terbatas", "tvc-the-drop", "tvc-tersangka", "tvc-seharian",
  "tvc-kain-lari", "tvc-jam-tiga",
]);

const ADS_IDS = new Set([
  "ads-unboxing-pov", "ads-meja-kosong", "ads-panas-ekstrem",
  "ads-tembus-dinding", "ads-atap-jebol", "ads-dobrak-pintu",
  "ads-waktu-berhenti", "kenalin-bisnis", "promo-terbatas",
]);

type AuthoredPair = { hook: string; demo: string };
type AuthoredSet = (c: TemplateCtx) => AuthoredPair[];

/** Cue pembawaan tidak ikut jatah kata dan tidak boleh dipotong jadi fragmen. */
function deliveryPrefix(text: string): string {
  return (text.match(/\[[^\]]+\]/g) ?? []).join(" ");
}

function withDelivery(authored: string, source: string): string {
  const prefix = deliveryPrefix(source);
  return prefix ? `${prefix} ${authored}` : authored;
}

/**
 * Naskah pendek ini ditulis per-template, bukan hasil pemotongan token.
 * Setiap entri adalah klausa Indonesia lengkap dan selalu menyebut nama
 * produk sebagai satu kesatuan ketika nama itu diperlukan.
 */
const AUTHORED_COMPACT: Record<string, AuthoredSet> = {
  "racun-checkout": (c) => [
    { hook: "Nah, detail ini ternyata beda, loh.", demo: `Balik ${c.produk}; cari ciri ${c.proof}, ya.` },
    { hook: "Eh, bagian mana yang paling penting?", demo: `${c.produk} memperlihatkan ${c.proof}, sih.` },
    { hook: "Ternyata racunnya ada di detail, Bun.", demo: `Nah, sorot ciri ${c.proof} milik ${c.produk}.` },
    { hook: "Kirain biasa, eh ternyata menarik, sih.", demo: `Balik ${c.produk}; temukan ciri ${c.proof}.` },
  ],
  "review-jujur": (c) => [
    { hook: "Jujur ya, awalnya aku ragu, sih.", demo: `Nah, ${c.proof} pada ${c.produk} terlihat jelas.` },
    { hook: "Nggak aku manis-manisin, ini ulasan jujur.", demo: `${c.produk} menunjukkan ${c.proof}, ya.` },
    { hook: "Ada bagusnya, tapi apa kekurangannya?", demo: `Nah, periksa ${c.proof} milik ${c.produk}.` },
    { hook: "Pujian kosong? Lewat saja, deh.", demo: `Aku telusuri ${c.produk}; cirinya ${c.proof}, ya.` },
  ],
  unboxing: (c) => [
    { hook: "Belum dibuka, eh isinya bikin penasaran.", demo: `Cocokkan isi ${c.produk} dengan daftarnya, ya.` },
    { hook: "Eh, isi paketnya lengkap nggak, ya?", demo: `Periksa jumlah dan ${c.proof} pada ${c.produk}.` },
    { hook: "Kardusnya masih tertutup, kok bikin penasaran?", demo: `Balik ${c.produk}; baca ${c.proof} pada labelnya.` },
    { hook: "Bun, jangan buru-buru buka paketnya, deh.", demo: `Nah, cek isi ${c.produk} satu-satu.` },
  ],
  "diskon-gede": (c) => [
    { hook: `Bun, ${c.harga} bikin aku cek ulang.`, demo: `Nah, bandingkan ${c.produk} dan ${c.proof}, ya.` },
    { hook: `Eh, banderol ${c.harga} ini serius?`, demo: `Telusuri ${c.produk}; pastikan ciri ${c.proof}, sih.` },
    { hook: `Nah, punya bujet ${c.harga}?`, demo: `Amati ${c.produk} dan ${c.proof} dulu.` },
    { hook: `Yakin ${c.harga} ini wajar?`, demo: `Nah, cocokkan ${c.produk} dengan ciri ${c.proof}.` },
  ],
  "buat-kamu-yang": (c) => [
    { hook: `Sering ${c.aktivitas}? Merapat sebentar, ya.`, demo: `Nah, lihat ${c.proof} milik ${c.produk}.` },
    { hook: `${c.reg.sapaan}, ${c.pain} masih mengganggu, nggak?`, demo: `${c.produk} punya detail ${c.proof}, sih.` },
    { hook: `Eh, sering ${c.aktivitas}? Cek ini.`, demo: `${c.produk} menampilkan ${c.proof}, loh.` },
    { hook: `${c.reg.sapaan}, ${c.pain} kelihatan dari jauh?`, demo: `Nah, dekatkan ${c.produk} hingga ${c.proof} terlihat.` },
  ],
  "spill-rahasia": (c) => [
    { hook: "Detail ini nggak terlihat sekilas, loh.", demo: `Nah, dekati ${c.produk} dan cek ${c.proof}.` },
    { hook: "Bagian kecil ini sering kelewat, ya?", demo: `Sorot permukaan ${c.produk}; temukan ${c.proof}, ya.` },
    { hook: "Bun, rahasianya ada di cara mengecek?", demo: `Nah, cocokkan ${c.proof} milik ${c.produk}.` },
    { hook: "Nggak kelihatan jauh, eh coba dekatkan.", demo: `Aku dekatkan ${c.produk}; ${c.proof} tampak, ya.` },
  ],
  "t01-tempat-susah": (c) => [
    { hook: "Sering bepergian, tapi nggak mau ribet?", demo: `Ukur kemasan ${c.produk} sebelum dibawa, ya.` },
    { hook: "Nah, ruang bawaanmu terbatas, Bun?", demo: `Pastikan ${c.produk} muat dengan aman, sih.` },
    { hook: "Sering keluar rumah? Cara menyimpan penting.", demo: `Nah, periksa kemasan ${c.produk} dan ${c.proof}.` },
    { hook: "Jauh dari rumah? Siapkan ruang khusus.", demo: `Lihat ukuran ${c.produk} sebelum dibawa, deh.` },
  ],
  "t04-hook-indrawi": (c) => [
    { hook: "Nah, bunyi apa yang bikin penasaran?", demo: `Buka ${c.produk}, lalu baca labelnya, ya.` },
    { hook: "Kirain harus dicicip, eh dengar dulu.", demo: `Dengarkan ${c.produk}; cocokkan bunyi dengan ${c.proof}, sih.` },
    { hook: "Bun, teksturnya bisa kedengaran, ya?", demo: `Baca komposisi ${c.produk} sebelum mencicip.` },
    { hook: "Belum terlihat, eh suaranya bikin penasaran.", demo: `Dengarkan ${c.produk}, lalu baca labelnya, deh.` },
  ],
  "t07-checklist-berjalan": (c) => [
    { hook: "Bingung mulai dari mana? Pakai checklist.", demo: `Nah, cocokkan tiap poin pada ${c.produk}, ya.` },
    { hook: "Bun, jangan centang sebelum terlihat, deh.", demo: `Tunjukkan ${c.produk}; tandai ciri ${c.proof}, sih.` },
    { hook: "Setiap poin harus punya jawaban, kan?", demo: `Nah, periksa ${c.produk} langkah demi langkah.` },
    { hook: "Belum mulai, kok poin pertama terisi?", demo: `Uji ${c.produk}; catat ciri ${c.proof}, ya.` },
  ],
  "t10-bukti-di-lengan": (c) => [
    { hook: "Nah, area kecil mana yang perlu diperiksa?", demo: `Dekatkan ${c.produk}; amati ${c.proof} pada satu area, ya.` },
    { hook: "Eh, cahayanya sudah cukup netral, belum?", demo: `Taruh ${c.produk}; periksa ${c.proof} dalam satu tampilan, deh.` },
    { hook: "Bun, atributnya terlihat dari posisi ini?", demo: `Nah, arahkan ${c.produk}; catat ${c.proof} yang tampak.` },
    { hook: "Satu area ini sudah terlihat jelas?", demo: `Dekati ${c.produk}; catat ${c.proof} pada posisi tetap, ya.` },
  ],
  "before-after": (c) => [
    { hook: "Nah, satu tampilan ini cukup untuk diperiksa?", demo: `Letakkan ${c.produk} pada permukaan netral. Catat ${c.proof}, pencahayaan, jarak, dan sudut dalam tampilan yang sama secara teliti, ya.` },
    { hook: "Eh, atribut mana terlihat pada satu keadaan?", demo: `Tempatkan ${c.produk} di cahaya merata. Tahan posisinya, lalu periksa ${c.proof} pada bingkai yang sama dengan pelan, deh.` },
    { hook: "Bun, detail mana yang terlihat sekarang?", demo: `Arahkan ${c.produk} ke cahaya netral. Jeda videonya, lalu amati ${c.proof}, label, dan permukaan dalam keadaan yang sama, ya.` },
    { hook: "Satu pengamatan teliti sudah cukup, belum?", demo: `Taruh ${c.produk} di atas meja. Pertahankan jarak dan pencahayaan, lalu catat ${c.proof} yang benar-benar tampak sekarang, deh.` },
  ],
  "t02-bedah-fitur": (c) => [
    { hook: "Nah, bagian penting mana yang harus dibedah?", demo: `Buka ${c.produk}, tunjuk bagian yang sering disentuh, lalu periksa sambungan, cara pakai, dan ${c.proof} secara pelan, deh.` },
    { hook: "Eh, jangan nilai bentuk luarnya dulu.", demo: `Baca nama bagian ${c.produk}, cocokkan petunjuknya, lalu gerakkan komponen yang tersedia dan lihat ${c.proof}, sih.` },
    { hook: "Bun, bagian ini menjawab pertanyaan apa?", demo: `Putar ${c.produk}, cek sambungan dan kontrolnya, lalu pastikan ${c.proof} terlihat dari tiap sisi, ya.` },
    { hook: "Barang teknis harus diperiksa, bukan langsung dipuji.", demo: `Mulai dari bagian utama ${c.produk}. Ikuti cara pakai, tunjukkan ${c.proof}, lalu nilai bagian yang relevan, deh.` },
  ],
  "t03-liputan-event": (c) => [
    { hook: "Nah, ikut aku keliling dari pintu masuk.", demo: `Suasananya langsung terasa saat masuk. Dekati ${c.produk}, lihat ${c.proof}, lalu tanyakan cara mendapatkannya kepada staf, ya.` },
    { hook: "Bun, sudut mana yang paling ramai?", demo: `Mulai dari area utama, lalu cari ${c.produk}. Baca keterangannya, periksa ${c.proof}, dan lanjutkan keliling, sih.` },
    { hook: "Nah, temuan apa yang dekat pintu?", demo: `Berhenti di area ${c.produk}, lalu amati ${c.proof} dari dekat. Setelah itu, lihat aktivitas lain di sekitarnya, ya.` },
    { hook: "Suasananya terasa sebelum barang terlihat, ya?", demo: `Keliling sebentar, lalu berhenti di ${c.produk}. Cek ${c.proof} dan tanyakan rinciannya langsung kepada penjaga, deh.` },
  ],
  "t09-bahan-aktif": (c) => [
    { hook: "Suka riset? Jangan berhenti di label depan.", demo: `Balik ${c.produk}, baca daftar resminya, lalu cocokkan istilah yang tertulis dengan ${c.proof} tanpa menebak, ya.` },
    { hook: "Bun, nama teknis belum menjelaskan semuanya.", demo: `Cari keterangan pada ${c.produk}. Baca urutannya, periksa ${c.proof}, lalu pisahkan fakta tertulis dari kesan pribadi, sih.` },
    { hook: "Nah, formula harus dibaca, bukan ditebak.", demo: `Tunjukkan label ${c.produk}, lalu baca informasi yang tersedia. Cocokkan ${c.proof} hanya dengan keterangan resmi, deh.` },
    { hook: "Fakta dan kesan sudah dipisahkan, belum?", demo: `Buka informasi ${c.produk}, tandai istilah penting, lalu hubungkan ${c.proof} dengan tulisan yang tersedia secara teliti, ya.` },
  ],
  "t12-vox-pop": (c) => [
    { hook: "Nah, pertanyaan mana yang perlu diperiksa?", demo: `Baca satu kartu tentang ${c.produk}. Cari jawabannya hanya pada label dan ${c.proof} yang terlihat hari ini, ya.` },
    { hook: "Bun, informasi mana yang belum jelas?", demo: `Susun kartu pertanyaan tanpa nama. Periksa ${c.produk}, lalu tandai ${c.proof} yang benar-benar terlihat, deh.` },
    { hook: "Nah, pertanyaannya sudah cukup spesifik?", demo: `Pilih satu kartu, lalu arahkan ${c.produk} ke cahaya. Tulis ${c.proof} sebagaimana terlihat saat ini, ya.` },
    { hook: "Eh, semua kartu sudah terjawab?", demo: `Balik kartu di samping ${c.produk}. Isi jawabannya hanya dengan ${c.proof} yang dapat diperiksa dari dekat sekarang, sih.` },
  ],
  "tvc-the-drop": (c) => [
    { hook: "Satu tetes air jatuh di meja.", demo: `Pantulannya bergerak pelan menuju ${c.produk}. Cahaya ruangan meredup ketika nama pada kemasan mulai terlihat.` },
    { hook: "Kenapa cahaya bergerak sepelan ini?", demo: `Tetes air melintas di depan ${c.produk}. Bayangannya bergeser perlahan, lalu berhenti di tepi meja yang gelap.` },
    { hook: "Jarak pipet dan meja begitu pendek.", demo: `Air jatuh di permukaan tanpa mengenai ${c.produk}. Pantulannya melewati kemasan, kemudian cahaya ruangan kembali tenang.` },
    { hook: "Satu tetes membuka adegan yang sunyi.", demo: `${c.produk} berada di belakang tetesan air. Cahaya berpindah di meja, lalu nama pada kemasan menutup adegan.` },
  ],
  "tvc-tersangka": (c) => [
    { hook: "Sidang rekaan dibuka. Apa barangnya?", demo: `Sebuah kotak diletakkan di meja. Hakim membuka catatan, lalu membaca nama ${c.produk} sebelum ruangan kembali hening.` },
    { hook: "Yang mulia, catat namanya.", demo: `Petugas membawa ${c.produk} ke meja sidang rekaan. Semua menunggu saat hakim memeriksa tulisan pada kemasan dengan teliti.` },
    { hook: "Penuduh memotret meja barang bukti.", demo: `Hakim bertanya sekali lagi. Tangan si penuduh mengarah ke ${c.produk}, lalu petugas menutup catatan perkara rekaan.` },
    { hook: "Apa nama benda di dalam tas?", demo: `Terdakwa membuka tas lalu meletakkan ${c.produk} di meja. Hakim membaca namanya, kemudian mengetuk palu untuk menutup adegan.` },
  ],
  "tvc-seharian": (c) => [
    { hook: "Jam tujuh pagi membuka perjalanan.", demo: `Pagi, siang, dan malam berganti di jendela. ${c.produk} berpindah dari meja kerja ke meja rumah dalam rangkaian adegan.` },
    { hook: "Hari bergerak tanpa menilai apa pun.", demo: `Jalanan ramai lalu ruangan menjadi sunyi. ${c.produk} muncul kembali di meja ketika lampu rumah dinyalakan.` },
    { hook: "Perjalanan dimulai sebelum matahari tinggi.", demo: `${c.produk} terlihat di beberapa tempat sepanjang hari. Waktu dan lokasi menjadi satu-satunya hal yang terus berganti.` },
    { hook: "Pagi dan sore punya cahaya berbeda.", demo: `Cahaya jendela berubah perlahan di sekitar ${c.produk}. Kemasan tetap menjadi benda yang sama sampai adegan terakhir.` },
  ],
  "tvc-kain-lari": (c) => [
    { hook: "Baju dipotret diam. Itu masalahnya.", demo: `Kain sebenarnya dipakai sambil berjalan, berbelok, dan duduk. Kamera mengikuti geraknya sampai ${c.proof} terlihat saat langkah berubah cepat.` },
    { hook: "Foto diam sering membuat penilaian meleset.", demo: `Bentuknya baru terbaca ketika tubuh berbelok dan lipatan menyusul. Pada gerakan itu, ${c.proof} terlihat tanpa bantuan pose.` },
    { hook: "Kain menyusul setengah detik setelah langkah.", demo: `Jeda kecil itu terlihat saat tubuh berhenti. Kamera menahan gerak sampai ${c.proof} mengikuti langkah terakhir dengan jelas.` },
    { hook: "Ini busana untuk hari yang sibuk.", demo: `Naik motor, duduk lama, lalu berdiri cepat mengubah lipatan kain. Sesudahnya, ${c.proof} menjadi detail yang dinilai. Kamera mengikuti geraknya.` },
  ],
  "tvc-jam-tiga": (c) => [
    { hook: "Jam tiga pagi. Rumah masih sunyi.", demo: `Satu lampu kecil menyala. Tangan merapikan meja, lalu meletakkan ${c.produk} di sampingnya sebelum cahaya diredupkan lagi.` },
    { hook: "Malam membuat setiap gerakan terdengar.", demo: `Tangan membuka laci pelan, kemudian meletakkan ${c.produk} di atas meja. Rumah tetap sunyi sampai lampunya padam.` },
    { hook: "Rumah diam. Satu lampu masih menyala.", demo: `Seseorang berjalan melewati perabot sambil membawa ${c.produk}, lalu memilih tempat di bawah lampu yang kembali meredup.` },
    { hook: "Ada kegiatan kecil sebelum pagi.", demo: `Meja dirapikan sebelum orang lain bangun. ${c.produk} ditempatkan di dekat lampu, lalu tangan keluar dari bingkai.` },
  ],
};

function authoredCompact(templateId: string, variantIndex: number, c: TemplateCtx, base: CopyTriple): CopyTriple {
  if (!COMPACTED_TEMPLATE_IDS.has(templateId) || ADS_IDS.has(templateId)) return base;
  const authored = AUTHORED_COMPACT[templateId]?.(c)[variantIndex];
  if (!authored) throw new Error(`Copy ringkas ${templateId}#${variantIndex} belum ditulis.`);
  const tvc = templateId.startsWith("tvc-");
  const hasFiller = /\b(nah|eh|sumpah)\b|jadi gini/i.test(`${authored.hook} ${authored.demo}`);
  const demo = !tvc && !hasFiller ? `Nah, ${authored.demo}` : authored.demo;
  return {
    hook: withDelivery(authored.hook, base.hook),
    demo: withDelivery(demo, base.demo),
    cta: base.cta,
  };
}

type FourLines = [string, string, string, string];
interface AdsScene {
  hooks: FourLines;
  friction1: FourLines;
  friction2: FourLines;
  spikes: FourLines;
  questions: FourLines;
  saksi: string;
}

const ADEGAN_ADS: Record<string, AdsScene> = {
  "ads-unboxing-pov": {
    hooks: ["Nah, siapa membuka kardus?", "Eh, tangan siapa itu?", "Kirain tutupnya terbuka sendiri?", "Bun, paketnya bergerak?"],
    friction1: ["Tutupnya macet, deh.", "Kardusnya tertahan, deh.", "Lipatannya menahan, deh.", "Tangannya tertahan, deh."],
    friction2: ["Segelnya tertarik, sih.", "Perekatnya melekat, sih.", "Sudutnya tersangkut, sih.", "Paketnya terangkat, sih."],
    spikes: ["Nah, paketnya terbuka.", "Nah, kardusnya terbuka.", "Nah, segelnya lepas.", "Nah, tutupnya terbuka."],
    questions: ["Bisa lihat, paketnya?", "Terbuka utuh, paketnya?", "Segelnya lepas, paketnya?", "Tutup terbuka, paketnya?"],
    saksi: "ibu di samping meja",
  },
  "ads-meja-kosong": {
    hooks: ["Nah, alatnya pergi ke mana?", "Eh, mejanya makin kosong?", "Kenapa kabelnya menghilang?", "Bun, siapa merapikan meja?"],
    friction1: ["Kabelnya kusut, deh.", "Berkasnya menumpuk, deh.", "Aplikasinya tertunda, deh.", "Antreannya tersendat, deh."],
    friction2: ["Alatnya menghilang, sih.", "Langkahnya bertambah, sih.", "Jadwalnya bentrok, sih.", "Notifikasinya menumpuk, sih."],
    spikes: ["Nah, alurnya ringkas.", "Nah, mejanya kosong.", "Nah, tugasnya tersusun.", "Nah, antreannya bergerak."],
    questions: ["Sudah ringkas, alurnya?", "Mejanya kosong, alurnya?", "Tugas tersusun, alurnya?", "Antrean bergerak, alurnya?"],
    saksi: "teman kerja off camera",
  },
  "ads-panas-ekstrem": {
    hooks: ["Nah, kenapa ruangannya berasap?", "Eh, panasnya naik lagi?", "Bun, esnya mencair secepat itu?", "Kirain cuma gerah biasa?"],
    friction1: ["Kipasnya berhenti, deh.", "Keringatnya bertahan, deh.", "Esnya mencair, deh.", "Udaranya memberat, deh."],
    friction2: ["Uapnya menutup, sih.", "Jendelanya berembun, sih.", "Tangannya melambat, sih.", "Temannya menjauh, sih."],
    spikes: ["Nah, udaranya bergerak.", "Nah, uapnya menghilang.", "Nah, kipasnya berputar.", "Nah, ruangannya berubah."],
    questions: ["Mulai bergerak, udaranya?", "Uap menghilang, udaranya?", "Kipas berputar, udaranya?", "Ruangan berubah, udaranya?"],
    saksi: "teman di samping",
  },
  "ads-tembus-dinding": {
    hooks: ["Eh, apa yang menembus dinding?", "Nah, benturan apa tadi?", "Kirain cuma angin dari belakang?", "Bun, lihat retakan temboknya?"],
    friction1: ["Retaknya melebar dan debu mulai turun, deh.", "Benturan kedua membuat bingkainya ikut bergeser, deh.", "Suara berikutnya mendekat dari balik tembok, deh.", "Debunya menutup meja dan lampu, deh."],
    friction2: ["Celah temboknya membuka sedikit demi sedikit, sih.", "Bayangannya kini terlihat di balik debu, sih.", "Mejanya ikut bergetar saat retakannya memanjang, sih.", "Satpamnya mendekat ketika serpihan terakhir jatuh, sih."],
    spikes: ["Nah, bendanya mendarat tepat di depan satpam.", "Nah, sumber benturannya akhirnya terlihat oleh satpam.", "Nah, barangnya berhenti utuh di meja satpam.", "Nah, retakannya berhenti saat satpam menoleh."],
    questions: ["Benda mendarat, benturannya?", "Sumber terlihat, benturannya?", "Barang berhenti, benturannya?", "Satpam menoleh, benturannya?"],
    saksi: "satpam di pintu",
  },
  "ads-atap-jebol": {
    hooks: ["Nah, siapa jatuh dari atap?", "Eh, suara apa dari atas?", "Bun, plafonnya retak lagi?", "Kirain cuma debu biasa?"],
    friction1: ["Plafonnya retak, deh.", "Langkahnya mendekat, deh.", "Serbuknya jatuh, deh.", "Bayangannya muncul, deh."],
    friction2: ["Retakannya memanjang, sih.", "Lampunya bergoyang, sih.", "Orangnya menengadah, sih.", "Debunya menutup, sih."],
    spikes: ["Nah, orangnya mendarat.", "Nah, sumbernya terlihat.", "Nah, plafonnya berhenti.", "Nah, matanya menoleh."],
    questions: ["Orangnya mendarat, plafonnya?", "Sumber muncul, plafonnya?", "Retakan berhenti, plafonnya?", "Saksi menoleh, plafonnya?"],
    saksi: "ibu off camera",
  },
  "ads-dobrak-pintu": {
    hooks: ["Nah, siapa mendobrak pintunya?", "Eh, gagangnya bergerak sendiri?", "Bun, engselnya bergeser lagi?", "Kirain cuma ketukan biasa?"],
    friction1: ["Gagangnya bergetar, deh.", "Ketukannya mengeras, deh.", "Engselnya bergeser, deh.", "Bayangannya terlihat, deh."],
    friction2: ["Kuncinya berputar, sih.", "Ruangannya hening, sih.", "Petugasnya mendekat, sih.", "Pintunya membuka, sih."],
    spikes: ["Nah, pintunya terbuka.", "Nah, orangnya masuk.", "Nah, jawabannya terlihat.", "Nah, pesannya sampai."],
    questions: ["Sudah terbuka, pintunya?", "Orangnya masuk, pintunya?", "Jawaban terlihat, pintunya?", "Pesan sampai, pintunya?"],
    saksi: "petugas di lorong",
  },
  "ads-waktu-berhenti": {
    hooks: ["Eh, kenapa semua orang membeku?", "Nah, pasarnya mendadak diam?", "Bun, uapnya berhenti bergerak?", "Kirain waktunya masih berjalan?"],
    friction1: ["Uapnya membeku, deh.", "Pedagangnya berhenti, deh.", "Koinnya diam, deh.", "Jamnya berhenti, deh."],
    friction2: ["Suaranya hilang, sih.", "Kasirnya tertahan, sih.", "Tangannya membeku, sih.", "Antreannya diam, sih."],
    spikes: ["Nah, tangannya bergerak.", "Nah, waktunya berjalan.", "Nah, kasirnya menoleh.", "Nah, pasarnya hidup."],
    questions: ["Tangan bergerak, waktunya?", "Mulai berjalan, waktunya?", "Kasir menoleh, waktunya?", "Pasar hidup, waktunya?"],
    saksi: "kasir yang membeku",
  },
  "kenalin-bisnis": {
    hooks: ["Nah, kenapa antreannya panjang?", "Eh, pesan siapa belum terjawab?", "Bun, jadwalnya bentrok lagi?", "Kirain layanan ini selalu rumit?"],
    friction1: ["Pesannya tertunda, deh.", "Jadwalnya bentrok, deh.", "Formulirnya bertambah, deh.", "Antreannya tersendat, deh."],
    friction2: ["Permintaannya menunggu, sih.", "Statusnya menetap, sih.", "Pelanggannya bertanya, sih.", "Responsnya melambat, sih."],
    spikes: ["Nah, layanannya merespons.", "Nah, jadwalnya tersusun.", "Nah, statusnya berubah.", "Nah, antreannya berkurang."],
    questions: ["Sudah merespons, layanannya?", "Jadwal tersusun, layanannya?", "Status berubah, layanannya?", "Antrean berkurang, layanannya?"],
    saksi: "teman kerja off camera",
  },
  "promo-terbatas": {
    hooks: ["Nah, harga mana aktif?", "Eh, pilihannya tinggal berapa?", "Bun, daftarnya berubah lagi?", "Yakin harganya masih sama?"],
    friction1: ["Pilihannya habis, deh.", "Daftarnya memendek, deh.", "Harganya tertunda, deh.", "Stoknya berubah, deh."],
    friction2: ["Kasirnya mengecek, sih.", "Pembelinya menunggu, sih.", "Labelnya terlihat, sih.", "Daftarnya diperbarui, sih."],
    spikes: ["Nah, harganya tampil.", "Nah, pilihannya terlihat.", "Nah, labelnya jelas.", "Nah, kasirnya memastikan."],
    questions: ["Harga tampil, promonya?", "Pilihan terlihat, promonya?", "Label jelas, promonya?", "Kasir memastikan, promonya?"],
    saksi: "kasir di samping",
  },
};

const VARIASI_GESER = [
  ["buka sisi produk hingga bergeser", "produk berpindah ke tengah meja"],
  ["ambil produk lalu pindahkan posisinya", "produk diputar menghadap saksi"],
  ["usap produk lalu geser ke kanan", "produk diangkat mendekati saksi"],
  ["pegang produk lalu buka penutupnya", "produk dibuka di depan saksi"],
] as const;
const VARIASI_LAYANAN = [
  ["talent buka kartu nama layanan di meja", "kartu dipindahkan mendekati saksi"],
  ["talent buka lipatan kartu informasi", "nama layanan diarahkan kepada saksi"],
  ["talent buka amplop berisi kartu nama", "kartu diletakkan di depan saksi"],
  ["talent buka halaman catatan kosong", "nama layanan ditulis di depan saksi"],
] as const;

const JEDA_VARIAN = ["[short pause]", "[medium pause]", "[long pause]", "[slow]"] as const;

function storyAds(templateId: string, variantIndex: number, c: TemplateCtx, base: CopyTriple): CopyTriple {
  const adegan = ADEGAN_ADS[templateId];
  if (!adegan) return base;
  const nonPhysical = isServiceLike(c.category ?? "");
  const [aksiSatu, aksiDua] = (nonPhysical ? VARIASI_LAYANAN : VARIASI_GESER)[variantIndex];
  const hook = withDelivery(adegan.hooks[variantIndex], base.hook);
  const button = `${adegan.questions[variantIndex]} Detailnya ada di bawah ya.`;
  const hargaAktif = [
    `Kini harganya ${c.harga}.`,
    `Angkanya ${c.harga}, ya.`,
    `Harga aktif ${c.harga}.`,
    `Tercantum ${c.harga}, deh.`,
  ];
  const tekananSatu = templateId === "promo-terbatas"
    ? hargaAktif[variantIndex]
    : adegan.friction1[variantIndex];
  const story: AdsStoryBeat[] = [
    { role: "hook", label: "HOOK", text: hook, action: nonPhysical ? "kartu nama layanan terlihat sejak frame pertama" : "anomali terlihat sejak frame pertama", product_state: "partial" },
    { role: "demo", label: "FRICTION", text: `${JEDA_VARIAN[variantIndex]} ${tekananSatu}`, action: aksiSatu, product_state: "partial" },
    { role: "story", label: "FRICTION", text: adegan.friction2[variantIndex], action: aksiDua, product_state: "hero" },
    { role: "story", label: "SPIKE", text: adegan.spikes[variantIndex], action: nonPhysical ? `kartu nama ${c.produk} diletakkan di depan saksi` : `${c.produk} berhenti tepat di depan saksi`, product_state: "hero", saksi: adegan.saksi },
    { role: "cta", label: "BUTTON", text: button, action: nonPhysical ? "talent menunjuk nama layanan pada kartu sambil menyisakan pertanyaan" : "talent menahan produk sambil menyisakan pertanyaan", product_state: "hero" },
  ];
  return { hook: story[0].text, demo: story.slice(1, 4).map((beat) => beat.text).join(" "), cta: button, story };
}

const RACUN_CHECKOUT: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, detail kecil ini ternyata layak dilihat dekat loh`, demo: `[short pause] Pada ${c.produk}, periksa ${c.proof}; harganya ${c.harga} sih`, cta: `Kalau memang masuk kebutuhanmu, cek keranjang kuning dong` }),
  (c) => ({ hook: `[fast] Eh, ${c.reg.me} baru paham bagian yang perlu dicek sih`, demo: `[medium pause] ${c.produk} memperlihatkan ${c.proof}; banderolnya ${c.harga}, jadi nilai sendiri ya`, cta: `Lihat detailnya dulu di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Ternyata racunnya ada di detail, ${c.reg.sapaan}`, demo: `[long pause] Nah, amati ${c.proof} pada ${c.produk}; harganya ${c.harga}, tanpa janji berlebihan loh`, cta: `Kalau konteksnya sama, mampir ke keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Kirain biasa aja, eh [giggles] ternyata bikin berhenti scroll sih`, demo: `[short pause] Sorot ${c.produk}, lalu telaah atribut ${c.proof}; banderolnya ${c.harga} sih`, cta: `Nilai sendiri sekarang lewat keranjang kuning loh` }),
];

const REVIEW_JUJUR: CopyFn[] = [
  (c) => ({ hook: `[serious] Jujur ya, awalnya ${c.reg.me} kira ini biasa aja`, demo: `[short pause] Nah, ${c.proof} ${c.produk} bisa diperiksa; harganya ${c.harga} sih`, cta: `Penilaian lengkapnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Nggak akan aku manis-manisin, eh ini ulasan apa adanya`, demo: `[medium pause] ${c.produk} menunjukkan ${c.proof}; harganya ${c.harga} ya`, cta: `Bandingkan sendiri sekarang lewat keranjang kuning deh` }),
  (c) => ({ hook: `[slow] Ada bagusnya, eh tapi ada yang belum aku yakini sih`, demo: `[long pause] ${c.proof} ada pada ${c.produk}; untuk ${c.pain}, harganya ${c.harga}`, cta: `Spesifikasinya ada di keranjang kuning tuh` }),
  (c) => ({ hook: `[slow] Kalau [giggles] cari pujian kosong, ulasan ini bukan tempatnya loh`, demo: `[short pause] Nah, ${c.proof} ${c.produk} aku telaah dulu; banderolnya ${c.harga} ya`, cta: `Kalau masih penasaran, buka keranjang kuning deh` }),
];

const UNBOXING: CopyFn[] = [
  (c) => ({ hook: `[excited] Belum sempat duduk, eh paket ${c.produk} udah sampai duluan`, demo: `[short pause] Cocokkan isinya satu per satu dengan daftar; periksa ${c.proof} ya`, cta: `Isi paketnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, isi paket ${c.produk} lengkap semua nggak ya?`, demo: `[medium pause] Lihat jumlah isi dan detail ${c.proof} tanpa menyimpulkan kondisi sih`, cta: `Paketnya ada di keranjang kuning sih` }),
  (c) => ({ hook: `[fast] Belum dibuka, eh tapi kardus ${c.produk} udah bikin penasaran banget`, demo: `[long pause] Baca labelnya dan pastikan ${c.proof} sesuai kebutuhan loh`, cta: `Isi paket lengkap tercantum di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [giggles] jangan buru-buru dibuka, isinya kita cek satu per satu dulu`, demo: `[short pause] Nah, periksa [giggles] isinya; tanyakan detail ${c.proof} deh`, cta: `Cek pilihan paketnya sekarang di keranjang kuning deh` }),
];

const BEFORE_AFTER: CopyFn[] = [
  (c) => ({ hook: `[serious] Kelihatan beda banget ya, tapi jangan percaya dulu sebelum acuan kedua sisinya benar-benar disamakan`, demo: `[short pause] Taruh ${c.produk} pada dua kondisi setara. Nah, lihat ${c.proof} berdampingan, samakan cahaya dan sudut, lalu sebut perbedaan yang benar-benar kelihatan. Kalian lihat bagian yang sama nggak ya?`, cta: `Kalau metodenya masuk akal buatmu, cek keranjang kuning dong` }),
  (c) => ({ hook: `[fast] Eh, jangan percaya omongan ${c.reg.me}; lihat sendiri kedua sisinya secara pelan-pelan sekarang`, demo: `[medium pause] Pisahkan tampilan awal dan akhir. Apakah ${c.proof} terlihat berbeda pada ${c.produk} ketika sudut dan cahayanya sama? Kalau patokannya berubah, ulang dari sudut pertama agar perbandingannya jelas sih`, cta: `Detail pemakaian lengkap saat ini ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, cahaya dan sudutnya sudah sama, perbedaan mana yang kelihatan di layar?`, demo: `[long pause] Samakan cahaya, jarak, dan sudut. Setelah ${c.produk} disejajarkan, bagian ${c.proof} mana yang benar-benar terlihat berbeda? Coba jeda videonya, lalu tulis detail yang kalian lihat pada kedua sisi secara bergantian ya`, cta: `Detail produknya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Jangan percaya perbandingan apa pun kalau kondisi kedua sisinya nggak benar-benar setara`, demo: `[short pause] Letakkan dua tampilan ${c.produk} berdampingan. Nah, cocokkan acuannya, perhatikan ${c.proof} selama beberapa detik penuh dulu, lalu tanyakan bagian mana yang berubah. Ulangi dengan posisi tangan, jarak, dan permukaan yang sama deh`, cta: `Panduan produknya ada di keranjang kuning loh` }),
];

const DISKON_GEDE: CopyFn[] = [
  (c) => ({ hook: `[excited] ${c.reg.sapaan}, banderol ${c.harga} bikin ${c.reg.me} cek ulang`, demo: `[short pause] Nah, ${c.produk} seharga ${c.harga}; bandingkan detail ${c.proof} sendiri sih`, cta: `Harga aktifnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, banderol ${c.harga} ini serius bikin berhenti sih`, demo: `[medium pause] Banderolnya ${c.harga}; lihat dulu ${c.proof} ${c.produk} ya`, cta: `Angka terbarunya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, kalau budgetmu ${c.harga}, lihat barang ini dulu`, demo: `[long pause] Buat ${c.aktivitas}, amati ${c.proof} milik ${c.produk}; banderolnya ${c.harga} loh`, cta: `Bandingkan paketnya lewat keranjang kuning tuh` }),
  (c) => ({ hook: `[fast] Yakin ${c.harga} ini wajar? [giggles] Bandingkan dulu ya`, demo: `[short pause] Nah, periksa bagian ${c.proof} ${c.produk}; harganya ${c.harga} sih`, cta: `Harganya ada di keranjang kuning deh` }),
];

const BUAT_KAMU_YANG: CopyFn[] = [
  (c) => ({ hook: `[excited] Buat yang sering ${c.aktivitas}, merapat sebentar ya`, demo: `[short pause] Nah, saat ${c.pain} terasa, lihat ${c.proof} milik ${c.produk} sih`, cta: `Kalau panggilannya tepat, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Buat ${c.identitas} yang masih urus ${c.pain} sendirian, lihat ini dulu sih`, demo: `[medium pause] Nah, untuk ${c.aktivitas}, ${c.produk} punya detail ${c.proof} ya`, cta: `Lihat apakah cocok di keranjang kuning sih` }),
  (c) => ({ hook: `[fast] Eh, khusus yang sering ${c.aktivitas}, cek detail ini`, demo: `[long pause] ${c.produk} menampilkan ${c.proof} tanpa dilebihkan loh`, cta: `Kalau itu kamu, detailnya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [giggles] masih nganggep ${c.pain} nggak kelihatan dari jauh?`, demo: `[short pause] Nah, amati tampilan ${c.proof} milik ${c.produk}, lalu kaitkan dengan rutinitasmu hari ini sih`, cta: `Nilai kecocokannya lewat keranjang kuning ya` }),
];

const SPILL_RAHASIA: CopyFn[] = [
  (c) => ({ hook: `[serious] Detail ${c.noun} ini nggak akan kelihatan kalau cuma dilihat sekilas loh`, demo: `[short pause] Nah, telusuri ${c.proof} dari ${c.produk} secara dekat sih`, cta: `Rahasia lengkapnya ada di keranjang kuning dong` }),
  (c) => ({ hook: `[whispers] Eh, hal kecil ini sering banget kelewat begitu saja`, demo: `[medium pause] Pada ${c.produk}, sorot permukaan ${c.proof} yang terlihat ya`, cta: `Kalau mau teliti juga, cek keranjang kuning deh` }),
  (c) => ({ hook: `[whispers] ${c.reg.sapaan}, rahasianya bukan di barangnya, tapi di cara memeriksanya sih`, demo: `[long pause] Nah, cocokkan atribut ${c.proof} milik ${c.produk} dengan kebutuhanmu loh`, cta: `Bocorannya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[whispers] Nggak kelihatan dari jauh, eh [giggles] petunjuknya baru muncul kalau didekatkan`, demo: `[short pause] ${c.reg.me} menyorot ${c.proof} yang tampak pada ${c.produk} ya`, cta: `Lihat rinciannya lebih dekat sekarang lewat keranjang kuning loh` }),
];

const T01: CopyFn[] = [
  (c) => ({ hook: `[excited] Buat yang sering bepergian, eh tapi nggak mau ribet bawa ${c.noun}`, demo: `[short pause] Cek ukuran ${c.produk}, penutup, serta ${c.proof} sebelum dibawa ya`, cta: `Kalau sering mobile, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, ${c.reg.sapaan}, ruang bawaan terbatas bikin setiap ukuran penting`, demo: `[medium pause] Pastikan ${c.proof} milik ${c.produk} benar-benar sesuai ruang bawaanmu sih`, cta: `Simpan opsinya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Buat yang sering keluar rumah, eh cara nyimpennya ini penting`, demo: `[long pause] Nah, periksa cara menyimpan ${c.produk} serta detail ${c.proof} loh`, cta: `Yang suka bepergian, buka keranjang kuning tuh` }),
  (c) => ({ hook: `[fast] Nah, jauh dari rumah? [giggles] Siapkan ruang khusus di bawaan`, demo: `[short pause] Tentukan ruang untuk ${c.produk}; lihat ukuran kemasan dan ${c.proof} sebelum membawanya deh`, cta: `Dimensinya ada di keranjang kuning ya` }),
];

const T02: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, ${c.reg.me} bedah barang ini bagian demi bagian ya`, demo: `[short pause] Buka ${c.produk}, lalu tunjuk bagian yang sering disentuh. Bagaimana sambungannya, cara pakainya, dan tampilan ${c.proof}? Gerakkan setiap bagian pelan-pelan dari dua arah, lalu bandingkan harga ${c.harga} setelah semuanya terlihat jelas ya`, cta: `Rincian lengkapnya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Eh, jangan nilai bentuk luarnya dulu, lihat keterangannya`, demo: `[medium pause] Mulai dari nama bagian pada ${c.produk}, kemudian cocokkan dengan petunjuknya. Lihat ${c.proof} dari dekat, coba gerakkan komponen yang ditunjukkan, lalu tanyakan apakah fungsinya sesuai untuk ${c.aktivitas}. Banderolnya ${c.harga} sekarang sih`, cta: `Rincian resminya ada di keranjang kuning sih` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, satu bagian satu pertanyaan, jangan tertipu tampilan`, demo: `[long pause] Putar ${c.produk}, cek sambungan, kontrol, dan petunjuknya. Nah, apakah ${c.proof} terlihat di setiap sisi? Coba bagian yang bisa digerakkan untuk ${c.aktivitas}, lalu bandingkan harga ${c.harga} setelah tahu fitur yang relevan ya`, cta: `Datanya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[slow] Barang teknis begini harus diperiksa dulu, bukan langsung dipuji`, demo: `[short pause] Mulai dari bagian utama ${c.produk}, lalu ikuti cara pakainya pelan-pelan. Nah, tunjukkan ${c.proof} dari dekat dan coba dalam konteks ${c.aktivitas}. Saat ${c.pain} jadi perhatian, bagian mana yang ingin ${c.reg.you} cek? Setelah itu, bandingkan harga ${c.harga} deh`, cta: `Kalau datanya relevan, buka keranjang kuning ya` }),
];

const T03: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, ikut ${c.reg.me} keliling lokasi ini dari pintu masuk sampai ke sudut terakhir`, demo: `[short pause] Baru masuk, suasananya langsung terasa. Ada ${c.produk} di area ini; yuk dekati, lihat ${c.proof}, lalu tanya staf cara mendapatkannya. Coba lihat, ada sudut lain yang menarik nggak ya?`, cta: `Kalau mau cari produknya, cek keranjang kuning dong` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, ramainya nggak nyangka ya; kita cari satu sudut yang paling menarik di sini`, demo: `[medium pause] Kita mulai dari area utama dan pilihan yang dipajang. Nah, ${c.produk} ada di sini; lihat ${c.proof}, baca keterangannya, lalu lanjut keliling. Setelah itu, kita pindah ke area berikutnya sih`, cta: `Info produknya tersedia di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Nah, belum masuk aja udah ada temuan menarik dekat pintu; yuk kita lihat bareng-bareng`, demo: `[long pause] Di sudut ini ada aktivitas yang bisa dicoba dan informasi yang bisa ditanya. Saat ${c.produk} muncul, kita lihat ${c.proof} dari dekat. Menurut kalian, detail ini menarik nggak sih?`, cta: `Kalau tertarik barangnya, buka keranjang kuning deh` }),
  (c) => ({ hook: `[slow] Eh, suasana acaranya terasa bahkan sebelum barangnya kelihatan mulai dari pintu depan`, demo: `[short pause] Keliling dulu, dengarkan suasananya, lalu berhenti di ${c.produk}. Detail ${c.proof} kelihatan dari sini; kalau penasaran, tanyakan langsung pada penjaganya. Dari dekat, bentuknya berbeda dibanding dari pintu masuk tadi deh`, cta: `Detail pembeliannya langsung ada di keranjang kuning loh` }),
];

const T04: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, bunyi bungkusnya bikin ${c.reg.me} penasaran sama isinya`, demo: `[short pause] Buka ${c.produk}, baca label rasa, lalu periksa ${c.proof} ya`, cta: `Kalau penasaran, detailnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[whispers] Kirain harus dicicip dulu, eh ternyata bunyinya udah cerita banyak`, demo: `[medium pause] Bunyi ${c.produk} memancing rasa penasaran; rasanya menunggu dicicipi sih`, cta: `Semua pilihan rasanya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[whispers] ${c.reg.sapaan}, eh belum dicicip pun teksturnya udah kedengaran dari bunyinya`, demo: `[long pause] Cek komposisi ${c.produk} dan ${c.proof} loh`, cta: `Kalau ingin mencoba, rinciannya ada di keranjang kuning tuh` }),
  (c) => ({ hook: `[whispers] Belum kelihatan apa-apa, eh [giggles] tapi suaranya bikin pengin buka bungkusnya`, demo: `[short pause] Dengarkan teksturnya, baca label ${c.produk}, lalu pertimbangkan ${c.proof} deh`, cta: `Pilihan rasanya ada di keranjang kuning deh` }),
];

const T05: CopyFn[] = [
  (c) => ({ hook: `Nah, satu tampilan ini siap diperiksa?`, demo: `Letakkan ${c.produk} pada cahaya netral, lalu catat ${c.proof} yang terlihat ya`, cta: `Cek rinciannya di keranjang kuning deh` }),
  (c) => ({ hook: `Eh, posisi produknya sudah tetap?`, demo: `Amati ${c.proof} pada ${c.produk} dalam keadaan yang sama sih`, cta: `Catat detailnya lewat keranjang kuning sih` }),
  (c) => ({ hook: `Nah, detail mana yang terlihat sekarang?`, demo: `Arahkan ${c.produk} ke cahaya merata dan periksa ${c.proof} loh`, cta: `Buka rinciannya di keranjang kuning deh` }),
  (c) => ({ hook: `Satu pengamatan tetap sudah cukup, belum?`, demo: `Nah, jaga posisi ${c.produk}, lalu catat ${c.proof} yang tampak saat ini ya`, cta: `Cek catatannya di keranjang kuning ya` }),
];

const T06: CopyFn[] = [
  (c) => ({ hook: `Nah, pilih variannya dulu; jangan ngintip jawabannya`, demo: `Tampilkan pilihan ${c.produk} satu-satu; bandingkan label, pilihan, dan atribut ${c.proof} ya`, cta: `Tulis pilihanmu, lalu cek keranjang kuning dong` }),
  (c) => ({ hook: `Eh, kirain sama semua; ternyata tiap varian beda detailnya`, demo: `Jangan anggap tiap varian sama; cek nama resmi dan detail ${c.proof} masing-masing sih`, cta: `Pilih versimu di keranjang kuning deh ya` }),
  (c) => ({ hook: `${c.reg.sapaan}, mata ${c.reg.you} berhenti di pilihan yang mana?`, demo: `Nah, susun ${c.produk} berurutan supaya perbedaan ${c.proof} mudah diperiksa loh`, cta: `Cocokkan pilihan di keranjang kuning ya` }),
  (c) => ({ hook: `Dari semuanya, eh satu pilihan ini yang paling bikin mata berhenti`, demo: `Tentukan varian dari informasi ${c.proof}, bukan dugaan pribadi ya`, cta: `Variannya ada di keranjang kuning deh loh` }),
];

const T07: CopyFn[] = [
  (c) => ({ hook: `[serious] Buat yang bingung mulai dari mana, checklist ini mulai dari ${c.pain}`, demo: `[short pause] Nah, centang setelah ${c.proof} ${c.produk} terlihat ya`, cta: `Kalau checklistnya relevan, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, jangan dicentang sebelum aksinya benar-benar kelihatan`, demo: `[medium pause] Nah, poin pertama: ${c.produk} punya ${c.proof}? Cari jawabannya pada barangnya langsung sih`, cta: `Manfaatnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, setiap poin harus punya jawaban yang terlihat`, demo: `[long pause] Baca poin, cari buktinya pada ${c.produk} bila ${c.proof} terlihat loh`, cta: `Kalau buktinya cukup, buka keranjang kuning tuh` }),
  (c) => ({ hook: `[fast] Nah, [giggles] belum ngapa-ngapain, satu tindakan ini udah ngisi checklist pertama`, demo: `[short pause] Sumpah, [giggles] checklist ${c.produk} harus berisi spesifikasi yang tersedia, termasuk ${c.proof} deh`, cta: `Cocokkan kebutuhanmu di keranjang kuning ya` }),
];

const T08: CopyFn[] = [
  (c) => ({ hook: `Nah, atribut apa yang terlihat di sini?`, demo: `Arahkan ${c.produk}; tulis ${c.proof} yang tampak ya`, cta: `Cara pakai ada di keranjang kuning ya` }),
  (c) => ({ hook: `Eh, satu pengamatan ini sudah cukup jelas?`, demo: `Baca label ${c.produk}, kemudian periksa ${c.proof} dalam posisi tetap sih`, cta: `Rinciannya ada di keranjang kuning sih` }),
  (c) => ({ hook: `Nah, kondisi cahayanya sudah merata?`, demo: `Taruh ${c.produk} di meja; amati ${c.proof} tanpa menggeser posisinya, loh`, cta: `Petunjuknya ada di keranjang kuning ya` }),
  (c) => ({ hook: `Sumpah, detail kecilnya mudah terlewat, ya?`, demo: `Dekatkan ${c.produk} tanpa memindahkannya, lalu tulis ${c.proof} yang tampak ya`, cta: `Catatannya ada di keranjang kuning deh` }),
];

const T09: CopyFn[] = [
  (c) => ({ hook: `[serious] Buat yang suka riset, jangan berhenti di label depan ya`, demo: `[short pause] Nah, baca label ${c.produk} bareng ${c.reg.me}, lalu lihat ${c.proof} saat digunakan. Putar kemasannya, cek petunjuk pakai, dan cocokkan harga ${c.harga} dengan kebutuhan ${c.aktivitas}. Bagian mana yang paling ingin kalian cek ya?`, cta: `Informasi resminya ada di keranjang kuning dong` }),
  (c) => ({ hook: `[slow] ${c.reg.sapaan}, nama teknis belum tentu menjelaskan semuanya sih`, demo: `[medium pause] Nama teknis di kemasan ${c.produk} perlu dibaca bareng cara pakainya. Nah, putar kemasannya, lihat ${c.proof}, lalu tanyakan apakah urutannya masuk ke ${c.aktivitas}. Banderol ${c.harga} bisa dibandingkan setelah memahami seluruh langkahnya tadi sih`, cta: `Deskripsi resminya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Nah, formula harus dibaca, bukan ditebak dari warna`, demo: `[long pause] Mulai dari keterangan ${c.produk}, lalu lihat ${c.proof} saat digunakan. Apa yang tertulis di label, bagaimana urutan pakainya, dan bagian mana yang perlu ditanyakan? Dengan harga ${c.harga}, cocokkan semua itu dengan ${c.aktivitas} milik ${c.reg.you} ya`, cta: `Sumber produknya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[whispers] Buat pembeli teliti, fakta dan kesan jangan dicampur ya`, demo: `[short pause] Di ${c.produk}, kita bisa baca cara pakai, melihat ${c.proof}, dan mengecek harga ${c.harga}. Nah, sekarang pertanyaannya: apakah rangkaian ini masuk ke rutinitas ${c.aktivitas} milik ${c.reg.you}? Coba cocokkan seluruh urutan langkahnya satu per satu deh`, cta: `Keterangannya ada di keranjang kuning loh` }),
];

const T10: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, uji kecil ini nggak sah kalau aturannya nggak jelas sejak awal`, demo: `[short pause] Ikuti petunjuk ${c.produk}; periksa ${c.proof} sebagai atribut saja ya`, cta: `Cek petunjuk di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, jangan ganti cahaya dan posisi di tengah jalan`, demo: `[medium pause] Nah, gunakan informasi resmi ${c.produk} untuk memahami ${c.proof} sih`, cta: `Detail resminya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, bukti tanpa konteks gampang bikin salah baca, ${c.reg.sapaan}`, demo: `[long pause] Sebelum mencoba ${c.produk}, cek petunjuk dan atribut ${c.proof} loh`, cta: `Lihat cara pakai di keranjang kuning tuh` }),
  (c) => ({ hook: `[fast] Kalau kondisinya nggak setara, eh [giggles] hasilnya nggak bisa dipercaya`, demo: `[short pause] Oleskan ${c.produk} pada area kecil, samakan cahayanya, lihat ${c.proof} deh`, cta: `Panduannya ada di keranjang kuning deh` }),
];

const T11: CopyFn[] = [
  (c) => ({ hook: `Eh, permukaan sedekat ini kelihatan seperti benda lain`, demo: `Mulai dari detail ${c.proof}, lalu mundur perlahan sampai ${c.produk} terungkap sepenuhnya ya`, cta: `Kalau masih penasaran, cek keranjang kuning ya` }),
  (c) => ({ hook: `Sumpah, bentuk dekatnya bikin ${c.reg.me} salah sangka`, demo: `Bentuk dekatnya boleh jadi teka-teki; jawabannya cukup nama ${c.produk} dan atribut ${c.proof} sih`, cta: `Reveal lengkap di keranjang kuning sih` }),
  (c) => ({ hook: `Nah, jangan buka labelnya; fokus ke permukaannya dulu`, demo: `Nah, tahan nama produknya sebentar, perlihatkan ${c.proof}, lalu ungkap ${c.produk} loh`, cta: `Nama lengkapnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `${c.reg.sapaan}, coba tebak benda asing yang kelihatan dekat ini`, demo: `Sumpah, misterinya selesai ketika bentuk utuh ${c.produk} terlihat; setelah itu cek ${c.proof} deh`, cta: `Kalau jawabannya menarik, buka keranjang kuning deh` }),
];

const T12: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, kalau pilih ${c.noun}, apa yang pertama ${c.reg.you} nilai sebelum memutuskan membeli barangnya hari ini?`, demo: `[short pause] ${c.reg.sapaan}, kalau lihat kategori ${c.noun}, bagian apa yang pertama kali kalian cek? Kalau jawabannya ${c.proof}, alasannya apa? Sekarang lihat ${c.produk} dari dekat. Setuju atau punya jawaban lain ya?`, cta: `Cocokkan tulisan kartunya dengan rincian di keranjang kuning dong` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, standar sederhana buat ${c.noun} menurut kalian apa saat sedang pilih barang?`, demo: `[medium pause] Satu orang bilang praktis, yang lain fokus ke detail. Kalau ${c.proof} jadi pertimbangan kalian, apa yang ingin dilihat lebih dulu dari ${c.produk}? Sebut alasan pilihan kalian secara singkat sih`, cta: `Nah, baca nama produknya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, rekomendasi yang berguna selalu punya alasan; alasanmu apa sebelum ikut membeli?`, demo: `[long pause] Pertanyaannya simpel: kapan kalian memakai kategori ini, dan detail apa yang menentukan pilihan? Setelah dengar jawabannya, lihat apakah ${c.proof} pada ${c.produk} menjawab kebutuhan itu. Apa alasan pilihanmu ya?`, cta: `Informasi pada kartu tersedia di keranjang kuning sekarang ya` }),
  (c) => ({ hook: `[slow] Eh, seberapa jauh pendapat orang tentang ${c.noun} bisa berbeda dari satu pertanyaan?`, demo: `[short pause] Eh, ada yang fokus bentuk, ada yang melihat fungsi, dan ada yang bertanya harga. Sekarang giliran ${c.reg.you}: bagaimana melihat detail ${c.proof} dari ${c.produk}? Ceritakan alasan dan urutan pertimbanganmu secara terbuka deh`, cta: `Periksa lagi nama pada kartunya lewat keranjang kuning loh` }),
];

const ADS_UNBOXING_POV: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, kali ini kita melihat dari dalam kardus langsung`, demo: `[short pause] Cocokkan isi ${c.produk} dengan daftar resminya ya`, cta: `Cek isi paket serupa di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Eh, tangan siapa yang pertama masuk ke paket?`, demo: `[medium pause] Tangan mengambil ${c.produk}; periksa jumlah isi dan ${c.proof} sih`, cta: `Isi paket ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Kirain dari samping, eh ternyata tutupnya terbuka tepat di atas kita`, demo: `[long pause] Angkat ${c.produk}, tunjukkan label, lalu tanyakan detail ${c.proof} loh`, cta: `Teliti isi paket lengkapnya lewat keranjang kuning tuh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [giggles] sudut bawah tutup ternyata paling seru dilihat`, demo: `[short pause] Nah, [giggles] cocokkan ${c.produk} satu per satu dengan rincian ${c.proof} deh`, cta: `Cek daftar isi paket di keranjang kuning ya` }),
];

const ADS_MEJA_KOSONG: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, meja penuh ini sebenarnya butuh berapa alat?`, demo: `[short pause] Daftar alatnya, lalu cari atribut ${c.proof} dalam spesifikasi ${c.produk} ya`, cta: `Nilai alurnya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, alat mana yang bisa disimpan tanpa mengganggu kerja?`, demo: `[medium pause] Baca spesifikasi ${c.produk}; tanyakan peran ${c.proof} dalam alurmu sih`, cta: `Rinciannya ada di keranjang kuning sih` }),
  (c) => ({ hook: `[fast] Nah, kali ini mejanya justru berkurang sampai terasa lebih lega, ${c.reg.sapaan}`, demo: `[long pause] Pastikan fitur resmi ${c.produk} mencakup kebutuhan ${c.proof} loh`, cta: `Rapikan alurnya melalui keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Kenapa meja sebagus ini dibiarkan kosong? [giggles] Nah, ada alasannya`, demo: `[short pause] Hitung [giggles] dulu langkah kerjanya; verifikasi ${c.produk} lewat keterangan ${c.proof} deh`, cta: `Fiturnya ada di keranjang kuning deh` }),
];

const ADS_PANAS: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, suhu ruangan ini naik terus tiap detik`, demo: `[short pause] Sebelum memilih ${c.produk}, cek relevansi ${c.proof} untuk ${c.pain} ya`, cta: `Kalau keluhannya sama, cek keranjang kuning dong` }),
  (c) => ({ hook: `[fast] Eh, udaranya makin gerah bahkan sebelum semuanya mulai`, demo: `[medium pause] Baca fungsi ${c.produk}, lalu tanyakan peran ${c.proof} sih`, cta: `Cara kerjanya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, panasnya sudah kelewatan banget sejak tadi sih`, demo: `[long pause] Nah, keputusan tetap dari spesifikasi ${c.produk}, terutama ${c.proof} loh`, cta: `Cocokkan fungsinya melalui keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Jangan percaya suasananya, [giggles] cek barangnya dulu ya`, demo: `[short pause] Bandingkan kebutuhanmu terhadap atribut ${c.proof} dari ${c.produk} deh`, cta: `Nah, periksa data resminya sekarang di keranjang kuning loh` }),
];

const ADS_TEMBUS: CopyFn[] = [
  (c) => ({ hook: `[excited] Eh, sesuatu baru saja menembus dinding belakang`, demo: `[short pause] Eh, barusan ada suara besar dari belakang. Setelah debunya turun, taruh ${c.produk} di meja, lihat ${c.proof}, lalu coba cara pakainya untuk ${c.aktivitas}. Sesudah dicoba, apa yang masih bikin ${c.reg.you} penasaran ya`, cta: `Kalau produk aslinya menarik, cek keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Nah, benturan tadi jelas bukan suara biasa dari ruangan sebelah sana`, demo: `[medium pause] Nah, temboknya memang bikin kaget, tetapi pertanyaannya sederhana: apa yang benar-benar tersedia pada ${c.produk}? Cari ${c.proof}, baca cara pakai, putar barangnya ke sisi lain, dan pastikan kategorinya sesuai kebutuhanmu sebelum membuka keranjang sih`, cta: `Rincian sebenarnya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Kirain cuma angin, ternyata suasana di belakang berubah total`, demo: `[long pause] Sumpah, suasananya berubah cepat. Setelah debu turun, taruh ${c.produk} di meja, baca kategorinya, lihat cara pakai, lalu cari detail ${c.proof}. Coba tunjukkan langkah pertama: fungsinya menjawab kebutuhan ${c.aktivitas} atau nggak sekarang ya`, cta: `Kalau penjelasannya jelas, buka keranjang kuning tuh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [laughs] lihat tembok belakangnya dulu sebelum bertanya ke orangnya`, demo: `[short pause] ${c.reg.sapaan}, [laughs] nah temboknya sudah tenang; waktunya menilai ${c.produk} secara biasa. Mulai dari ${c.proof}, lanjut ke keterangan penggunaan, lalu coba satu langkah dan tanyakan hal yang belum jelas. Pilih hanya jika informasinya cocok dengan kebutuhanmu deh`, cta: `Nilai barangnya lewat keranjang kuning deh` }),
];

const ADS_ATAP: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, siapa yang baru jatuh dari atap barusan?`, demo: `[short pause] Setelah berdiri, buka keterangan ${c.produk} dan cari ${c.proof} ya`, cta: `Telaah rinciannya melalui keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, suara dari atas makin dekat sekarang`, demo: `[medium pause] Ia membawa ${c.produk}; periksa label serta atribut ${c.proof} sih`, cta: `Wujud aslinya ada di keranjang kuning sih` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, orang itu masuk lewat jalur yang salah`, demo: `[long pause] Nah, nilai ${c.produk} hanya dari informasi ${c.proof} loh`, cta: `Kalau jelas, buka rincian di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Nggak ada yang nyangka, eh [laughs] jalur masuknya kacau dan semua menoleh`, demo: `[short pause] Sebelum heboh, cek kategori ${c.produk} serta rincian ${c.proof} deh`, cta: `Pilihan barangnya ada di keranjang kuning deh` }),
];

const ADS_PINTU: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, pintunya baru saja didobrak keras dari luar`, demo: `[short pause] Orang itu membawa ${c.produk}; periksa informasi ${c.proof} ya`, cta: `Kalau pesannya sampai, cek keranjang kuning dong` }),
  (c) => ({ hook: `[fast] Eh, ruangan tenang ini mendadak ramai dalam sekejap tadi`, demo: `[medium pause] Pilih perlahan: baca keterangan ${c.produk}, terutama ${c.proof} sih`, cta: `Barangnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, seseorang datang sambil membawa satu jawaban`, demo: `[long pause] Nah, ia meletakkan ${c.produk}; tanyakan kecocokan ${c.proof} loh`, cta: `Kalau sesuai, buka rincian di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Masuknya heboh banget, eh [laughs] tapi pesannya sederhana sekali`, demo: `[short pause] Sebelum memilih ${c.produk}, teliti informasi ${c.proof} deh`, cta: `Cek sumber informasi resminya sekarang di keranjang kuning loh` }),
];

const ADS_WAKTU: CopyFn[] = [
  (c) => ({ hook: `[excited] Eh, semua gerakan mendadak berhenti dalam satu detik`, demo: `[short pause] ${c.reg.me} membaca keterangan ${c.produk}, terutama bagian ${c.proof} ya`, cta: `Temukan data lanjutannya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Belum pernah lihat pasar seramai ini mendadak diam total`, demo: `[medium pause] Eh, periksa label ${c.produk} dan rincian ${c.proof} sih`, cta: `Lihat fakta barang di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, waktunya macet tapi ${c.reg.me} masih bergerak`, demo: `[long pause] Nah, keputusan menunggu informasi ${c.produk}, termasuk ${c.proof} loh`, cta: `Kalau cocok, buka rincian barang di keranjang kuning tuh` }),
  (c) => ({ hook: `[slow] Eh, semua orang baru saja membeku di tempat`, demo: `[short pause] Sumpah, cocokkan ${c.produk} dengan kebutuhan terkait ${c.proof} deh`, cta: `Barang sebenarnya ada di keranjang kuning deh` }),
];

const KENALIN_BISNIS: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, kenalan dengan layanan yang baru muncul ini`, demo: `[short pause] ${c.produk} mencantumkan ${c.proof}; tanyakan cakupannya untuk ${c.aktivitas} sih`, cta: `Kalau butuh penjelasan, cek keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, layanan ini memang bukan buat semua orang`, demo: `[medium pause] ${c.identitas} bisa menilai ${c.produk} dari keterangan ${c.proof} ya`, cta: `Lihat cakupannya langsung di keranjang kuning sih` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, kenalan lewat kebutuhan yang paling terasa dulu`, demo: `[long pause] Nah, mulai dari ${c.pain}, lalu tanyakan pada ${c.produk} soal rincian ${c.proof} loh`, cta: `Kalau konteksmu sama, buka keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Namanya belum pernah kalian dengar, eh dan itu justru menariknya`, demo: `[short pause] Kenali ${c.produk} lewat informasi ${c.proof} dan sasaran ${c.identitas} sih`, cta: `Pelajari bisnisnya sekarang di keranjang kuning deh` }),
];

const PROMO_TERBATAS: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, ${c.harga} adalah harga yang tampil saat ini`, demo: `[short pause] Pada ${c.produk}, bagian mana menunjukkan ${c.proof}? Harga tercantumnya ${c.harga}, cek lagi ya`, cta: `Konfirmasi harga tercantum di keranjang kuning dong` }),
  (c) => ({ hook: `[fast] Eh, lihat barangnya dulu sebelum menilai harganya`, demo: `[medium pause] Sebelum menilai ${c.proof} dari ${c.produk}, lihat rinciannya; harga tercantumnya ${c.harga} sih`, cta: `Bandingkan harganya lewat keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, fokus ke detail sebelum harga ${c.harga}`, demo: `[long pause] Nah, lihat ${c.produk} saat ${c.aktivitas}; periksa ${c.proof}, lalu bandingkan dengan harga ${c.harga} loh`, cta: `Cek harganya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Harga jujur [giggles] nggak perlu menakut-nakuti siapa pun`, demo: `[short pause] Cek ${c.proof} pada ${c.produk}; harga tercantumnya ${c.harga}, lalu bandingkan sendiri deh`, cta: `Nah, periksa harga produknya ada di keranjang kuning loh` }),
];

// ---------------------------------------------------------------------------
// TVC — genre terpisah, bukan varian gaya dari konten afiliasi.
//
// Vonis Brian 16 Agu 2026: "tvc concept salah semua disapproved". Naskah TVC
// lama memakai kerangka afiliasi — menyebut harga di hook, bertanya balik ke
// penonton, dan menutup dengan "cek keranjang kuning". Tidak satu pun menyebut
// merek. Yang ditonton jadi visual sinematik yang dijalankan naskah live
// selling.
//
// Aturan genre ini diambil dari playbook produksi 6 TVC nyata (11-12 Agu 2026):
//   - busur VO: masalah -> ketegangan -> kebenaran produk -> MEREK
//   - penutup WAJIB menyebut nama produk (D4; TVC Mom & Baby pernah selesai
//     tanpa pernah menyebut merek sama sekali)
//   - satu klaim, satu emosi — menumpuk tiga manfaat menghasilkan nol yang
//     diingat
//   - haram dua negasi (D1; klien menolak "nggak pernah nggak siap" dengan
//     kata-kata "ga jelas itu apa")
//   - haram menyebut keranjang: itu mengembalikan genrenya jadi afiliasi
//   - harga TIDAK dipimpin di hook; hook 0-3 dtk wajib terikat produk
// Dijaga mesin oleh T-01..T-03 di validator.ts.
//
// Penanda pembawaan di sini SENGAJA hanya tag jeda. Playbook C4 mencatat empat
// baris VO terdengar seperti empat orang berbeda ketika arahan gayanya
// berbeda-beda, padahal nama suaranya sama. Jeda mengatur waktu tanpa menyentuh
// karakter suara; [serious]/[whispers]/[excited] menyentuhnya. [slow] dan
// [fast] juga dihindari — playbook C5 mencatat permintaan "pelan" membuat satu
// baris meregang jadi 13,5 detik, tiga kali lipat dari seharusnya.
// ---------------------------------------------------------------------------

const TVC_DROP: CopyFn[] = [
  (c) => ({
    hook: `[serious] Satu tetes jatuh, dan seluruh ceritanya dimulai dari sana.`,
    demo: `[medium pause] Ia menyentuh permukaan, melambat, lalu menemukan bentuknya sendiri. Bagian inilah yang paling sering diburu orang, padahal justru di sini semuanya ditentukan. Yang membuat ${c.noun} ini mahal bukan kemasannya, melainkan ${c.proof} yang cuma muncul kalau prosesnya sabar.`,
    cta: `[short pause] ${c.produk}. Namanya terlihat di kemasan.`,
  }),
  (c) => ({
    hook: `Kenapa harus sepelan ini? Karena yang bagus memang tidak bisa diburu.`,
    demo: `[medium pause] Setiap tetes butuh waktunya sendiri untuk terbentuk, dan waktu itu tidak bisa ditawar sedikit pun. Cepat semenit saja, ${c.proof} yang dikejar bertahun-tahun hilang begitu saja dari permukaannya, dan tidak ada cara mengulangnya.`,
    cta: `[short pause] Pandangan berhenti pada ${c.produk}.`,
  }),
  (c) => ({
    hook: `Ada jarak sangat pendek antara ujung pipet dan permukaan kulit.`,
    demo: `[long pause] Di jarak sependek itulah semuanya ditentukan, walau hampir tidak ada yang memperhatikannya. Sedikit saja goyah, hasilnya berubah. Tetesannya harus utuh saat mendarat, karena ${c.proof} hanya terbaca kalau bentuknya sampai tanpa pecah di tengah jalan menuju permukaan.`,
    cta: `[short pause] Nama pada kemasan: ${c.produk}.`,
  }),
  (c) => ({
    hook: `Kalau diperbesar, satu tetes ternyata punya isi yang panjang ceritanya.`,
    demo: `[short pause] Lapisannya bergerak, cahayanya berpindah, dan ${c.proof} baru benar-benar terbaca di detik keempat. Tiga detik pertama belum menceritakan apa-apa. Itu sebabnya ${c.noun} ini dibuat untuk dilihat dari dekat, pelan-pelan, bukan dinilai sekilas dari jauh sambil lewat.`,
    cta: `[medium pause] ${c.produk}. Terlihat di akhir adegan.`,
  }),
];

const TVC_TERSANGKA: CopyFn[] = [
  (c) => ({
    hook: `[serious] Sidang dibuka. Terdakwa dituduh terlihat jauh lebih segar dari biasanya.`,
    demo: `[medium pause] Saksi bersikeras ada yang berubah sejak dua minggu terakhir. Jaksa menuntut bukti, penonton mulai berbisik, dan suasananya berubah tegang. Hakim mengetuk palu meminta tenang. Terdakwa akhirnya mengaku, lalu mengeluarkan satu benda kecil dari tasnya, lengkap dengan ${c.proof}.`,
    cta: `[short pause] ${c.produk}. Nama di meja rekaan.`,
  }),
  (c) => ({
    hook: `Yang mulia, saya keberatan. Saksi terlihat terlalu segar untuk jam segini.`,
    demo: `[medium pause] Ruangan langsung hening dan semua mata pindah ke meja barang bukti. Ternyata yang tergeletak di sana sederhana sekali, sama sekali tidak mewah, tapi ${c.proof} terbaca jelas bahkan dari kursi penonton paling belakang.`,
    cta: `[short pause] Hakim rekaan menyebut ${c.produk}.`,
  }),
  (c) => ({
    hook: `Kasus hari ini aneh: yang menuduh justru ikut mencatat nama barangnya.`,
    demo: `[long pause] Hakim bertanya sekali lagi dengan nada lebih tinggi, dan si penuduh mengelak sambil menunduk. Ruangan menunggu jawaban yang tidak datang. Sayangnya kamera ruang sidang menangkap tangannya sedang memotret meja bukti, tepat di bagian ${c.proof} yang tadi dia ributkan.`,
    cta: `[short pause] Catatan itu menyebut ${c.produk}.`,
  }),
  (c) => ({
    hook: `Pertanyaannya cuma satu: sejak kapan terdakwa mulai terlihat seperti ini?`,
    demo: `[short pause] Terdakwa diam agak lama, seperti menimbang harus jujur atau tidak. Ruangan ikut menunggu. Lalu dia menjawab pelan bahwa semuanya berubah sejak dia berhenti mencoba banyak hal sekaligus, dan menyisakan satu saja yang ${c.proof} konsisten.`,
    cta: `[medium pause] ${c.produk}. Adegan sidang selesai.`,
  }),
];

const TVC_SEHARIAN: CopyFn[] = [
  (c) => ({
    hook: `[serious] Jam tujuh pagi semuanya masih aman. Masalahnya, hari belum mulai.`,
    demo: `[medium pause] Lalu datang panas jalanan, ruangan ber-AC yang kering, rapat yang mundur dua jam, dan macet panjang di jalan pulang. Semuanya menumpuk sejak pagi. Baru jam tujuh malam ketahuan siapa yang benar-benar bertahan, dan ${c.proof} yang menjawab.`,
    cta: `[short pause] ${c.produk}. Nama di akhir hari.`,
  }),
  (c) => ({
    hook: `Hari tidak pernah menunggu siapa pun siap. Termasuk hari ini.`,
    demo: `[medium pause] Jadwal maju, jalanan padat, semuanya minta serba cepat sejak pagi buta. Yang bagus bukan yang terlihat bagus jam delapan pagi waktu belum terjadi apa-apa, tapi yang ${c.proof} masih utuh waktu kamu sampai rumah.`,
    cta: `[short pause] Lampu rumah menyorot ${c.produk}.`,
  }),
  (c) => ({
    hook: `Ada jarak dua belas jam antara berangkat dan sampai rumah lagi.`,
    demo: `[long pause] Dua belas jam itu yang hampir tidak pernah ditunjukkan siapa pun. Panas, keringat, ruangan dingin, lalu panas lagi, berulang-ulang tanpa jeda. Berulang setiap hari kerja. ${c.proof} baru jujur sesudah melewati semuanya, bukan sebelum.`,
    cta: `[short pause] Hari ditutup oleh ${c.produk}.`,
  }),
  (c) => ({
    hook: `Pertanyaannya bukan bagus atau tidak. Tapi masih bagus jam berapa.`,
    demo: `[short pause] Pagi hampir semuanya kelihatan sama saja, susah dibedakan. Semuanya masih terlihat menjanjikan. Bedanya baru muncul menjelang sore, waktu tenaga habis, waktu tidak ada yang sempat memperbaiki apa pun, dan ${c.proof} harus bekerja sendirian.`,
    cta: `[medium pause] ${c.produk}. Ada di bingkai terakhir.`,
  }),
];

const TVC_KAIN: CopyFn[] = [
  (c) => ({
    hook: `[serious] Semua orang memotret baju sambil berdiri diam. Itu masalahnya.`,
    demo: `[medium pause] Karena kamu memakainya sambil berjalan, berbelok, duduk, lalu buru-buru berdiri lagi. Sepanjang hari, tanpa jeda. Yang bagus bukan yang cantik waktu diam di depan kamera, tapi yang ${c.proof} tetap terjaga persis waktu kamu bergerak cepat.`,
    cta: `[short pause] ${c.produk}. Nama pada busana itu.`,
  }),
  (c) => ({
    hook: `Coba nilai satu potongan dari foto diam. Hampir selalu meleset.`,
    demo: `[medium pause] Bentuk aslinya baru keluar waktu tubuh berbelok dan lipatannya menyusul setengah detik kemudian, bukan sebelum itu. Foto tidak pernah menangkap bagian ini. Di situ ${c.proof} terbaca paling jujur, dan di situ juga potongan yang biasa saja langsung ketahuan.`,
    cta: `[short pause] Gerakan berhenti pada ${c.produk}.`,
  }),
  (c) => ({
    hook: `Ada setengah detik antara langkah kaki dan kain yang menyusul.`,
    demo: `[long pause] Setengah detik itu yang membedakan jatuh bahan mahal dari yang murah, dan hampir tidak ada yang menyadarinya. Padahal justru di sana bedanya. Kalau ${c.proof} benar, kainnya berhenti sesudah kamu berhenti, bukan mendahului langkahmu sendiri.`,
    cta: `[short pause] Nama busana itu: ${c.produk}.`,
  }),
  (c) => ({
    hook: `Bukan busana yang bagus untuk berpose. Ini untuk hari yang sibuk.`,
    demo: `[short pause] Naik motor, masuk ruangan dingin, duduk lama di kursi kantor, lalu berdiri lagi buru-buru. Belum termasuk cuaca di jalan. Semua itu meremas kain sepanjang hari. Yang tersisa sesudahnya, ${c.proof}, itu yang menentukan pantas atau tidak.`,
    cta: `[medium pause] ${c.produk}. Terlihat di bingkai akhir.`,
  }),
];

const TVC_JAM_TIGA: CopyFn[] = [
  (c) => ({
    hook: `[serious] Jam tiga pagi. Tidak ada yang melihat, tidak ada yang memuji.`,
    demo: `[medium pause] Cuma satu lampu kecil di sudut ruangan, gerakan sepelan mungkin, dan tangan yang sudah hafal urutannya tanpa berpikir. Di jam seperti ini ${c.proof} baru terasa berarti, karena sama sekali tidak ada waktu untuk mengulang.`,
    cta: `[short pause] ${c.produk}. Nama di ujung malam.`,
  }),
  (c) => ({
    hook: `Yang paling sulit dari malam bukan lelahnya. Tapi harus tetap pelan.`,
    demo: `[medium pause] Satu suara terlalu keras saja, semua usaha satu jam tadi hilang begitu saja, dan harus diulang. Makanya yang dipilih untuk jam segini selalu yang paling sederhana, yang ${c.proof} masih bisa dipercaya sambil setengah sadar.`,
    cta: `[short pause] Lampu menyorot nama ${c.produk}.`,
  }),
  (c) => ({
    hook: `Rumah sudah diam sejak tadi. Satu orang masih belum selesai.`,
    demo: `[long pause] Dia bergerak hati-hati di antara perabot, hafal betul di bagian mana lantainya berbunyi. Semua sudah dihafalnya sejak lama. Yang dia bawa malam ini cuma satu benda, dan ${c.proof} sudah dia hafal jauh sebelum malam ini datang.`,
    cta: `[short pause] Meja itu memuat ${c.produk}.`,
  }),
  (c) => ({
    hook: `Ada pekerjaan yang tidak pernah masuk foto keluarga siapa pun.`,
    demo: `[short pause] Yang jam tiga pagi, yang tidak pernah diceritakan ke siapa-siapa, yang sudah selesai sebelum orang serumah bangun. Tidak ada yang tahu. Untuk jam seperti itu, ${c.proof} bukan sekadar fitur tambahan. Itu satu-satunya alasan barangnya dipilih.`,
    cta: `[medium pause] ${c.produk}. Terlihat sebelum pagi.`,
  }),
];

export const TEMPLATE_COPY: Record<string, CopyFn[]> = {
  "racun-checkout": RACUN_CHECKOUT,
  "review-jujur": REVIEW_JUJUR,
  unboxing: UNBOXING,
  "before-after": BEFORE_AFTER,
  "diskon-gede": DISKON_GEDE,
  "buat-kamu-yang": BUAT_KAMU_YANG,
  "spill-rahasia": SPILL_RAHASIA,
  "t01-tempat-susah": T01,
  "t02-bedah-fitur": T02,
  "t03-liputan-event": T03,
  "t04-hook-indrawi": T04,
  "t05-before-after": T05,
  "t06-swatch-shade": T06,
  "t07-checklist-berjalan": T07,
  "t08-day-1-vs-day-7": T08,
  "t09-bahan-aktif": T09,
  "t10-bukti-di-lengan": T10,
  "t11-hook-misteri": T11,
  "t12-vox-pop": T12,
  "ads-unboxing-pov": ADS_UNBOXING_POV,
  "ads-meja-kosong": ADS_MEJA_KOSONG,
  "ads-panas-ekstrem": ADS_PANAS,
  "ads-tembus-dinding": ADS_TEMBUS,
  "ads-atap-jebol": ADS_ATAP,
  "ads-dobrak-pintu": ADS_PINTU,
  "ads-waktu-berhenti": ADS_WAKTU,
  "kenalin-bisnis": KENALIN_BISNIS,
  "promo-terbatas": PROMO_TERBATAS,
  "tvc-the-drop": TVC_DROP,
  "tvc-tersangka": TVC_TERSANGKA,
  "tvc-seharian": TVC_SEHARIAN,
  "tvc-kain-lari": TVC_KAIN,
  "tvc-jam-tiga": TVC_JAM_TIGA,
};

/** Varian ke-i untuk template ini. Tidak pernah modulo: indeks di luar
 * kapasitas ditolak agar copy tidak berulang diam-diam. */
export function templateCopy(
  templateId: string | null | undefined,
  i: number,
  c: TemplateCtx
): CopyTriple | null {
  if (!templateId) return null;
  const list = TEMPLATE_COPY[templateId];
  if (!list?.length) return null;
  if (!Number.isInteger(i) || i < 0 || i >= list.length) {
    throw new RangeError(
      `Template ${templateId} hanya menyediakan ${list.length} variasi unik; indeks ${i} tidak tersedia.`
    );
  }
  const base = list[i](c);
  return storyAds(templateId, i, c, authoredCompact(templateId, i, c, base));
}
