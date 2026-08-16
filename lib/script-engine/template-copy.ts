import type { TemplateCtx } from "./templates";

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
}

type CopyFn = (c: TemplateCtx) => CopyTriple;

/** Satu naskah utama dan tiga alternatif lengkap per template. */
export const TEMPLATE_COPY_CAPACITY = 4 as const;

const RACUN_CHECKOUT: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, detail kecil ini ternyata layak dilihat dekat loh`, demo: `[short pause] Pada ${c.produk}, periksa ${c.proof}; harganya ${c.harga}, cocokkan dengan kebutuhanmu sih`, cta: `Kalau memang masuk kebutuhanmu, cek keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, ${c.reg.me} baru paham bagian yang perlu dicek sih`, demo: `[medium pause] ${c.produk} memperlihatkan ${c.proof}; banderolnya ${c.harga}, jadi nilai sendiri ya`, cta: `Lihat detailnya dulu di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Ternyata racunnya ada di detail, ${c.reg.sapaan}`, demo: `[long pause] Nah, amati ${c.proof} pada ${c.produk}; harganya ${c.harga}, tanpa janji berlebihan loh`, cta: `Kalau konteksnya sama, mampir ke keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Sumpah, [giggles] temuan ini bikin berhenti scroll sih`, demo: `[short pause] Sorot ${c.produk}, lalu telaah atribut ${c.proof}; banderolnya ${c.harga} sih`, cta: `Nilai sendiri sekarang lewat keranjang kuning deh` }),
];

const REVIEW_JUJUR: CopyFn[] = [
  (c) => ({ hook: `[serious] Jujur ya, awalnya ${c.reg.me} kira ini bakal biasa aja`, demo: `[short pause] Nah, pada ${c.produk}, ${c.proof} bisa diperiksa; harganya ${c.harga}, kecocokan tetap personal sih`, cta: `Baca detailnya di keranjang kuning dulu ya` }),
  (c) => ({ hook: `[slow] Nah, ini ulasan tanpa manis-manisin barangnya`, demo: `[medium pause] ${c.produk} menunjukkan ${c.proof}; harganya ${c.harga}, jadi cek kebutuhanmu juga ya`, cta: `Bandingkan sendiri sekarang lewat keranjang kuning deh` }),
  (c) => ({ hook: `[slow] Eh, ada detail yang jelas dan ada pertanyaannya sih`, demo: `[long pause] ${c.proof} tersedia pada ${c.produk}; untuk ${c.pain}, pertimbangkan kecocokan dan harga ${c.harga}`, cta: `Spesifikasinya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Kalau [giggles] cari pujian kosong, ulasan ini bukan tempatnya loh`, demo: `[short pause] Nah, periksa ${c.proof} dari ${c.produk}; sesuaikan kebutuhan dengan harga ${c.harga} ya`, cta: `Kalau masih penasaran, buka keranjang kuning deh` }),
];

const UNBOXING: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, paket ${c.produk} akhirnya sampai dan siap dibuka`, demo: `[short pause] Cocokkan isinya satu per satu dengan daftar; periksa ${c.proof} ya`, cta: `Lihat isi paketnya di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, isi paket ${c.produk} lengkap semua nggak ya?`, demo: `[medium pause] Lihat jumlah isi dan detail ${c.proof} tanpa menyimpulkan kondisi sih`, cta: `Lihat paketnya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Sumpah, kardus ${c.produk} bikin penasaran banget sebelum dibuka`, demo: `[long pause] Baca labelnya dan pastikan ${c.proof} sesuai kebutuhan loh`, cta: `Isi paket lengkap tercantum di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [giggles] buka tutupnya pelan, kita cek isinya satu per satu yuk`, demo: `[short pause] Nah, periksa [giggles] isinya; tanyakan detail ${c.proof} deh`, cta: `Cek pilihan paketnya sekarang di keranjang kuning deh` }),
];

const BEFORE_AFTER: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, dua tampilan ${c.space} ini kelihatan beda; coba samakan acuannya di depan mata`, demo: `[short pause] Taruh ${c.produk} pada dua kondisi setara. Lihat ${c.proof} berdampingan, samakan cahaya dan sudut, lalu sebut perbedaan yang benar-benar kelihatan. Kalian lihat bagian yang sama nggak ya?`, cta: `Kalau metodenya masuk akal buatmu, cek keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, jangan percaya omongan ${c.reg.me}; lihat sendiri kedua sisinya secara pelan-pelan sekarang`, demo: `[medium pause] Pisahkan tampilan awal dan akhir. Apakah ${c.proof} terlihat berbeda pada ${c.produk} ketika sudut dan cahayanya sama? Kalau patokannya berubah, ulang dari sudut pertama agar perbandingannya jelas sih`, cta: `Detail pemakaian lengkap saat ini ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, cahaya dan sudutnya sudah sama, perbedaan mana yang kelihatan di layar?`, demo: `[long pause] Samakan cahaya, jarak, dan sudut. Setelah ${c.produk} disejajarkan, bagian ${c.proof} mana yang benar-benar terlihat berbeda? Coba jeda videonya, lalu tulis detail yang kalian lihat pada kedua sisi secara bergantian ya`, cta: `Lihat detail produknya di keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Sumpah, perbandingan baru adil kalau kondisi kedua sisinya setara sejak awal video`, demo: `[short pause] Letakkan dua tampilan ${c.produk} berdampingan. Cocokkan acuannya, perhatikan ${c.proof} selama beberapa detik penuh dulu, lalu tanyakan bagian mana yang berubah. Ulangi dengan posisi tangan, jarak, dan permukaan yang sama deh`, cta: `Baca panduan produknya di keranjang kuning deh` }),
];

const DISKON_GEDE: CopyFn[] = [
  (c) => ({ hook: `[excited] ${c.reg.sapaan}, banderol ${c.harga} bikin ${c.reg.me} cek ulang`, demo: `[short pause] Nah, ${c.produk} seharga ${c.harga}; bandingkan detail ${c.proof} sendiri sih`, cta: `Pastikan harga aktifnya di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, banderol ${c.harga} ini serius bikin berhenti sih`, demo: `[medium pause] ${c.produk} menunjukkan ${c.proof} dengan jelas; untuk harga ${c.harga}, cek nilainya sendiri ya`, cta: `Cek angka terbarunya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, kalau budgetmu ${c.harga}, lihat barang ini dulu`, demo: `[long pause] Buat ${c.aktivitas}, amati ${c.proof} milik ${c.produk}; banderolnya ${c.harga} loh`, cta: `Bandingkan paketnya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Sumpah, [giggles] angka ${c.harga} perlu dibandingkan dulu`, demo: `[short pause] Nah, periksa bagian ${c.proof} dari ${c.produk}; harganya ${c.harga}, lalu nilai sendiri sih`, cta: `Konfirmasi harganya di keranjang kuning deh` }),
];

const BUAT_KAMU_YANG: CopyFn[] = [
  (c) => ({ hook: `[excited] Buat yang sering ${c.aktivitas}, merapat sebentar ya`, demo: `[short pause] Nah, saat ${c.pain} terasa, lihat ${c.proof} milik ${c.produk} sih`, cta: `Kalau panggilannya tepat, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.identitas} yang urus ${c.pain}, lihat ini dulu sih`, demo: `[medium pause] Nah, untuk ${c.aktivitas}, ${c.produk} punya detail ${c.proof} ya`, cta: `Lihat apakah cocok di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, khusus yang sering ${c.aktivitas}, cek detail ini`, demo: `[long pause] ${c.produk} menampilkan ${c.proof} tanpa dilebihkan loh`, cta: `Kalau itu kamu, buka detailnya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [giggles] masalah ${c.pain} perlu dilihat dekat`, demo: `[short pause] Nah, amati tampilan ${c.proof} milik ${c.produk}, lalu kaitkan dengan rutinitasmu hari ini sih`, cta: `Nilai kecocokannya lewat keranjang kuning ya` }),
];

const SPILL_RAHASIA: CopyFn[] = [
  (c) => ({ hook: `[serious] Ada detail ${c.noun} yang jarang kelihatan dari jauh loh`, demo: `[short pause] Nah, telusuri ${c.proof} dari ${c.produk} secara dekat sih`, cta: `Rahasia lengkapnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[whispers] Eh, hal kecil ini sering banget kelewat begitu saja`, demo: `[medium pause] Pada ${c.produk}, sorot permukaan ${c.proof} yang terlihat ya`, cta: `Kalau mau teliti juga, cek keranjang kuning deh` }),
  (c) => ({ hook: `[whispers] ${c.reg.sapaan}, rahasianya ada pada cara memeriksa lebih dekat sih`, demo: `[long pause] Nah, cocokkan atribut ${c.proof} milik ${c.produk} dengan kebutuhanmu loh`, cta: `Buka spesifikasinya di keranjang kuning ya` }),
  (c) => ({ hook: `[whispers] Sumpah, [giggles] petunjuknya kelihatan kalau dilihat dekat sekali`, demo: `[short pause] ${c.reg.me} menyorot ${c.proof} yang tampak pada ${c.produk} ya`, cta: `Lihat rinciannya lebih dekat sekarang lewat keranjang kuning deh` }),
];

const T01: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, ${c.noun} ini tetap bisa dibawa saat bepergian`, demo: `[short pause] Cek ukuran ${c.produk}, penutup, serta ${c.proof} sebelum dibawa ya`, cta: `Kalau sering mobile, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, ${c.reg.sapaan}, ruang bawaan terbatas bikin setiap ukuran penting`, demo: `[medium pause] Pastikan ${c.proof} milik ${c.produk} benar-benar sesuai ruang bawaanmu sih`, cta: `Simpan opsinya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, sebelum keluar rumah, cek dulu cara menyimpannya`, demo: `[long pause] Nah, periksa cara menyimpan ${c.produk} serta detail ${c.proof} loh`, cta: `Yang suka bepergian, buka keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, jauh dari rumah? [giggles] Siapkan ruang khusus di bawaan`, demo: `[short pause] Tentukan ruang untuk ${c.produk}; lihat ukuran kemasan dan ${c.proof} sebelum membawanya deh`, cta: `Lihat dimensinya di keranjang kuning ya` }),
];

const T02: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, ${c.reg.me} bedah barang ini bagian demi bagian ya`, demo: `[short pause] Buka ${c.produk}, lalu tunjuk bagian yang sering disentuh. Bagaimana sambungannya, cara pakainya, dan tampilan ${c.proof}? Gerakkan setiap bagian pelan-pelan dari dua arah, lalu bandingkan harga ${c.harga} setelah semuanya terlihat jelas ya`, cta: `Cek rincian lengkapnya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Eh, jangan nilai bentuk luarnya dulu, lihat keterangannya`, demo: `[medium pause] Mulai dari nama bagian pada ${c.produk}, kemudian cocokkan dengan petunjuknya. Lihat ${c.proof} dari dekat, coba gerakkan komponen yang ditunjukkan, lalu tanyakan apakah fungsinya sesuai untuk ${c.aktivitas}. Banderolnya ${c.harga} sekarang sih`, cta: `Rincian resminya ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, satu bagian satu pertanyaan, jangan tertipu tampilan`, demo: `[long pause] Putar ${c.produk}, cek sambungan, kontrol, dan petunjuknya. Nah, apakah ${c.proof} terlihat di setiap sisi? Coba bagian yang bisa digerakkan untuk ${c.aktivitas}, lalu bandingkan harga ${c.harga} setelah tahu fitur yang relevan ya`, cta: `Bandingkan datanya di keranjang kuning deh` }),
  (c) => ({ hook: `[slow] Sumpah, barang teknis begini harus diperiksa, bukan dipuji`, demo: `[short pause] Mulai dari bagian utama ${c.produk}, lalu ikuti cara pakainya pelan-pelan. Tunjukkan ${c.proof} dari dekat dan coba dalam konteks ${c.aktivitas}. Saat ${c.pain} jadi perhatian, bagian mana yang ingin ${c.reg.you} cek? Setelah itu, bandingkan harga ${c.harga} deh`, cta: `Kalau datanya relevan, buka keranjang kuning ya` }),
];

const T03: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, ikut ${c.reg.me} keliling lokasi ini dari pintu masuk sampai ke sudut terakhir`, demo: `[short pause] Baru masuk, suasananya langsung terasa. Ada ${c.produk} di area ini; yuk dekati, lihat ${c.proof}, lalu tanya staf cara mendapatkannya. Coba lihat, ada sudut lain yang menarik nggak ya?`, cta: `Kalau mau cari produknya, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, kita lihat suasananya dulu sebelum cari barang sampai ketemu satu sudut menarik`, demo: `[medium pause] Kita mulai dari area utama dan pilihan yang dipajang. Nah, ${c.produk} ada di sini; lihat ${c.proof}, baca keterangannya, lalu lanjut keliling. Setelah itu, kita pindah ke area berikutnya sih`, cta: `Info produknya tersedia di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Nah, ada temuan dekat pintu; yuk masuk dan lihat bareng sampai ke area utama`, demo: `[long pause] Di sudut ini ada aktivitas yang bisa dicoba dan informasi yang bisa ditanya. Saat ${c.produk} muncul, kita lihat ${c.proof} dari dekat. Menurut kalian, detail ini menarik nggak sih?`, cta: `Kalau tertarik barangnya, buka keranjang kuning deh` }),
  (c) => ({ hook: `[slow] Eh, suasana acaranya terasa bahkan sebelum barangnya kelihatan mulai dari pintu depan`, demo: `[short pause] Keliling dulu, dengarkan suasananya, lalu berhenti di ${c.produk}. Detail ${c.proof} kelihatan dari sini; kalau penasaran, tanyakan langsung pada penjaganya. Dari dekat, bentuknya berbeda dibanding dari pintu masuk tadi deh`, cta: `Detail pembeliannya langsung ada di keranjang kuning ya` }),
];

const T04: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, bunyi bungkusnya bikin ${c.reg.me} penasaran sama isinya`, demo: `[short pause] Buka ${c.produk}, baca label rasa, lalu periksa ${c.proof} ya`, cta: `Kalau penasaran, cek detailnya di keranjang kuning ya` }),
  (c) => ({ hook: `[whispers] Eh, dengarkan bunyinya pelan dulu sebelum menebak rasa`, demo: `[medium pause] Bunyi ${c.produk} memancing rasa penasaran; rasanya menunggu dicicipi sih`, cta: `Cari pilihan rasanya di keranjang kuning deh` }),
  (c) => ({ hook: `[whispers] Nah, ${c.reg.sapaan}, teksturnya sudah kedengaran dari bunyinya sih`, demo: `[long pause] Cek nama rasa, komposisi ${c.produk}, dan detail ${c.proof} loh`, cta: `Kalau ingin mencoba, buka rinciannya di keranjang kuning ya` }),
  (c) => ({ hook: `[whispers] Sumpah, [giggles] suara renyah ini bikin pengin buka bungkusnya`, demo: `[short pause] Dengarkan teksturnya, baca label ${c.produk}, lalu pertimbangkan ${c.proof} deh`, cta: `Lihat pilihan rasanya di keranjang kuning deh` }),
];

const T05: CopyFn[] = [
  (c) => ({ hook: `Nah, dua acuan ini siap dibandingkan berdampingan`, demo: `Letakkan ${c.produk} berdampingan, lalu telaah atribut ${c.proof} saja`, cta: `Cek keranjang kuning deh` }),
  (c) => ({ hook: `Eh, sisi kiri dan kanan jangan sampai tertukar`, demo: `Gunakan acuan tampilan setara untuk menilai ${c.proof} pada ${c.produk} sih`, cta: `Detailnya di keranjang kuning ya` }),
  (c) => ({ hook: `Nah, biarkan dua tampilan setara menjawab perbedaannya`, demo: `Gunakan referensi setara untuk menelaah ${c.proof} milik ${c.produk} loh`, cta: `Buka keranjang kuning deh` }),
  (c) => ({ hook: `Sumpah, cahaya dan sudutnya harus sama`, demo: `Perbandingan ini hanya memeriksa ${c.proof} dari ${c.produk} ya`, cta: `Cek keranjang kuning ya` }),
];

const T06: CopyFn[] = [
  (c) => ({ hook: `Nah, pilih variannya sebelum lihat jawabannya`, demo: `Tampilkan pilihan ${c.produk} satu-satu; bandingkan label, pilihan, dan atribut ${c.proof} ya`, cta: `Tulis pilihanmu, lalu cek keranjang kuning ya` }),
  (c) => ({ hook: `Eh, tiap varian punya detail yang berbeda`, demo: `Jangan anggap tiap varian sama; cek nama resmi dan detail ${c.proof} masing-masing sih`, cta: `Pilih versimu di keranjang kuning deh ya` }),
  (c) => ({ hook: `${c.reg.sapaan}, mata ${c.reg.you} berhenti di pilihan yang mana?`, demo: `Nah, susun ${c.produk} berurutan supaya perbedaan ${c.proof} mudah diperiksa loh`, cta: `Cocokkan pilihan di keranjang kuning ya` }),
  (c) => ({ hook: `Sumpah, satu pilihan langsung bikin mata berhenti`, demo: `Tentukan varian dari informasi ${c.proof}, bukan dugaan pribadi ya`, cta: `Temukan variannya di keranjang kuning deh ya` }),
];

const T07: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, checklist ini dimulai dari masalah ${c.pain}`, demo: `[short pause] Nah, centang setelah atribut ${c.proof} pada ${c.produk} bisa diperiksa ya`, cta: `Kalau checklistnya relevan, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, centang hanya setelah aksinya benar-benar kelihatan`, demo: `[medium pause] Nah, poin pertama: ${c.produk} punya ${c.proof}? Cari jawabannya pada barangnya langsung sih`, cta: `Baca manfaatnya di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, setiap poin harus punya jawaban yang terlihat`, demo: `[long pause] Baca poin, cari buktinya pada ${c.produk}, lalu beri centang bila ${c.proof} terlihat loh`, cta: `Kalau buktinya cukup, buka keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, [giggles] satu tindakan akan mengisi checklist pertama`, demo: `[short pause] Sumpah, [giggles] checklist ${c.produk} harus berisi spesifikasi yang tersedia, termasuk ${c.proof} deh`, cta: `Cocokkan kebutuhanmu di keranjang kuning ya` }),
];

const T08: CopyFn[] = [
  (c) => ({ hook: `Nah, catatan pertama dimulai dari kondisi hari ini`, demo: `Pada ${c.produk}, catat tampilan ${c.proof} dalam kondisi terukur ya`, cta: `Cara pakai ada di keranjang kuning ya` }),
  (c) => ({ hook: `Eh, simpan kondisi awal sebelum lanjut ke hari berikutnya`, demo: `Ikuti petunjuk ${c.produk}, lalu jadwalkan pemeriksaan ${c.proof} sih`, cta: `Baca waktunya di keranjang kuning deh` }),
  (c) => ({ hook: `Nah, waktu saja nggak cukup; kondisi pengamatannya harus setara`, demo: `Bandingkan ${c.proof} hanya dengan kondisi pengamatan yang tercatat loh`, cta: `Petunjuknya di keranjang kuning ya` }),
  (c) => ({ hook: `Sumpah, dua waktu ini perlu catatan yang jelas`, demo: `Rencana awal dan akhir cukup memeriksa ${c.proof} pada ${c.produk} ya`, cta: `Buka catatannya di keranjang kuning deh` }),
];

const T09: CopyFn[] = [
  (c) => ({ hook: `[serious] Buat yang suka riset, jangan berhenti di label depan ya`, demo: `[short pause] Nah, baca label ${c.produk} bareng ${c.reg.me}, lalu lihat ${c.proof} saat digunakan. Putar kemasannya, cek petunjuk pakai, dan cocokkan harga ${c.harga} dengan kebutuhan ${c.aktivitas}. Bagian mana yang paling ingin kalian cek ya?`, cta: `Baca informasi resminya di keranjang kuning deh` }),
  (c) => ({ hook: `[slow] ${c.reg.sapaan}, nama teknis belum tentu menjelaskan semuanya sih`, demo: `[medium pause] Nama teknis di kemasan ${c.produk} perlu dibaca bareng cara pakainya. Nah, putar kemasannya, lihat ${c.proof}, lalu tanyakan apakah urutannya masuk ke ${c.aktivitas}. Banderol ${c.harga} bisa dibandingkan setelah memahami seluruh langkahnya tadi sih`, cta: `Baca deskripsi resminya di keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Nah, formula harus dibaca, bukan ditebak dari warna`, demo: `[long pause] Mulai dari keterangan ${c.produk}, lalu lihat ${c.proof} saat digunakan. Apa yang tertulis di label, bagaimana urutan pakainya, dan bagian mana yang perlu ditanyakan? Dengan harga ${c.harga}, cocokkan semua itu dengan ${c.aktivitas} milik ${c.reg.you} ya`, cta: `Sumber produknya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[whispers] Eh, pembeli teliti wajib pisahkan fakta dan kesan`, demo: `[short pause] Di ${c.produk}, kita bisa baca cara pakai, melihat ${c.proof}, dan mengecek harga ${c.harga}. Sekarang pertanyaannya: apakah rangkaian ini masuk ke rutinitas ${c.aktivitas} milik ${c.reg.you}? Coba cocokkan seluruh urutan langkahnya satu per satu deh`, cta: `Baca keterangannya di keranjang kuning ya` }),
];

const T10: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, uji kecil ini perlu aturan yang jelas sejak awal`, demo: `[short pause] Ikuti petunjuk ${c.produk}; periksa ${c.proof} sebagai atribut saja ya`, cta: `Cek petunjuk di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, pakai cahaya dan posisi yang sama dari awal`, demo: `[medium pause] Nah, gunakan informasi resmi ${c.produk} untuk memahami ${c.proof} sih`, cta: `Detail resminya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, bukti tanpa konteks gampang bikin salah baca, ${c.reg.sapaan}`, demo: `[long pause] Sebelum mencoba ${c.produk}, cek petunjuk dan atribut ${c.proof} loh`, cta: `Lihat cara pakai di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Sumpah, [giggles] kedua kondisinya harus benar-benar setara`, demo: `[short pause] Oleskan ${c.produk} sesuai petunjuk pada area kecil, samakan cahayanya, lalu lihat ${c.proof} deh`, cta: `Cek panduannya di keranjang kuning deh` }),
];

const T11: CopyFn[] = [
  (c) => ({ hook: `Eh, permukaan sedekat ini kelihatan seperti benda lain`, demo: `Mulai dari detail ${c.proof}, lalu mundur perlahan sampai ${c.produk} terungkap sepenuhnya ya`, cta: `Kalau masih penasaran, cek keranjang kuning ya` }),
  (c) => ({ hook: `Sumpah, bentuk dekatnya bikin ${c.reg.me} salah sangka`, demo: `Bentuk dekatnya boleh jadi teka-teki; jawabannya cukup nama ${c.produk} dan atribut ${c.proof} sih`, cta: `Reveal lengkap di keranjang kuning deh` }),
  (c) => ({ hook: `Nah, jangan buka labelnya; fokus ke permukaannya dulu`, demo: `Nah, tahan nama produknya sebentar, perlihatkan ${c.proof}, lalu ungkap ${c.produk} loh`, cta: `Nama lengkapnya ada di keranjang kuning ya` }),
  (c) => ({ hook: `${c.reg.sapaan}, coba tebak benda asing yang kelihatan dekat ini`, demo: `Sumpah, misterinya selesai ketika bentuk utuh ${c.produk} terlihat; setelah itu cek ${c.proof} deh`, cta: `Kalau jawabannya menarik, buka keranjang kuning deh` }),
];

const T12: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, kalau pilih ${c.noun}, apa yang pertama ${c.reg.you} nilai sebelum memutuskan membeli barangnya hari ini?`, demo: `[short pause] ${c.reg.sapaan}, kalau lihat kategori ${c.noun}, bagian apa yang pertama kali kalian cek? Kalau jawabannya ${c.proof}, alasannya apa? Sekarang lihat ${c.produk} dari dekat. Setuju atau punya jawaban lain ya?`, cta: `Bandingkan pendapatnya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, standar sederhana buat ${c.noun} menurut kalian apa saat sedang pilih barang?`, demo: `[medium pause] Satu orang bilang praktis, yang lain fokus ke detail. Kalau ${c.proof} jadi pertimbangan kalian, apa yang ingin dilihat lebih dulu dari ${c.produk}? Sebut alasan pilihan kalian secara singkat sih`, cta: `Nah, lihat pilihan produknya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, rekomendasi yang berguna selalu punya alasan; alasanmu apa sebelum ikut membeli?`, demo: `[long pause] Pertanyaannya simpel: kapan kalian memakai kategori ini, dan detail apa yang menentukan pilihan? Setelah dengar jawabannya, lihat apakah ${c.proof} pada ${c.produk} menjawab kebutuhan itu. Apa alasan pilihanmu ya?`, cta: `Informasi aslinya juga ada di keranjang kuning sekarang ya` }),
  (c) => ({ hook: `[slow] Eh, seberapa jauh pendapat orang tentang ${c.noun} bisa berbeda dari satu pertanyaan?`, demo: `[short pause] Eh, ada yang fokus bentuk, ada yang melihat fungsi, dan ada yang bertanya harga. Sekarang giliran ${c.reg.you}: bagaimana melihat detail ${c.proof} dari ${c.produk}? Ceritakan alasan dan urutan pertimbanganmu secara terbuka deh`, cta: `Bandingkan jawabanmu lewat keranjang kuning deh` }),
];

const ADS_UNBOXING_POV: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, kali ini kita melihat dari dalam kardus langsung`, demo: `[short pause] Cocokkan isi ${c.produk} dengan daftar resminya ya`, cta: `Cek isi paket serupa di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Eh, tangan siapa yang pertama masuk ke paket?`, demo: `[medium pause] Tangan mengambil ${c.produk}; periksa jumlah isi dan ${c.proof} sih`, cta: `Isi paket ada di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Sumpah, tutup kardus terbuka tepat di atas kita`, demo: `[long pause] Angkat ${c.produk}, tunjukkan label, lalu tanyakan detail ${c.proof} loh`, cta: `Teliti isi paket lengkapnya lewat keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [giggles] sudut bawah tutup ternyata paling seru dilihat`, demo: `[short pause] Nah, [giggles] cocokkan ${c.produk} satu per satu dengan rincian ${c.proof} deh`, cta: `Cek daftar isi paket di keranjang kuning ya` }),
];

const ADS_MEJA_KOSONG: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, meja penuh ini sebenarnya butuh berapa alat?`, demo: `[short pause] Daftar alatnya, lalu cari atribut ${c.proof} dalam spesifikasi ${c.produk} ya`, cta: `Nilai alurnya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, alat mana yang bisa disimpan tanpa mengganggu kerja?`, demo: `[medium pause] Baca spesifikasi ${c.produk}; tanyakan peran ${c.proof} dalam alurmu sih`, cta: `Lihat rinciannya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Nah, kali ini mejanya justru berkurang sampai terasa lebih lega, ${c.reg.sapaan}`, demo: `[long pause] Pastikan fitur resmi ${c.produk} mencakup kebutuhan ${c.proof} loh`, cta: `Rapikan alurnya melalui keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Sumpah, [giggles] ruang kosong di meja ini harus punya alasan`, demo: `[short pause] Hitung [giggles] langkah kerja; verifikasi ${c.produk} melalui keterangan ${c.proof} deh`, cta: `Cek fiturnya di keranjang kuning deh` }),
];

const ADS_PANAS: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, suhu ruangan ini naik terus tiap detik`, demo: `[short pause] Sebelum memilih ${c.produk}, cek relevansi ${c.proof} untuk ${c.pain} ya`, cta: `Kalau keluhannya sama, cek keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, udaranya makin gerah bahkan sebelum semuanya mulai`, demo: `[medium pause] Baca fungsi ${c.produk}, lalu tanyakan peran ${c.proof} sih`, cta: `Lihat cara kerjanya di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, panasnya sudah kelewatan banget sejak tadi sih`, demo: `[long pause] Nah, keputusan tetap dari spesifikasi ${c.produk}, terutama ${c.proof} loh`, cta: `Cocokkan fungsinya melalui keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Sumpah, [giggles] jangan percaya suasananya; cek barangnya`, demo: `[short pause] Bandingkan kebutuhanmu terhadap atribut ${c.proof} dari ${c.produk} deh`, cta: `Nah, periksa data resminya sekarang di keranjang kuning deh` }),
];

const ADS_TEMBUS: CopyFn[] = [
  (c) => ({ hook: `[excited] Eh, sesuatu baru saja menembus dinding belakang`, demo: `[short pause] Eh, barusan ada suara besar dari belakang. Setelah debunya turun, taruh ${c.produk} di meja, lihat ${c.proof}, lalu coba cara pakainya untuk ${c.aktivitas}. Sesudah dicoba, apa yang masih bikin ${c.reg.you} penasaran ya`, cta: `Kalau produk aslinya menarik, cek keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Nah, benturan tadi jelas bukan suara biasa dari ruangan sebelah sana`, demo: `[medium pause] Nah, temboknya memang bikin kaget, tetapi pertanyaannya sederhana: apa yang benar-benar tersedia pada ${c.produk}? Cari ${c.proof}, baca cara pakai, putar barangnya ke sisi lain, dan pastikan kategorinya sesuai kebutuhanmu sebelum membuka keranjang sih`, cta: `Rincian sebenarnya ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Sumpah, suasana di belakang berubah total dalam satu detik`, demo: `[long pause] Sumpah, suasananya berubah cepat. Setelah debu turun, taruh ${c.produk} di meja, baca kategorinya, lihat cara pakai, lalu cari detail ${c.proof}. Coba tunjukkan langkah pertama: fungsinya menjawab kebutuhan ${c.aktivitas} atau nggak sekarang ya`, cta: `Kalau penjelasannya jelas, buka keranjang kuning ya` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, [laughs] lihat tembok belakangnya dulu sebelum bertanya ke orangnya`, demo: `[short pause] ${c.reg.sapaan}, [laughs] nah temboknya sudah tenang; waktunya menilai ${c.produk} secara biasa. Mulai dari ${c.proof}, lanjut ke keterangan penggunaan, lalu coba satu langkah dan tanyakan hal yang belum jelas. Pilih hanya jika informasinya cocok dengan kebutuhanmu deh`, cta: `Nilai barangnya lewat keranjang kuning deh` }),
];

const ADS_ATAP: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, siapa yang baru jatuh dari atap barusan?`, demo: `[short pause] Setelah berdiri, buka keterangan ${c.produk} dan cari ${c.proof} ya`, cta: `Telaah rinciannya melalui keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, suara dari atas makin dekat sekarang`, demo: `[medium pause] Ia membawa ${c.produk}; periksa label serta atribut ${c.proof} sih`, cta: `Detail barang ada di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, orang itu masuk lewat jalur yang salah`, demo: `[long pause] Nah, nilai ${c.produk} hanya dari informasi ${c.proof} loh`, cta: `Kalau jelas, buka rincian di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Sumpah, [laughs] jalur masuknya kacau dan semua orang langsung menoleh`, demo: `[short pause] Sebelum heboh, cek kategori ${c.produk} serta rincian ${c.proof} deh`, cta: `Telusuri pilihan barangnya di keranjang kuning deh` }),
];

const ADS_PINTU: CopyFn[] = [
  (c) => ({ hook: `[excited] Nah, pintunya baru saja didobrak keras dari luar`, demo: `[short pause] Orang itu membawa ${c.produk}; periksa informasi ${c.proof} ya`, cta: `Kalau pesannya sampai, cek keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Eh, ruangan tenang ini mendadak ramai dalam sekejap tadi`, demo: `[medium pause] Pilih perlahan: baca keterangan ${c.produk}, terutama ${c.proof} sih`, cta: `Lihat barangnya di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, seseorang datang sambil membawa satu jawaban`, demo: `[long pause] Nah, ia meletakkan ${c.produk}; tanyakan kecocokan ${c.proof} loh`, cta: `Kalau sesuai, buka rincian di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] Sumpah, [laughs] masuknya heboh banget, tapi pesannya sederhana`, demo: `[short pause] Sebelum memilih ${c.produk}, teliti informasi ${c.proof} deh`, cta: `Cek sumber informasi resminya sekarang di keranjang kuning ya` }),
];

const ADS_WAKTU: CopyFn[] = [
  (c) => ({ hook: `[excited] Eh, semua gerakan mendadak berhenti dalam satu detik`, demo: `[short pause] ${c.reg.me} membaca keterangan ${c.produk}, terutama bagian ${c.proof} ya`, cta: `Temukan data lanjutannya di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Sumpah, pasar ini mendadak diam total seketika tadi`, demo: `[medium pause] Eh, periksa label ${c.produk} dan rincian ${c.proof} sih`, cta: `Lihat fakta barang di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, waktunya macet tapi ${c.reg.me} masih bergerak`, demo: `[long pause] Nah, keputusan menunggu informasi ${c.produk}, termasuk ${c.proof} loh`, cta: `Kalau cocok, buka rincian barang di keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Eh, semua orang baru saja membeku di tempat`, demo: `[short pause] Sumpah, cocokkan ${c.produk} dengan kebutuhan terkait ${c.proof} deh`, cta: `Cek barang sebenarnya di keranjang kuning deh` }),
];

const KENALIN_BISNIS: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, kenalan dengan layanan yang baru muncul ini`, demo: `[short pause] ${c.produk} mencantumkan ${c.proof}; tanyakan cakupannya untuk ${c.aktivitas} sih`, cta: `Kalau butuh penjelasan, cek keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, layanan ini memang bukan buat semua orang`, demo: `[medium pause] ${c.identitas} bisa menilai ${c.produk} dari keterangan ${c.proof} ya`, cta: `Lihat cakupannya langsung di keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, kenalan lewat kebutuhan yang paling terasa dulu`, demo: `[long pause] Nah, mulai dari ${c.pain}, lalu tanyakan pada ${c.produk} soal rincian ${c.proof} loh`, cta: `Kalau konteksmu sama, buka keranjang kuning ya` }),
  (c) => ({ hook: `[slow] Sumpah, nama baru lebih enak dikenali pelan-pelan`, demo: `[short pause] Kenali ${c.produk} lewat informasi ${c.proof} dan sasaran ${c.identitas} sih`, cta: `Pelajari bisnisnya sekarang di keranjang kuning deh` }),
];

const PROMO_TERBATAS: CopyFn[] = [
  (c) => ({ hook: `[serious] Nah, ${c.harga} adalah harga yang tampil saat ini`, demo: `[short pause] Pada ${c.produk}, bagian mana menunjukkan ${c.proof}? Harga tercantumnya ${c.harga}, cek lagi ya`, cta: `Konfirmasi harga tercantum di keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Eh, lihat barangnya dulu sebelum menilai harganya`, demo: `[medium pause] Sebelum menilai ${c.proof} dari ${c.produk}, lihat rinciannya; harga tercantumnya ${c.harga} sih`, cta: `Bandingkan harganya lewat keranjang kuning deh` }),
  (c) => ({ hook: `[fast] ${c.reg.sapaan}, fokus ke detail sebelum harga ${c.harga}`, demo: `[long pause] Nah, lihat ${c.produk} saat ${c.aktivitas}; periksa ${c.proof}, lalu bandingkan dengan harga ${c.harga} loh`, cta: `Cek harganya lewat keranjang kuning ya` }),
  (c) => ({ hook: `[fast] Sumpah, [giggles] harga jujur nggak perlu menakut-nakuti`, demo: `[short pause] Cek ${c.proof} pada ${c.produk}; harga tercantumnya ${c.harga}, lalu bandingkan sendiri deh`, cta: `Nah, periksa harga produknya di keranjang kuning deh` }),
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
    cta: `[short pause] ${c.produk}. Dibuat setetes demi setetes.`,
  }),
  (c) => ({
    hook: `Kenapa harus sepelan ini? Karena yang bagus memang tidak bisa diburu.`,
    demo: `[medium pause] Setiap tetes butuh waktunya sendiri untuk terbentuk, dan waktu itu tidak bisa ditawar sedikit pun. Cepat semenit saja, ${c.proof} yang dikejar bertahun-tahun hilang begitu saja dari permukaannya, dan tidak ada cara mengulangnya.`,
    cta: `[short pause] ${c.produk}. Lambat, karena memang harus.`,
  }),
  (c) => ({
    hook: `Ada jarak sangat pendek antara ujung pipet dan permukaan kulit.`,
    demo: `[long pause] Di jarak sependek itulah semuanya ditentukan, walau hampir tidak ada yang memperhatikannya. Sedikit saja goyah, hasilnya berubah. Tetesannya harus utuh saat mendarat, karena ${c.proof} hanya terbaca kalau bentuknya sampai tanpa pecah di tengah jalan menuju permukaan.`,
    cta: `[short pause] ${c.produk}. Utuh sampai ke permukaan.`,
  }),
  (c) => ({
    hook: `Kalau diperbesar, satu tetes ternyata punya isi yang panjang ceritanya.`,
    demo: `[short pause] Lapisannya bergerak, cahayanya berpindah, dan ${c.proof} baru benar-benar terbaca di detik keempat. Tiga detik pertama belum menceritakan apa-apa. Itu sebabnya ${c.noun} ini dibuat untuk dilihat dari dekat, pelan-pelan, bukan dinilai sekilas dari jauh sambil lewat.`,
    cta: `[medium pause] ${c.produk}. Semakin dekat, semakin jelas.`,
  }),
];

const TVC_TERSANGKA: CopyFn[] = [
  (c) => ({
    hook: `[serious] Sidang dibuka. Terdakwa dituduh terlihat jauh lebih segar dari biasanya.`,
    demo: `[medium pause] Saksi bersikeras ada yang berubah sejak dua minggu terakhir. Jaksa menuntut bukti, penonton mulai berbisik, dan suasananya berubah tegang. Hakim mengetuk palu meminta tenang. Terdakwa akhirnya mengaku, lalu mengeluarkan satu benda kecil dari tasnya, lengkap dengan ${c.proof}.`,
    cta: `[short pause] ${c.produk}. Barang buktinya.`,
  }),
  (c) => ({
    hook: `Yang mulia, saya keberatan. Saksi terlihat terlalu segar untuk jam segini.`,
    demo: `[medium pause] Ruangan langsung hening dan semua mata pindah ke meja barang bukti. Ternyata yang tergeletak di sana sederhana sekali, sama sekali tidak mewah, tapi ${c.proof} nya terbaca jelas bahkan dari kursi penonton paling belakang.`,
    cta: `[short pause] ${c.produk}. Terbukti di ruang sidang.`,
  }),
  (c) => ({
    hook: `Kasus hari ini aneh: yang menuduh justru ikut mencatat nama barangnya.`,
    demo: `[long pause] Hakim bertanya sekali lagi dengan nada lebih tinggi, dan si penuduh mengelak sambil menunduk. Ruangan menunggu jawaban yang tidak datang. Sayangnya kamera ruang sidang menangkap tangannya sedang memotret meja bukti, tepat di bagian ${c.proof} yang tadi dia ributkan.`,
    cta: `[short pause] ${c.produk}. Ketahuan bagus.`,
  }),
  (c) => ({
    hook: `Pertanyaannya cuma satu: sejak kapan terdakwa mulai terlihat seperti ini?`,
    demo: `[short pause] Terdakwa diam agak lama, seperti menimbang harus jujur atau tidak. Ruangan ikut menunggu. Lalu dia menjawab pelan bahwa semuanya berubah sejak dia berhenti mencoba banyak hal sekaligus, dan menyisakan satu saja yang ${c.proof} nya konsisten.`,
    cta: `[medium pause] ${c.produk}. Satu-satunya yang dia akui.`,
  }),
];

const TVC_SEHARIAN: CopyFn[] = [
  (c) => ({
    hook: `[serious] Jam tujuh pagi semuanya masih aman. Masalahnya, hari belum mulai.`,
    demo: `[medium pause] Lalu datang panas jalanan, ruangan ber-AC yang kering, rapat yang mundur dua jam, dan macet panjang di jalan pulang. Semuanya menumpuk sejak pagi. Baru jam tujuh malam ketahuan siapa yang benar-benar bertahan, dan ${c.proof} nya yang menjawab.`,
    cta: `[short pause] ${c.produk}. Diuji oleh hari.`,
  }),
  (c) => ({
    hook: `Hari tidak pernah menunggu siapa pun siap. Termasuk hari ini.`,
    demo: `[medium pause] Jadwal maju, jalanan padat, semuanya minta serba cepat sejak pagi. Yang bagus bukan yang terlihat bagus jam delapan pagi waktu belum terjadi apa-apa, tapi yang ${c.proof} nya masih utuh waktu kamu sampai rumah.`,
    cta: `[short pause] ${c.produk}. Bertahan sampai hari selesai.`,
  }),
  (c) => ({
    hook: `Ada jarak dua belas jam antara berangkat dan sampai rumah lagi.`,
    demo: `[long pause] Dua belas jam itu yang hampir tidak pernah ditunjukkan siapa pun. Panas, keringat, ruangan dingin, lalu panas lagi, berulang-ulang tanpa jeda. Berulang setiap hari kerja. ${c.proof} nya baru jujur sesudah melewati semuanya, bukan sebelum.`,
    cta: `[short pause] ${c.produk}. Dinilai di jam terakhir.`,
  }),
  (c) => ({
    hook: `Pertanyaannya bukan bagus atau tidak. Tapi masih bagus jam berapa.`,
    demo: `[short pause] Pagi hampir semuanya kelihatan sama saja, susah dibedakan. Semuanya masih terlihat menjanjikan. Bedanya baru muncul menjelang sore, waktu tenaga habis, waktu tidak ada yang sempat memperbaiki apa pun, dan ${c.proof} nya harus bekerja sendirian.`,
    cta: `[medium pause] ${c.produk}. Masih bekerja waktu yang lain menyerah.`,
  }),
];

const TVC_KAIN: CopyFn[] = [
  (c) => ({
    hook: `[serious] Semua orang memotret baju sambil berdiri diam. Itu masalahnya.`,
    demo: `[medium pause] Karena kamu memakainya sambil berjalan, berbelok, duduk, lalu buru-buru berdiri lagi. Sepanjang hari, tanpa jeda. Yang bagus bukan yang cantik waktu diam di depan kamera, tapi yang ${c.proof} nya tetap terjaga persis waktu kamu bergerak cepat.`,
    cta: `[short pause] ${c.produk}. Kain yang ikut lari.`,
  }),
  (c) => ({
    hook: `Coba nilai satu potongan dari foto diam. Hampir selalu meleset.`,
    demo: `[medium pause] Bentuk aslinya baru keluar waktu tubuh berbelok dan lipatannya menyusul setengah detik kemudian, bukan sebelum itu. Foto tidak pernah menangkap bagian ini. Di situ ${c.proof} nya terbaca paling jujur, dan di situ juga potongan yang biasa saja langsung ketahuan.`,
    cta: `[short pause] ${c.produk}. Dinilai saat bergerak.`,
  }),
  (c) => ({
    hook: `Ada setengah detik antara langkah kaki dan kain yang menyusul.`,
    demo: `[long pause] Setengah detik itu yang membedakan jatuh bahan mahal dari yang murah, dan hampir tidak ada yang menyadarinya. Padahal justru di sana bedanya. Kalau ${c.proof} nya benar, kainnya berhenti sesudah kamu berhenti, bukan mendahului langkahmu sendiri.`,
    cta: `[short pause] ${c.produk}. Jatuhnya menyusul langkahmu.`,
  }),
  (c) => ({
    hook: `Bukan busana yang bagus untuk berpose. Ini untuk hari yang sibuk.`,
    demo: `[short pause] Naik motor, masuk ruangan dingin, duduk lama di kursi kantor, lalu berdiri lagi buru-buru. Belum termasuk cuaca di jalan. Semua itu meremas kain sepanjang hari. Yang tersisa sesudahnya, ${c.proof} nya, itu yang menentukan pantas atau tidak.`,
    cta: `[medium pause] ${c.produk}. Dinilai sesudah dipakai.`,
  }),
];

const TVC_JAM_TIGA: CopyFn[] = [
  (c) => ({
    hook: `[serious] Jam tiga pagi. Tidak ada yang melihat, tidak ada yang memuji.`,
    demo: `[medium pause] Cuma satu lampu kecil di sudut ruangan, gerakan sepelan mungkin, dan tangan yang sudah hafal urutannya di luar kepala. Di jam seperti ini ${c.proof} nya baru terasa berarti, karena sama sekali tidak ada waktu untuk mengulang.`,
    cta: `[short pause] ${c.produk}. Menemani jam paling sepi.`,
  }),
  (c) => ({
    hook: `Yang paling sulit dari malam bukan lelahnya. Tapi harus tetap pelan.`,
    demo: `[medium pause] Satu suara terlalu keras saja, semua usaha satu jam tadi hilang begitu saja. Makanya yang dipilih untuk jam segini selalu yang paling sederhana, yang ${c.proof} nya masih bisa dipercaya sambil setengah sadar.`,
    cta: `[short pause] ${c.produk}. Untuk tangan yang mengantuk.`,
  }),
  (c) => ({
    hook: `Rumah sudah diam sejak tadi. Satu orang masih belum selesai.`,
    demo: `[long pause] Dia bergerak hati-hati di antara perabot, hafal betul di bagian mana lantainya berbunyi. Semua sudah dihafalnya sejak lama. Yang dia bawa malam ini cuma satu benda, dan ${c.proof} nya sudah dia hafal jauh sebelum malam ini datang.`,
    cta: `[short pause] ${c.produk}. Ada di jam tersepi.`,
  }),
  (c) => ({
    hook: `Ada pekerjaan yang tidak pernah masuk foto keluarga siapa pun.`,
    demo: `[short pause] Yang jam tiga pagi, yang tidak pernah diceritakan ke siapa-siapa, yang sudah selesai sebelum orang serumah bangun. Tidak ada yang tahu. Untuk jam seperti itu, ${c.proof} bukan sekadar fitur tambahan. Itu satu-satunya alasan barangnya dipilih.`,
    cta: `[medium pause] ${c.produk}. Untuk yang bangun paling awal.`,
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
  return list[i](c);
}
