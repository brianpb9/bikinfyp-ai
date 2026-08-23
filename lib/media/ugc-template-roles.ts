// Peran shot per template UGC affiliate.
//
// Ini yang membuat ke-12 template benar-benar mengubah VIDEONYA, bukan cuma
// labelnya. Sebelum ini T02 ("Bedah Fitur", 4 makro berturut-turut) dan T09
// ("Klaim + Bahan Aktif", kamera nyaris tidak pindah) menghasilkan struktur
// shot yang sama persis — yang berbeda hanya keluarga hook dan durasinya.
//
// Diturunkan dari shot list nyata di dokumen bedah (T01..T12, Brian
// 2026-08-11). Yang disalin adalah FUNGSI tiap shot dan gerak kameranya,
// bukan produk atau talent-nya — itu tetap milik brand yang memakai template.
//
// EMPAT TEMPLATE SENGAJA TIDAK ADA DI SINI:
//   T05 before/after · T08 day 1 vs day 7 · T10 bukti di lengan
//     Inti ketiganya adalah adegan BUKTI hasil pada tubuh orang. Memberi
//     model peran "tunjukkan dua kondisi berdampingan" berarti menyuruhnya
//     mengarang bukti — persis yang dilarang dokumen bedahnya. Ketiganya
//     jatuh ke beat generik, dan kartunya sudah membawa rambu merah.
//   T12 vox pop
//     Butuh empat narasumber BERBEDA. Seluruh pipeline kami dibangun di atas
//     satu character-lock; meminta empat wajah berbeda justru melawan penjaga
//     konsistensi identitas (QC-03) dan hasilnya wajah yang berubah-ubah di
//     tengah video, bukan empat orang.

export interface UgcShotRole {
  /** Apa yang terjadi di shot ini. Fungsi, bukan produk tertentu. */
  role: string;
  /** Gerak kamera. Ditulis eksplisit karena tanpa ini semua shot keluar statis. */
  camera: string;
  /** Produk TIDAK boleh terlihat di shot ini.
   *
   *  PENANDA EKSPLISIT, bukan hasil membaca teks perannya. Versi pertama
   *  mendeteksinya dengan mencocokkan frasa Inggris ("NOT visible yet"), dan
   *  langsung meleset di template yang menulis "must NOT be visible" —
   *  tertangkap tes. Keputusan yang mengeluarkan uang (frame buatan ~Rp600)
   *  tidak boleh bergantung pada kebetulan pilihan kata. */
  withholdProduct?: boolean;
  /** Pembukanya SENGAJA diam, dan kediaman itu bagian dari efeknya —
   *  ruangan sunyi yang ditahan sebentar sebelum pintu didobrak. Menyuruh
   *  "sudah bergerak sejak frame pertama" di sini akan membatalkan umpannya.
   *
   *  DATA, bukan ditebak dari prosa: aturan detik-pertama mengeluarkan
   *  perintah ke model, dan menebak dari kata bukan cara memutuskan itu. */
  pembukaDiam?: boolean;
}

export interface UgcTemplateRoles {
  /** Shot pembuka. Kosong = pakai pembuka generik format itu. */
  opening?: UgcShotRole;
  /** Shot tengah, dipakai berulang bila adegannya lebih banyak dari isinya. */
  middle: UgcShotRole[];
  /** Shot penutup. Kosong = pakai penutup generik. */
  closing?: UgcShotRole;
}


export const UGC_TEMPLATE_ROLES: Record<string, UgcTemplateRoles> = {
  // T01 — produk dibawa ke tempat yang bikin memakainya merepotkan.
  // Kunci dari dokumennya: hanya 13% durasi yang benar-benar iklan, dan satu
  // kegiatan di tengah sengaja TIDAK ada hubungannya dengan produk.
  "t01-tempat-susah": {
    opening: {
      role: `talking straight to camera at arm's length while holding the product beside their face, somewhere clearly outdoors and a little inconvenient — the place itself is the point`,
      camera: `handheld selfie at arm's length, natural micro-shake, no zoom`,
    },
    middle: [
      {
        role: `arriving and settling into the place, doing something ordinary that has nothing to do with the product — this is what makes the video feel like something that happened rather than an ad`,
        camera: `handheld following from behind, natural walking bounce`,
      },
      {
        role: `digging the product out of a bag or pouch on the ground, the everyday awkwardness of using it here made visible`,
        camera: `close handheld looking down at the hands, slight refocus`,
      },
      {
        role: `actually using the product in this awkward place, unglamorous and real, with a small honest reaction to it`,
        camera: `static close selfie, natural shake`,
      },
    ],
    closing: {
      role: `back to the opening framing and the same pose, product beside the face again, relaxed and pleased — the loop closes where it started`,
      camera: `handheld selfie at arm's length, matching the opening framing`,
    },
  },

  // T02 — satu fitur, satu makro, satu kalimat. Polanya dari dokumennya:
  // 3 shot orang → 4 makro berturut-turut → 2 shot orang → produk sendirian.
  "t02-bedah-fitur": {
    opening: {
      role: `sitting with or resting a hand on the product, talking to camera, relaxed and unhurried — establishing that they actually own and use this thing`,
      camera: `static tripod at eye level, no movement`,
    },
    middle: [
      {
        role: `extreme close-up of a hand pressing, pulling or opening ONE specific part of the product, the material visibly responding to the touch — sharp focus exactly at the contact point`,
        camera: `static macro, tiny handheld drift, sharp focus on the contact point`,
      },
      {
        role: `extreme close-up of a DIFFERENT part being touched, a different material and a different action from the previous shot`,
        camera: `static macro from a different angle, shallow depth of field`,
      },
      {
        role: `extreme close-up of a moving or mechanical part being operated, the mechanism visibly working`,
        camera: `static macro following the movement slightly`,
      },
      {
        role: `the product actually in use in its normal setting, the person using it as they would on any ordinary day`,
        camera: `static side profile, no movement`,
      },
    ],
    closing: {
      role: `the product completely alone in the room with nobody in frame, clean and composed — after watching a person for the whole video, the eye moves entirely to the product`,
      camera: `static, no movement, the product settling still`,
    },
  },

  // T03 — menjual TEMPAT, bukan barang. Produk masuk paling akhir dan
  // dikaitkan dengan kegiatan di lokasi.
  "t03-liputan-event": {
    opening: {
      role: `walking through a busy public space while talking excitedly to camera, the crowd and signage moving past behind them — inviting people to come, not to buy`,
      camera: `handheld selfie at arm's length, natural walking bounce`,
    },
    middle: [
      {
        role: `panning across a branded stand or display, taking in the products and signage, a few visitors browsing`,
        camera: `handheld, slow pan across the display, natural shake`,
      },
      {
        role: `a different corner of the same place, a different colour and layout, proving the visit was real and there was more than one thing to see`,
        camera: `handheld tilt-up, slow, natural shake`,
      },
      {
        role: `holding up something they got at the place toward camera, turning it so it catches the light, visibly pleased`,
        camera: `static selfie, natural handheld shake`,
      },
    ],
    closing: {
      role: `holding the product with the venue still visible behind them, tying it to what they just did there rather than selling it on its own`,
      camera: `static selfie, natural micro-shake`,
    },
  },

  // T04 — buka dengan menyuruh penonton MENDENGAR. Seluruh video dari satu
  // meja, satu posisi kamera; yang berubah hanya apa yang dipegang.
  "t04-hook-indrawi": {
    opening: {
      role: `close-up at a table, bringing the product to the mouth or ear and triggering its sound — the loudest, crispest physical moment the product can make, with the reaction on their face`,
      camera: `static tripod at table height, no movement`,
    },
    middle: [
      {
        role: `holding the product up at chest height with both hands, front label squarely facing camera and fully readable, tilting it slightly so the label catches the light`,
        camera: `static tripod, unchanged framing from the previous shot`,
      },
      {
        role: `holding up a DIFFERENT variant of the same product, same framing and same table, so the two read as a set rather than two videos`,
        camera: `static tripod, identical framing`,
      },
      {
        role: `pouring or emptying the product out into a bowl or container, the amount visibly generous, a satisfying cascade`,
        camera: `static tripod, no movement`,
      },
    ],
    closing: {
      role: `the product in its natural situation of use at the same table — reaching for it casually while doing something else, relaxed`,
      camera: `static tripod, unchanged framing`,
    },
  },

  // T06 — katalog berjalan. Tiap varian dapat jatah waktu, label, dan
  // perlakuan yang SAMA; keseragaman itu yang bikin katalognya kebaca.
  "t06-swatch-shade": {
    opening: {
      role: `centred in frame with several units of the same product arranged around them like rays, every label facing camera, holding still — a title card made of real objects`,
      camera: `static selfie, almost no movement`,
    },
    middle: [
      {
        role: `applying or demonstrating ONE variant, then showing the result clearly and holding it long enough to be judged`,
        camera: `static close selfie, no movement`,
      },
      {
        role: `the SAME action with the next variant, identical framing, identical distance, identical light — the sameness is what makes the catalogue readable`,
        camera: `static close selfie, framing unchanged from the previous shot`,
      },
    ],
    closing: {
      role: `holding all the variants together at chest height and fanning them slightly apart so each label becomes separately visible`,
      camera: `static selfie, natural micro-shake`,
    },
  },

  // T07 — klaim ter-centang saat diperagakan. Dokumennya: centang muncul 0,4
  // detik SETELAH gerakan tangan menyentuh kulit, supaya terasa akibat.
  "t07-checklist-berjalan": {
    opening: {
      role: `holding the product and talking to camera, naming the problem the viewer already has before naming the product`,
      camera: `static selfie, natural micro-shake`,
    },
    middle: [
      {
        role: `applying the product with small precise movements, the action clearly visible and unhurried`,
        camera: `static close selfie, slight drift`,
      },
      {
        role: `working the product in with both hands in gentle rhythmic presses, eyes closed, a calm satisfied expression — this is the moment a claim gets earned`,
        camera: `static close selfie, no movement`,
      },
      {
        role: `extreme close-up of the treated surface filling the frame, fingertips sweeping across it, the texture and the change clearly visible`,
        camera: `very close handheld, slight drift and refocus`,
      },
    ],
  },

  // T09 — menjual formula. Kamera praktis tidak pernah pindah (3 potongan
  // dalam 23 detik); yang menahan perhatian adalah caption dan ekspresi.
  "t09-bahan-aktif": {
    opening: {
      role: `holding the product beside their chin with the label facing camera, eyes wide and expressive, asking the viewer something that sounds almost too good to be true`,
      camera: `static selfie at arm's length, natural micro-shake`,
    },
    middle: [
      {
        role: `lifting the applicator out of the product and tilting it so the contents catch the light, watching it — slow enough that the viewer has time to take in what it looks like`,
        camera: `static selfie, minimal movement`,
      },
      {
        role: `dispensing the product onto the back of the other hand and spreading it with a fingertip, the product bottle standing in the lower foreground with the label facing camera the whole time`,
        camera: `static selfie with a slight downward tilt`,
      },
    ],
    closing: {
      role: `back to the exact opening framing and pose, product beside the face, a confident nod and a warm smile`,
      camera: `static selfie, matching the opening framing exactly`,
    },
  },

  // T11 — 25% durasi dihabiskan untuk misterinya. Kalau kemasan kelihatan di
  // shot pertama, seluruh templatenya bubar.
  "t11-hook-misteri": {
    opening: {
      role: `extreme macro of an open palm filling the entire frame holding an unidentifiable amount of the product, its surface catching a bright highlight, tilting very slowly — NO packaging anywhere in frame and no sense of scale, the viewer must not be able to tell what this is`,
      camera: `static extreme macro, tiny drift, no zoom out`,
    },
    middle: [
      {
        role: `the reveal: a hand tipping the actual product container over the palm, label facing camera and readable, the contents landing — the answer arrives all at once`,
        camera: `static macro looking down, slight refocus`,
      },
      {
        role: `the product being used quickly and normally, hands moving with natural motion blur`,
        camera: `static close selfie, no movement`,
      },
    ],
    closing: {
      role: `the result, holding the product beside the shoulder with the label facing camera and a satisfied smile`,
      camera: `static selfie, natural micro-shake`,
    },
  },
  // Story Ads memakai properti panggung yang terlihat jelas sebagai staging.
  // Role hanya boleh mengatur komposisi kartu/label/nama/kategori/harga yang
  // disetujui. Outcome produk, hasil layanan, kelangkaan, dan daya tahan tidak
  // boleh lahir dari tabel visual ketika input hanya memberi identitas dasar.
  "ads-tembus-dinding": {
    opening: {
      role: `a clearly theatrical cardboard wall panel on a tabletop stage shifts sideways while lightweight white foam pieces fall in front of it; a printed identity card is already visible beside the panel`,
      camera: `static wide, locked off so the cardboard panel and identity card read clearly`,
    },
    middle: [
      { role: `a hand slides the printed identity card through the opening in the cardboard panel, with only the product name or category readable`,
        camera: `slight handheld push toward the card and cardboard texture` },
      { role: `the label or service card is held beside the foam panel as a plain identity display`,
        camera: `steady close-up on the readable card` },
    ],
    closing: {
      role: `one continuous shot of the readable identity card under a small lamp, with the cardboard panel and foam props still visibly theatrical behind it`,
      camera: `single continuous take, no cuts` },
  },
  "ads-atap-jebol": {
    opening: {
      role: `a paper ceiling panel on a small indoor stage slides open and white confetti descends on strings; a printed product or service card hangs below it`,
      camera: `low angle looking up, locked off so the paper panel and hanging card stay readable` },
    middle: [
      { role: `a hand lowers the identity card through the paper opening while the confetti continues to fall as an obvious stage effect`,
        camera: `handheld at card level, gently following downward` },
    ],
    closing: {
      role: `one continuous shot of the card or label facing camera beneath the paper panel, showing only its printed identity`,
      camera: `single continuous take, steady` },
  },
  "ads-dobrak-pintu": {
    opening: {
      role: `a lightweight freestanding stage-door panel is tapped from behind, then its handle turns and a printed identity card slides into view through the opening`,
      camera: `static frame facing the stage-door panel, locked off` },
    middle: [
      { role: `a uniformed stage attendant lifts the card near the open panel so the printed name or category faces camera`,
        camera: `static, with the card moving toward the lens` },
    ],
    closing: {
      role: `one continuous shot of the readable card resting beside the stage-door panel as a plain identity display`,
      camera: `single continuous take, no cuts` },
  },
  "ads-waktu-berhenti": {
    opening: {
      role: `actors on a small market-style stage deliberately hold still poses beside a stopped prop clock, while a printed identity card remains visible on the counter`,
      camera: `slow steady drift through the clearly staged tableau` },
    middle: [
      { role: `the cashier lifts a printed card while every actor continues holding the rehearsed pose; the card shows only a name, category, or approved price`,
        camera: `continuing the same drift, arriving on the readable card` },
    ],
    closing: {
      role: `one continuous shot of the prop clock, posed actors, and readable card together as a theatrical tableau`,
      camera: `single continuous take, locked off on the card` },
  },

  // DUA ADS PENJELAS. Bentuknya kebalikan dari empat di atas: tidak ada
  // interupsi sama sekali, dan produk/bisnis justru harus jelas SEJAK AWAL.
  // Yang dijual kejelasan, bukan kejutan.
  "kenalin-bisnis": {
    opening: {
      role: `a person opens a folded information card at a plain desk; the business name and category are printed clearly against blank paper props`,
      camera: `static at eye level, no movement` },
    middle: [
      { role: `hands point to the printed business name and category on the card, then place it in front of an off-camera witness`,
        camera: `handheld following the card` },
      { role: `the same identity card is turned toward camera beside a blank note page as a plain identity display`,
        camera: `static medium close-up` },
    ],
    closing: {
      role: `one continuous shot of the printed business identity card facing camera on the desk`,
      camera: `single continuous take, static` },
  },
  "promo-terbatas": {
    opening: {
      role: `a price card is opened beside the product or service identity card, showing the approved price supplied in the brief`,
      camera: `static close, both cards already in frame` },
    middle: [
      { role: `a hand points once to the approved number on the price card and once to the printed product name`,
        camera: `close handheld on the two cards` },
      { role: `the price card is turned toward a cashier witness while the identity card stays readable beside it`,
        camera: `static, cards centred` },
    ],
    closing: {
      role: `one continuous shot of the approved price and identity cards together on the same plain counter`,
      camera: `single continuous take, no cuts` },
  },

  // --- TIGA UGC ADS PRODUKSI SENDIRI (Brian, 13 Agustus 2026) ---
  //
  // DITAMBAHKAN SETELAH RENDER BUKTI GAGAL. Ketiga template ini sempat tayang
  // tanpa tabel di sini, dan hasilnya ketiganya keluar SAMA PERSIS: presenter
  // memegang produk sambil bicara. "Meja Kosong" tanpa meja kosong,
  // "Unboxing dari Dalam Kardus" tanpa kardus sama sekali. Menambah template
  // tanpa menambah strukturnya = menambah label, bukan menambah video.
  "ads-unboxing-pov": {
    opening: {
      role: `POV from inside a lightweight cardboard prop box looking up as the flaps open and a printed package label enters the light; the staging shows only the package identity`,
      camera: `static from inside the box looking straight up, the flaps opening into frame`,
    },
    middle: [
      {
        role: `a hand lifts the package identity card out of the prop box and turns the printed name toward camera`,
        camera: `handheld, following the card up out of the box`,
      },
      {
        role: `the product or service card rests beside the opened cardboard box while a hand points to its printed category`,
        camera: `static medium close-up, hand moving within frame`,
      },
    ],
    closing: {
      role: `one continuous unbroken shot of the open prop box and readable identity card together`,
      camera: `single continuous take, slow gentle handheld, no cuts`,
    },
  },

  "ads-meja-kosong": {
    opening: {
      role: `a plain desk holds three printed information cards, a small lamp, and a pen; a hand opens the centre card so its identity line faces camera`,
      camera: `locked-off wide on the desk so every staged prop remains visible`,
    },
    middle: [
      {
        role: `the centre card moves closer to an off-camera witness while the other two cards remain stationary`,
        camera: `very slow push toward the printed card`,
      },
      {
        role: `a hand points to the printed name or category on the card beside a blank sheet of paper`,
        camera: `static close on the card`,
      },
    ],
    closing: {
      role: `one continuous shot of the same three staged cards, with the centre identity line readable`,
      camera: `single continuous take, locked off, holds to the end`,
    },
  },

  "ads-panas-ekstrem": {
    opening: {
      role: `a clearly staged red lamp, paper fan, misted prop glass, and thin theatrical haze surround a printed identity card already visible on the table`,
      camera: `handheld at table height, gently moving among the staged props`,
    },
    middle: [
      {
        role: `a hand lifts the paper fan and turns its printed product or service name toward the lens as a static identity display`,
        camera: `card and fan move toward the lens, then settle`,
      },
      {
        role: `the printed label is held beside the red lamp and prop glass while the theatrical conditions remain unchanged`,
        camera: `static, holding on the label and props`,
      },
    ],
    closing: {
      role: `one continuous shot of the readable identity card among the same red-light props and theatrical haze`,
      camera: `single continuous take, steady handheld, no cuts`,
    },
  },
};

/** null = template ini memang tidak punya tabel peran (lihat catatan di atas). */
export function ugcRolesFor(templateId: string | null | undefined): UgcTemplateRoles | null {
  if (!templateId) return null;
  return UGC_TEMPLATE_ROLES[templateId] ?? null;
}
