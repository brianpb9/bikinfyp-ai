// Template kampanye (permintaan Brian 2026-08-11: "mungkin ada templates juga,
// jadi nanti tinggal ganti productnya saja. templatenya sudah kita buat").
//
// Dia benar bahwa bahannya sudah ada — 16 keluarga hook, 3 format, 3 level
// hook, 3 durasi, 7 persona. Yang belum ada adalah PENGEMASANNYA. Selama ini
// brand harus paham arti "H10" atau "Tangan + VO" untuk mendapat hasil bagus;
// template mengubahnya jadi satu pilihan bernama yang sudah terbukti.
//
// Template SENGAJA bukan tabel database. Isinya keputusan kreatif kami, bukan
// data milik brand: ia ikut versi kode, bisa ditinjau lewat diff, dan tidak
// perlu migrasi tiap kali kami menambah satu. Kalau nanti brand boleh menyimpan
// preset sendiri, ITU yang masuk database — bukan yang ini.

export type TemplateKind = "affiliate" | "ads" | "tvc";
export type TemplateFormat = "hands_only" | "talking_head" | "tvc" | "ads";
// silent_caption masuk ke sini (2026-08-11). Dari 12 video pemenang yang
// dibedah Brian, EMPAT sengaja tanpa voice-over dan seluruh pesannya dipikul
// teks di layar — itu bukan versi murah dari video ber-VO, itu aliran produksi
// tersendiri dengan aturan berbeda (teks jauh lebih pendek, musik jadi bintang).
export type TemplateTier = "silent_caption" | "high_quality" | "super_hq";
export type TemplateHookLevel = import("./config/hooks").HookLevel;

export interface CampaignTemplate {
  id: string;
  name: string;
  /** Satu kalimat: KAPAN template ini dipakai, bukan apa isinya. */
  when: string;
  kind: TemplateKind;
  format: TemplateFormat;
  durationSec: 15 | 30;
  tier: TemplateTier;
  hookLevel: TemplateHookLevel;
  /** Keluarga hook yang dipaksa. null = biarkan mesin memilih per kategori. */
  hookFamily: string | null;
  /** Jumlah variasi video yang disarankan. */
  count: number;
  /** Kategori produk yang paling cocok — untuk penyaringan di galeri. */
  bestFor: string[];
  /** Klip contoh, atau null kalau berkasnya BELUM ada.
   *
   * Ke-12 template format memakai potongan 6 detik dari video sumbernya
   * MASING-MASING (Brian mengirim berkasnya 2026-08-11). Titik potongnya
   * dipilih dari shot list di dokumen bedah, di bagian yang paling
   * menunjukkan formula template itu — bukan detik pertama begitu saja.
   *
   * Ini klip REFERENSI dari portfolio yang dibedah, bukan hasil render mesin
   * kami. Diganti begitu 12 render sungguhan per template tersedia.
   *
   * T01, T03, T07, dan T09 sempat ditahan karena frame-nya membawa watermark
   * TikTok berisi handle kreator dan tulisan larangan penggunaan komersial.
   * Brian mengonfirmasi 2026-08-11 bahwa portfolio itu produksi timnya
   * sendiri, jadi keempatnya ikut dipasang.
   *
   * Harus null — bukan menunjuk ke berkas yang belum diunggah. Diuji
   * 2026-08-11: src yang 404 menyisakan elemen <video> kosong yang tampil
   * sebagai kotak hitam polos, dan itu TIDAK bisa dideteksi dengan andal dari
   * sisi klien — pada 404 yang sudah ter-cache, event "error" media lewat
   * sebelum React sempat memasang pendengarnya (terukur: pendengar terpasang
   * di 23 elemen, handler jalan nol kali, padahal properti v.error terisi di
   * 12 elemen). Event media juga tidak menggelembung, jadi tidak ada tempat
   * lain menangkapnya.
   *
   * Yang ada di disk kita tahu pasti tanpa menebak di browser. Cara menambah
   * pratinjau ada di public/previews/README-12-format.md — satu baris per
   * template, dan kartunya langsung hidup. */
  preview: string | null;
  accent: "amber" | "rose" | "emerald" | "violet" | "sky" | "zinc";
  /** Rute TVC — hanya untuk kind "tvc". Lihat lib/media/shot-planner.ts. */
  tvcRoute?: "luxury" | "reallife" | "comedy";
  /** Rasio yang dipaksa template ini. Kosong = ikut pilihan pengguna (9:16).
   *
   * Ada karena dua template TVC ditulis dan dirender 16:9 landscape: brand
   * melihat pratinjau landscape, lalu tanpa ini hasilnya keluar potret. */
  ratio?: "9:16" | "1:1" | "16:9";
  /** Jumlah adegan yang diminta ke perencana shot. Kosong = satu ambilan. */
  shotCount?: number;
  /** Angka dari video sumber yang dibedah — dipakai untuk jujur soal jarak
   * antara referensinya dan yang bisa mesin kami hasilkan hari ini. */
  source?: { durationSec: number; shots: number; bpm?: number };
  /** Peringatan yang WAJIB terbaca sebelum brand memakai template ini.
   *
   * Dipisah badge/note karena rambunya tidak seragam: klaim hasil
   * (before/after, day 1 vs day 7, dua lengan) memang tidak boleh dibuat AI
   * sama sekali, sedangkan vox pop boleh dibuat AI ASALKAN diberi label
   * dramatisasi. Menyamakan keduanya di satu label membuat yang satu terlalu
   * longgar dan yang lain terlalu ketat. */
  caution?: { badge: string; note: string };
  /** Batas beat sebagai PECAHAN durasi, dihitung dari shot list dokumen bedah.
   *
   * Tanpa ini semua template memakai pembagian yang sama (hook 20%, demo
   * sampai 67%) — dan itu membuat template hanya meminjam kata-katanya, bukan
   * meniru kontennya (temuan Brian 2026-08-11). Angkanya memang berbeda jauh:
   * T01 memberi hook 7% durasi karena hook-nya satu kalimat pendek, sedangkan
   * T05 memberi 42% karena perbandingan before/after ITU SENDIRI yang jadi
   * hook dan penonton butuh waktu memelototinya. */
  beats?: { hookEnd: number; demoEnd: number };
  /** Kelompok di galeri. Dua kelompok ini sumbu yang BERBEDA, bukan versi
   * lama vs baru: "format" menentukan bentuk videonya (berapa adegan, ada VO
   * atau tidak, apa yang dibuktikan), "sudut" menentukan dari mana produknya
   * didekati (racun checkout, diskon, spill rahasia). Satu produk bisa pakai
   * format T02 dengan sudut mana pun. */
  group?: "format" | "sudut" | "lain";
}

// ── 12 TEMPLATE UGC AFFILIATE ───────────────────────────────────────────────
//
// Sumber: bedah portfolio 12 video pemenang yang Brian kirim 2026-08-11
// (00-INDEX-12-Template.md + T01..T12). Setiap video ternyata memakai FORMAT
// yang berbeda — 12 formula terpisah, bukan 12 variasi satu formula.
//
// Ini menggantikan tujuh template affiliate lama. Yang lama kami karang
// sendiri dari keluarga hook; yang ini diturunkan dari video yang benar-benar
// menang, lengkap dengan durasi, jumlah shot, dan tempo musiknya. Tabel "pilih
// berdasarkan produkmu" di dokumen indeks persis fungsi sebuah galeri
// template, jadi `when` di bawah memakai kalimat itu.
//
// EMPAT TEMPLATE MEMBAWA RAMBU (`caution`), dengan dua aturan berbeda.
// T05, T08, dan T10 adalah KLAIM HASIL — before/after berdampingan, day 1 vs
// day 7, perbandingan dua lengan. Dokumen Brian sendiri melarangnya dibuat
// dengan AI, dan larangan itu benar: membuat "bukti" efek produk pada kulit
// orang secara sintetis adalah bukti palsu, berapa pun bagusnya hasil
// rendernya. T12 (vox pop) beda kasus — boleh dibuat AI, tapi WAJIB diberi
// label dramatisasi, karena risikonya testimoni palsu. Keempatnya tetap
// dipajang sebagai format yang kami pahami, dengan alasannya ditulis
// terbuka — bukan dihapus diam-diam, dan bukan pula disediakan tombol yang
// menghasilkan bukti palsu.
//
// CATATAN JARAK TEKNIS: enam dari 12 video sumber berpotongan 1,66–2,50 detik
// per shot. Perencana shot kami mematok MINIMUM 4 detik per adegan (batas
// provider), jadi ritme secepat itu belum bisa kami hasilkan. `shotCount` di
// bawah adalah yang REALISTIS untuk mesin sekarang, `source.shots` adalah
// aslinya. Jangan disamakan.

// Tujuh template "Sudut hook" memakai klip yang sama dengan template FORMAT
// tertentu — dipilih yang sudutnya paling dekat (Racun Checkout memakai klip
// yang menonjolkan harga, Before/After memakai klip day-1-vs-day-7, dan
// seterusnya). Ini ILUSTRASI sudut, bukan hasil template itu sendiri; yang
// penting tiap kartu bisa dibedakan, karena sebelumnya tujuh kartu ini cuma
// memutar dua klip yang sama berulang-ulang.
export const CAMPAIGN_TEMPLATES: CampaignTemplate[] = [
  {
    id: "racun-checkout", group: "sudut",
    name: "Racun Checkout",
    when: "Andalan harian. Dorong orang langsung ke keranjang tanpa terasa memaksa.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H10", count: 3,
    bestFor: ["beauty", "food", "kitchen", "fashion"],
    preview: "/previews/t05-before-after.mp4", accent: "amber",
  },
  {
    id: "review-jujur", group: "sudut",
    name: "Review Jujur",
    when: "Produk yang butuh kepercayaan dulu — skincare, suplemen, alat.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H3", count: 3,
    bestFor: ["beauty", "health", "electronics"],
    preview: "/previews/t10-bukti-di-lengan.mp4", accent: "emerald",
  },
  {
    id: "unboxing", group: "sudut",
    name: "Unboxing Estetik",
    when: "Kemasannya bagus dan layak dipamerkan. Fokus ke momen buka paket.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H4", count: 4,
    bestFor: ["beauty", "fashion", "electronics", "kitchen"],
    preview: "/previews/t02-bedah-fitur.mp4", accent: "violet",
  },
  {
    id: "before-after", group: "sudut",
    name: "Sebelum vs Sesudah",
    when: "Hasilnya kelihatan mata. Skincare, pembersih, alat rapikan rumah.",
    kind: "affiliate", format: "hands_only", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H11", count: 3,
    bestFor: ["beauty", "kitchen", "health"],
    preview: "/previews/t08-day-1-vs-day-7.mp4", accent: "sky",
  },
  {
    id: "diskon-gede", group: "sudut",
    name: "Diskon Gede",
    when: "Sedang promo betulan. Angka harganya yang jadi bintang.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "high_quality",
    hookLevel: "gila", hookFamily: "H1", count: 4,
    bestFor: ["fashion", "muslim_fashion", "electronics", "food"],
    preview: "/previews/t04-hook-indrawi.mp4", accent: "rose",
  },
  {
    id: "buat-kamu-yang", group: "sudut",
    name: "Buat Kamu Yang...",
    when: "Menyasar satu jenis pembeli dengan tajam, bukan semua orang.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H8", count: 3,
    bestFor: ["muslim_fashion", "fashion", "beauty", "health"],
    preview: "/previews/t06-swatch-shade.mp4", accent: "amber",
  },
  {
    id: "spill-rahasia", group: "sudut",
    name: "Spill Rahasia",
    when: "Produk yang orang penasaran tapi jarang dibahas terang-terangan.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "gila", hookFamily: "H14", count: 3,
    bestFor: ["beauty", "health", "fashion"],
    preview: "/previews/t11-hook-misteri.mp4", accent: "violet",
  },
  // ── T01 ───────────────────────────────────────────────────────────────────
  {
    id: "t01-tempat-susah", group: "format",
    name: "Pakai di Tempat Susah",
    when: "Produk dipakai di luar rumah dan sering merepotkan. Tempat susah bikin produk terasa dibutuhkan, bukan dijual.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H12", count: 3, shotCount: 3,
    bestFor: ["beauty", "food", "gadget", "home"],
    source: { durationSec: 20, shots: 12, bpm: 102 },
    beats: { hookEnd: 0.070, demoEnd: 0.881 },
    preview: "/previews/t01-tempat-susah.mp4", accent: "emerald",
  },
  // ── T02 ───────────────────────────────────────────────────────────────────
  {
    id: "t02-bedah-fitur", group: "format",
    name: "Bedah Fitur",
    when: "Produk punya banyak bagian fisik yang bisa dipegang, ditekan, ditarik. Satu fitur = satu adegan = satu kalimat.",
    kind: "affiliate", format: "talking_head", durationSec: 30, tier: "high_quality",
    hookLevel: "agak_berani", hookFamily: "H9", count: 3, shotCount: 6,
    bestFor: ["gadget", "home", "fashion"],
    source: { durationSec: 22, shots: 10, bpm: 97 },
    beats: { hookEnd: 0.107, demoEnd: 0.873 },
    preview: "/previews/t02-bedah-fitur.mp4", accent: "sky",
  },
  // ── T03 ───────────────────────────────────────────────────────────────────
  {
    id: "t03-liputan-event", group: "format",
    name: "Liputan Event",
    when: "Sedang ada bazar, booth, atau grand opening. Yang dijual tempatnya, produk cuma oleh-oleh di akhir.",
    kind: "affiliate", format: "talking_head", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H10", count: 2, shotCount: 6,
    bestFor: ["toko", "food", "beauty"],
    source: { durationSec: 31, shots: 7, bpm: 106 },
    beats: { hookEnd: 0.273, demoEnd: 0.820 },
    preview: "/previews/t03-liputan-event.mp4", accent: "amber",
  },
  // ── T04 ───────────────────────────────────────────────────────────────────
  {
    id: "t04-hook-indrawi", group: "format",
    name: "Hook Indrawi",
    when: "Makanan atau minuman yang BERBUNYI. Penonton disuruh mendengar, bukan melihat — dan itu memaksa mereka menyalakan suara.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "agak_berani", hookFamily: "H1", count: 3, shotCount: 3,
    bestFor: ["food"],
    source: { durationSec: 20, shots: 8, bpm: 81 },
    beats: { hookEnd: 0.160, demoEnd: 0.730 },
    preview: "/previews/t04-hook-indrawi.mp4", accent: "rose",
  },
  // ── T05 ── KLAIM HASIL ────────────────────────────────────────────────────
  {
    id: "t05-before-after", group: "format",
    name: "Before / After Sebelah-Sebelahan",
    when: "Hasilnya bisa dilihat berdampingan dalam satu frame. Tanpa narasi — perbandingannya yang bicara.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "silent_caption",
    hookLevel: "normal", hookFamily: "H11", count: 2, shotCount: 2,
    bestFor: ["beauty"],
    source: { durationSec: 19, shots: 2, bpm: 126 },
    caution: { badge: "Butuh rekaman asli", note:
      "Perbandingan before/after adalah klaim hasil pada tubuh orang. Kedua sisi wajib direkam sungguhan dengan cahaya, sudut, dan kamera yang sama — membuatnya dengan AI berarti membuat bukti palsu." },
    beats: { hookEnd: 0.423, demoEnd: 0.847 },
    preview: "/previews/t05-before-after.mp4", accent: "violet",
  },
  // ── T06 ───────────────────────────────────────────────────────────────────
  {
    id: "t06-swatch-shade", group: "format",
    name: "Swatch Semua Varian",
    when: "Punya banyak varian warna atau rasa. Videonya tidak menjual satu produk — dia memaksa penonton memilih.",
    kind: "affiliate", format: "hands_only", durationSec: 30, tier: "silent_caption",
    hookLevel: "normal", hookFamily: "H13", count: 2, shotCount: 5,
    bestFor: ["beauty", "fashion", "food"],
    source: { durationSec: 27, shots: 5, bpm: 147 },
    beats: { hookEnd: 0.150, demoEnd: 0.897 },
    preview: "/previews/t06-swatch-shade.mp4", accent: "rose",
  },
  // ── T07 ───────────────────────────────────────────────────────────────────
  {
    id: "t07-checklist-berjalan", group: "format",
    name: "Checklist Berjalan",
    when: "Punya 2-3 klaim yang bisa diperagakan. Klaimnya ter-centang tepat saat diperagakan, bukan cuma dijanjikan.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "agak_berani", hookFamily: "H8", count: 3, shotCount: 3,
    bestFor: ["beauty", "home"],
    source: { durationSec: 12, shots: 5, bpm: 101 },
    beats: { hookEnd: 0.245, demoEnd: 0.899 },
    preview: "/previews/t07-checklist-berjalan.mp4", accent: "emerald",
  },
  // ── T08 ── KLAIM HASIL ────────────────────────────────────────────────────
  {
    id: "t08-day-1-vs-day-7", group: "format",
    name: "Day 1 vs Day 7",
    when: "Hasilnya butuh waktu berhari-hari. Bukti terkuat dari kedua belas — dan satu-satunya yang tidak bisa dipalsukan.",
    kind: "affiliate", format: "hands_only", durationSec: 30, tier: "silent_caption",
    hookLevel: "normal", hookFamily: "H11", count: 2, shotCount: 2,
    bestFor: ["beauty"],
    source: { durationSec: 22, shots: 2, bpm: 108 },
    caution: { badge: "Butuh rekaman asli", note:
      "Inti template ini adalah perubahan nyata pada tubuh seseorang selama tujuh hari. Menghasilkan \"DAY 7\" secara sintetis berarti menipu pembeli soal keputusan kesehatannya. Sediakan tujuh hari, rekam dua kali dengan setelan yang persis sama." },
    beats: { hookEnd: 0.223, demoEnd: 0.936 },
    preview: "/previews/t08-day-1-vs-day-7.mp4", accent: "zinc",
  },
  // ── T09 ───────────────────────────────────────────────────────────────────
  {
    id: "t09-bahan-aktif", group: "format",
    name: "Klaim + Bahan Aktif",
    when: "Yang dijual formulanya. Untuk pembeli yang riset dulu sebelum beli — nama panjang dan teknis justru jadi kredibilitas.",
    kind: "affiliate", format: "talking_head", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H7", count: 3, shotCount: 3,
    bestFor: ["beauty", "food"],
    source: { durationSec: 23, shots: 3, bpm: 94 },
    beats: { hookEnd: 0.171, demoEnd: 0.896 },
    preview: "/previews/t09-bahan-aktif.mp4", accent: "violet",
  },
  // ── T10 ── KLAIM HASIL ────────────────────────────────────────────────────
  {
    id: "t10-bukti-di-lengan", group: "format",
    name: "Bukti di Lengan",
    when: "Efeknya muncul di kulit lengan atau tangan. Buka dengan bukti, tutup dengan bukti — produknya cuma penjelasan di tengah.",
    kind: "affiliate", format: "talking_head", durationSec: 15, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H15", count: 2, shotCount: 3,
    bestFor: ["beauty"],
    source: { durationSec: 19, shots: 8, bpm: 63 },
    caution: { badge: "Butuh rekaman asli", note:
      "Adegan perbandingan dua lengan adalah klaim hasil produk pada kulit. Wajib direkam sungguhan; kalau dibuat AI, kamu memalsukan buktinya." },
    beats: { hookEnd: 0.159, demoEnd: 0.929 },
    preview: "/previews/t10-bukti-di-lengan.mp4", accent: "amber",
  },
  // ── T11 ───────────────────────────────────────────────────────────────────
  {
    id: "t11-hook-misteri", group: "format",
    name: "Hook Misteri",
    when: "Produk punya tekstur atau warna yang tidak biasa. Orang bertahan bukan karena tertarik — karena tidak tahan tidak tahu.",
    kind: "affiliate", format: "hands_only", durationSec: 15, tier: "silent_caption",
    hookLevel: "berani", hookFamily: "H6", count: 3, shotCount: 2,
    bestFor: ["beauty", "food"],
    source: { durationSec: 10, shots: 2, bpm: 89 },
    beats: { hookEnd: 0.249, demoEnd: 0.798 },
    preview: "/previews/t11-hook-misteri.mp4", accent: "zinc",
  },
  // ── T12 ───────────────────────────────────────────────────────────────────
  {
    id: "t12-vox-pop", group: "format",
    name: "Vox Pop Jalanan",
    when: "Produk dibeli karena pendapat orang lain. Menjual dengan tekanan sosial, bukan dengan fitur.",
    kind: "affiliate", format: "talking_head", durationSec: 30, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H4", count: 2, shotCount: 4,
    bestFor: ["beauty", "fashion", "gadget"],
    source: { durationSec: 23, shots: 4, bpm: 116 },
    caution: { badge: "Wajib diberi label", note:
      "Vox pop bekerja karena penonton percaya ini orang sungguhan. Narasumber AI yang ditampilkan sebagai wawancara jalanan nyata adalah testimoni palsu — kalau tetap dibuat AI, videonya WAJIB diberi label dramatisasi." },
    beats: { hookEnd: 0.178, demoEnd: 0.889 },
    preview: "/previews/t12-vox-pop.mp4", accent: "sky",
  },
  {
    id: "kenalin-bisnis", group: "lain",
    name: "Kenalin Bisnismu",
    when: "Buat app, jasa, atau toko yang belum banyak dikenal. Presenter yang menjelaskan.",
    kind: "ads", format: "ads", durationSec: 15, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H12", count: 3,
    bestFor: ["jasa", "app", "toko"],
    preview: "/previews/format-ads.mp4", accent: "sky",
  },
  {
    id: "promo-terbatas", group: "lain",
    name: "Promo Terbatas",
    when: "Ada penawaran yang benar-benar berbatas waktu. Langsung ke ajakan, tanpa basa-basi.",
    kind: "ads", format: "ads", durationSec: 15, tier: "high_quality",
    hookLevel: "berani", hookFamily: "H10", count: 4,
    bestFor: ["jasa", "toko", "beauty", "fashion", "food"],
    preview: "/previews/format-ads.mp4", accent: "rose",
  },
  // Dua template TVC dinamai persis seperti produksi Brian yang memang sudah
  // jadi — "THE DROP" dan "SEHARIAN". Preview-nya potongan dari video aslinya,
  // bukan klip pengganti: kalau brand memilih template bernama The Drop, yang
  // dia lihat harus benar-benar The Drop.
  //
  // Varian generik "TVC 15/30 Detik" dihapus. Di sebelah dua konsep yang punya
  // rute, tempo, dan hasil nyata, keduanya cuma terbaca sebagai pengisi — dan
  // durasi tetap bisa diubah sendiri di langkah Konsep.
  {
    id: "tvc-the-drop", group: "lain",
    name: "The Drop",
    when: "Produk yang keunggulannya ada di bahan dan cara kerjanya. Makro, tekstur, mekanisme.",
    kind: "tvc", format: "tvc", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H12", count: 2, tvcRoute: "luxury",
    bestFor: ["beauty", "health", "kitchen"],
    ratio: "16:9",
    preview: "/previews/tvc-the-drop.mp4", accent: "zinc",
  },
  {
    id: "tvc-tersangka", group: "lain",
    name: "Tersangka Glowing",
    when: "Hasilnya kelihatan sampai orang curiga. Parodi ruang sidang — produknya jadi punchline, bukan dipuja.",
    kind: "tvc", format: "tvc", durationSec: 30, tier: "high_quality",
    // ENAM adegan, bukan empat. Rute komedi punya empat beat tengah dan yang
    // terakhir adalah PEMBALIKANNYA — si penuduh ketahuan ikut memotret
    // produknya. Dengan empat adegan (hook + 2 tengah + packshot) beat itu
    // tidak pernah tercapai, dan lelucon tanpa pembalikan cuma jadi adegan
    // aneh. 30 dtk / 6 = 5 dtk per adegan, masih di atas minimum 4 dtk.
    hookLevel: "berani", hookFamily: "H6", count: 2, shotCount: 6,
    tvcRoute: "comedy", ratio: "16:9",
    bestFor: ["beauty", "health", "fashion"],
    source: { durationSec: 30, shots: 6 }, // dokumen TVC 3 tidak menyebut BPM
    preview: "/previews/tvc-tersangka.mp4", accent: "rose",
  },
  {
    id: "tvc-seharian", group: "lain",
    name: "Seharian",
    when: "Produk yang harus bertahan seharian — sunscreen, deodoran, makeup tahan lama.",
    kind: "tvc", format: "tvc", durationSec: 30, tier: "high_quality",
    hookLevel: "normal", hookFamily: "H11", count: 2, tvcRoute: "reallife",
    bestFor: ["beauty", "health", "fashion"],
    ratio: "16:9",
    preview: "/previews/tvc-seharian.mp4", accent: "sky",
  },
];

export function getTemplate(id: string | null | undefined): CampaignTemplate | null {
  if (!id) return null;
  return CAMPAIGN_TEMPLATES.find((t) => t.id === id) ?? null;
}
