// GAYA REKAM — sumbu "bagaimana ini direkam", terpisah dari "apa yang dijual".
//
// Ide dari UGC Factory Higgsfield (Brian, 2026-08-12): mereka memisahkan
// pilihan KAMERA (General, Selfie, Mirror Selfie, ASMR, Podcast, Car Talking,
// Stream, Static) dari pilihan isi. Pemisahan itu benar dan kita belum punya:
// template kita menggabung hook, format, durasi, dan tier jadi satu, sehingga
// "video hijaber di kamar" dan "video hijaber di depan cermin" tidak bisa
// diminta terpisah padahal hasilnya jauh berbeda.
//
// INI PRESET BERNAMA, BUKAN KNOB BEBAS. Bedanya penting. Menambah kolom isian
// membuat hasil LEBIH BURUK ketika salah diisi — terbukti hari ini: dropdown
// kategori yang defaultnya "beauty" membuat gamis dijual pakai sudut skincare.
// Menambah PILIHAN JADI yang tiap satunya sudah matang membuat hasil lebih
// baik, karena yang bertambah bukan beban mengarang, tapi jumlah kemungkinan
// yang bisa dipilih dengan mata.
//
// Karena itu tiap gaya di sini WAJIB menyebut format mana yang cocok, dan
// pemanggil wajib menyaringnya. Menawarkan "selfie" pada format tangan-saja
// akan menabrak HANDS_ONLY_NEGATIVE ("no face") — dua instruksi berlawanan di
// satu prompt, dan hasilnya bukan pilihan yang lebih banyak, tapi render
// rusak yang dibayar penuh.
//
// STATUS BUKTI (diperbarui 2026-08-13, setelah tiga putaran render):
//   TERBUKTI  : standar, cermin, jalan, mobil, meja kerja, unboxing
//   DIBUANG   : selfie (tidak beda dari standar), meja (tampak-atas mustahil
//               selama frame pertama = foto produk apa adanya)
// Enam yang tersisa semuanya sudah dilihat hasilnya, bukan cuma dibaca.

export type StyleFormat = "hands_only" | "talking_head" | "ads";

export interface RecordingStyle {
  id: string;
  /** Nama pendek di kartu. */
  label: string;
  /** Satu baris: APA YANG TERLIHAT, bukan kapan dipakai.
   *  Pola Higgsfield — "Creator speaking straight to camera" bisa dibayangkan
   *  seketika, "cocok untuk brand yang ingin terlihat dekat" tidak. */
  lihat: string;
  /** Pengganti fragmen framing di shot-planner. Bahasa Inggris karena
   *  masuk prompt model, sama seperti konstanta framing yang sudah ada. */
  framing: string;
  /** Format yang boleh memakainya. TVC sengaja TIDAK pernah masuk: TVC punya
   *  TVC_STYLE_LOCK sendiri demi konsistensi antar-shot, dan menimpanya
   *  membatalkan alasan kunci itu ada. */
  formats: StyleFormat[];
  /** Negative tambahan khusus gaya ini. */
  negative?: string;
  /** Kategori produk yang paling diuntungkan — dipakai mengurutkan, bukan
   *  membatasi. Kosong = merata. */
  bestFor?: string[];
}

// DUA GAYA DIBUANG 2026-08-13 setelah dirender, bukan setelah dibaca:
//
//   "Selfie" — tidak bisa dibedakan dari Standar. TALKING_HEAD_FRAMING sudah
//     berbunyi "front-facing selfie-style angle", jadi gaya ini menambah
//     pilihan tanpa menambah hasil. Pilihan yang tidak mengubah apa pun lebih
//     buruk daripada tidak ada pilihan: ia menghabiskan perhatian brand dan
//     membuat sisa daftarnya ikut terasa tidak berarti.
//
//   "Di Atas Meja" — dua kali dirender, dua kali gagal, termasuk dengan foto
//     produk polos tanpa tangan. Komposisi tampak-atas bertabrakan dengan
//     frame pertama yang selalu berupa foto produk apa adanya (mode i2v).
//     Kami tidak bisa menepatinya, jadi kami tidak menawarkannya.
export const RECORDING_STYLES: RecordingStyle[] = [
  {
    id: "standar",
    label: "Standar",
    lihat: "Framing bawaan format yang dipilih — paling aman untuk semua produk.",
    framing: "", // kosong = pakai framing bawaan format (lihat shot-planner)
    formats: ["hands_only", "talking_head", "ads"],
  },
  {
    id: "cermin",
    label: "Selfie Cermin",
    lihat: "Berdiri di depan cermin, ponsel terlihat di tangan, seluruh outfit kelihatan.",
    framing:
      "full body mirror selfie, the presenter standing in front of a large mirror holding the phone visibly in " +
      "one hand, the whole outfit visible head to toe in the reflection, phone-camera look with slight " +
      "reflection glare, soft natural window light, lived-in bedroom or fitting room behind",
    formats: ["talking_head"],
    // Fashion dinilai dari potongan dan jatuh bahan — dan itu hanya terlihat
    // kalau seluruh badan masuk frame.
    bestFor: ["fashion", "muslim_fashion"],
  },
  {
    id: "unboxing",
    label: "Unboxing",
    lihat: "Paket dibuka dari atas, isinya dikeluarkan satu per satu.",
    framing:
      "top-down overhead shot of a shipping package being opened, hands peeling the tape and lifting the product " +
      "out of the box, packaging material visible around it, natural daylight, real unedited home surface, " +
      "close enough that the product fills most of the frame once revealed",
    formats: ["hands_only"],
    negative: "no face, no head in frame, no person facing camera",
  },
  {
    id: "mobil",
    label: "Di Mobil",
    lihat: "Duduk di kursi mobil yang parkir, cahaya dari jendela, bicara ke kamera.",
    framing:
      "seated in the drivers seat of a parked car, phone mounted or held at chest height, face and shoulders in " +
      "frame with the car window and daylight behind, soft directional natural light from the side window, " +
      "casual candid vibe, car interior visible but out of focus",
    formats: ["talking_head", "ads"],
  },
  {
    id: "jalan",
    label: "Sambil Jalan",
    lihat: "Berjalan di luar sambil bicara ke kamera, latar bergerak.",
    framing:
      "handheld walking shot outdoors, the presenter walking while talking to the camera held at arms length, " +
      "background moving behind them, natural outdoor daylight, gentle authentic camera bounce from the walking " +
      "motion, everyday street or mall setting",
    formats: ["talking_head", "ads"],
  },
  {
    id: "meja_kerja",
    label: "Meja Kerja",
    lihat: "Duduk di meja dengan pencahayaan rapi, nada menjelaskan seperti podcast.",
    framing:
      "seated at a desk facing the camera straight on, tidy workspace visible behind, controlled soft key light " +
      "on the face, steady tripod-locked framing with no camera movement, calm explanatory posture, " +
      "clean neutral background",
    formats: ["talking_head", "ads"],
    // Nada menjelaskan cocok untuk yang harus dipahami dulu sebelum dibeli.
    bestFor: ["jasa", "app", "gadget", "electronics", "health"],
  },
];

/** Gaya yang boleh ditawarkan untuk sebuah format. SELALU pakai ini di UI —
 *  menawarkan gaya yang tidak cocok bukan menambah pilihan, tapi menyiapkan
 *  render rusak yang tetap dibayar penuh. */
export function stylesForFormat(format: string, productCategory?: string): RecordingStyle[] {
  const cocok = RECORDING_STYLES.filter((s) => s.formats.includes(format as StyleFormat));
  if (!productCategory) return cocok;
  // Yang secara khusus menguntungkan kategori ini naik ke depan — "standar"
  // tetap pertama supaya pilihan aman selalu paling mudah diraih.
  return [...cocok].sort((a, b) => {
    if (a.id === "standar") return -1;
    if (b.id === "standar") return 1;
    const sa = a.bestFor?.includes(productCategory) ? 0 : 1;
    const sb = b.bestFor?.includes(productCategory) ? 0 : 1;
    return sa - sb;
  });
}

export function getRecordingStyle(id: string | null | undefined): RecordingStyle | null {
  if (!id) return null;
  return RECORDING_STYLES.find((s) => s.id === id) ?? null;
}

/** Gaya bawaan untuk sebuah format bila brand tidak memilih. Sengaja
 *  mengembalikan "standar" (framing kosong = perilaku lama), bukan gaya
 *  favorit: perubahan diam-diam pada video yang sudah jalan bukan peningkatan,
 *  itu kejutan. */
export const GAYA_BAWAAN = "standar";
