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
  // --- ENAM ADS LAMA (tabel ditambahkan 2026-08-13) ---
  //
  // Keenamnya tayang sejak awal TANPA tabel peran, jadi selama ini semuanya
  // jatuh ke beat generik: presenter memegang produk sambil bicara. Nama
  // kartunya menjanjikan atap runtuh, pintu didobrak, waktu berhenti — dan
  // tidak satu pun pernah terjadi di videonya. Ini gap yang sama persis yang
  // ditemukan pada tiga ads baru lewat render, cuma di template yang lebih
  // lama dan karena itu lebih lama diam.
  //
  // EMPAT PATTERN-INTERRUPT punya bentuk yang sama: interupsi dulu, produk
  // BELAKANGAN. Yang membedakan hanya ARAH interupsinya — dari belakang, dari
  // atas, dari depan, atau waktu yang membeku. Perbedaan arah itulah yang
  // harus ditulis; kalau tidak, keempatnya keluar sama seperti sekarang.
  "ads-tembus-dinding": {
    opening: {
      role: `an ordinary quiet room with a person going about something mundane in the foreground, then WITHOUT WARNING something massive breaks through the wall directly behind them — debris and dust bursting forward. The product is NOT visible yet`,
      camera: `static wide, locked off so the breach reads clearly`,
    },
    middle: [
      { role: `the aftermath in the same room: dust settling, the person turning to look, still processing what just happened`,
        camera: `slight handheld push in toward their reaction` },
      { role: `the product finally raised into frame, calm and undamaged, the chaos still visible behind it`,
        camera: `steady close-up on the product with the wreckage soft behind` },
    ],
    closing: {
      role: `one continuous shot: product held to camera, the closing line spoken, the broken wall still in frame as proof this really happened`,
      camera: `single continuous take, no cuts` },
  },
  "ads-atap-jebol": {
    opening: {
      role: `a calm interior seen from below, then the CEILING gives way and someone drops into frame from above in a burst of dust and debris, landing hard. The product is NOT visible yet`,
      camera: `low angle looking up, locked off, so the fall enters from the top of frame` },
    middle: [
      { role: `the person picking themselves up amid fallen ceiling pieces, dazed but unhurt, the room now wrecked around them`,
        camera: `handheld at their level, slightly unsteady` },
    ],
    closing: {
      role: `one continuous shot: they hold the product up to camera, completely composed now, ceiling debris still on the floor`,
      camera: `single continuous take, steady` },
  },
  "ads-dobrak-pintu": {
    opening: {
      role: `an empty quiet room, nothing happening at all, held just long enough to feel still — then the door is KICKED OPEN and someone charges straight toward the camera. The product is NOT visible yet`,
      camera: `static frame facing the closed door, locked off` },
    middle: [
      { role: `they arrive right at the lens, out of breath, and hold the product up close so it fills the frame — the first time it is seen at all`,
        camera: `static, the person and product coming to the camera rather than the camera moving` },
    ],
    closing: {
      role: `one continuous shot: product in hand, closing line spoken directly to camera, the open door still visible behind`,
      camera: `single continuous take, no cuts` },
  },
  "ads-waktu-berhenti": {
    opening: {
      role: `a busy everyday Indonesian scene full of motion — market stalls, steam rising, people walking — then EVERYTHING freezes mid-motion at once, steam suspended in the air, people mid-step. The product is NOT visible yet`,
      camera: `slow steady drift through the frozen scene` },
    middle: [
      { role: `the camera keeps moving through the frozen world and finds the product — the ONLY thing still moving in the entire frame`,
        camera: `continuing the same drift, arriving on the product` },
    ],
    closing: {
      role: `one continuous shot: the world snaps back into motion around the product while it stays perfectly steady, closing line spoken`,
      camera: `single continuous take, locked off on the product` },
  },

  // DUA ADS PENJELAS. Bentuknya kebalikan dari empat di atas: tidak ada
  // interupsi sama sekali, dan produk/bisnis justru harus jelas SEJAK AWAL.
  // Yang dijual kejelasan, bukan kejutan.
  "kenalin-bisnis": {
    opening: {
      role: `the person introducing themselves and the business straight to camera, standing where the business actually happens — a shop counter, a workshop, a desk — not a blank studio`,
      camera: `static at eye level, no movement` },
    middle: [
      { role: `showing what the business actually does, in the real place, with real hands doing the real work`,
        camera: `handheld following the work` },
      { role: `who it is for and what changes for them, spoken plainly with the workplace still visible behind`,
        camera: `static medium shot` },
    ],
    closing: {
      role: `one continuous shot: a plain, unhurried invitation to get in touch, spoken directly to camera`,
      camera: `single continuous take, static` },
  },
  "promo-terbatas": {
    opening: {
      role: `straight to the offer with no preamble at all — the product held up and the deadline stated in the first breath`,
      camera: `static close, product already in frame` },
    middle: [
      { role: `the reason the offer is worth taking, shown rather than claimed: the product being used or opened`,
        camera: `close handheld on the product in use` },
      { role: `the offer restated with the product clearly readable, urgency in delivery rather than in graphics`,
        camera: `static, product centred` },
    ],
    closing: {
      role: `one continuous shot: the deadline repeated once and a direct instruction to act, product still in hand`,
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
      // Aturan #5 dokumen Brian: MASALAH DULU, BARU PRODUK. Di sini
      // "masalahnya" adalah rasa penasaran — kardus yang belum dibuka.
      role: `POV from INSIDE a closed cardboard box looking up: the flaps are pulled open from above and a face appears in the opening, lit by the light flooding in, reacting with genuine surprise — the product is NOT visible yet`,
      camera: `static from inside the box looking straight up, the flaps opening into frame`,
    },
    middle: [
      {
        role: `the product lifted out of the box for the first time and held up to camera, packaging still visible around it, the first proper look at what it actually is`,
        camera: `handheld, following the product up out of the box`,
      },
      {
        role: `the product now in use or worn, the box discarded in the background — the moment it stops being a parcel and becomes something owned`,
        camera: `static medium shot, presenter moving within the frame`,
      },
    ],
    closing: {
      // Aturan #4: penutup SATU SHOT MENERUS, tidak bolak-balik antar scene.
      role: `one continuous unbroken shot: wearing or holding the product, turning once to show it, speaking the closing line straight to camera — no cuts inside this shot`,
      camera: `single continuous take, slow gentle handheld, no cuts`,
    },
  },

  "ads-meja-kosong": {
    opening: {
      // Format anti-produksi: yang diperlihatkan BUKAN produknya, tapi
      // hilangnya pekerjaan. Karena itu tidak ada produk sama sekali di sini.
      role: `a working desk crowded with production gear — camera, tripod, lights, notebooks, cables — then the objects begin vanishing one by one, fastest at the start`,
      camera: `locked-off wide on the desk, no movement at all so the disappearances read clearly`,
    },
    middle: [
      {
        role: `the desk now almost empty, only a laptop left, the room noticeably quieter and cleaner than it was`,
        camera: `very slow push in toward the laptop`,
      },
      {
        role: `a screen showing work finishing by itself — a progress bar completing, a result appearing — no hands touching anything`,
        camera: `static close on the screen`,
      },
    ],
    closing: {
      role: `one continuous shot of the empty tidy desk with the finished result on screen, calm and resolved — the point is what is NO LONGER there`,
      camera: `single continuous take, locked off, holds to the end`,
    },
  },

  "ads-panas-ekstrem": {
    opening: {
      // Aturan #5 lagi, dan ini paling keras: kalau produk sudah aktif sejak
      // frame pertama, tidak ada yang diselesaikan dan hook-nya mati.
      role: `the everyday problem pushed to an absurd extreme, and the person visibly SUFFERING from it — uncomfortable, exasperated, on the edge of giving up. The product must NOT be visible or in use yet`,
      camera: `handheld selfie at arm's length, slightly unsteady from the discomfort`,
    },
    middle: [
      {
        role: `the product finally raised into frame and switched on, held close to camera so what it does is unmistakable — the first moment of relief`,
        camera: `product pushed toward the lens, then settling`,
      },
      {
        role: `the same person, same place, same absurd conditions — but now visibly fine, the contrast doing all the work without a single claim being spoken`,
        camera: `static, holding on the changed reaction`,
      },
    ],
    closing: {
      role: `one continuous shot: still in the extreme setting, product in hand and working, speaking the closing line straight to camera with a small satisfied smile`,
      camera: `single continuous take, steady handheld, no cuts`,
    },
  },
};

/** null = template ini memang tidak punya tabel peran (lihat catatan di atas). */
export function ugcRolesFor(templateId: string | null | undefined): UgcTemplateRoles | null {
  if (!templateId) return null;
  return UGC_TEMPLATE_ROLES[templateId] ?? null;
}
