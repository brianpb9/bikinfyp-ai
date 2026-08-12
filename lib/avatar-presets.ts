// PUSTAKA AVATAR HDRV (2026-08-13) — 19 influencer produksi sendiri.
//
// MENGGANTIKAN 11 avatar generik sebelumnya (Salma, Zea, Bunda Ratih, dst).
// Brian: "avatar sebelumnya kita buang". Yang lama tidak punya identitas —
// cuma potret generik dengan label kategori. Yang ini punya nama, umur,
// niche, aura, dan lemari pakaian tetap, jadi brand memilih ORANG, bukan tipe.
//
// DUA HAL YANG DIPISAH, dan ini inti rancangannya:
//
//   id     = identitas influencer (dipakai UI + deskripsi wajah)
//   voice  = kategori kreator lama di lib/personas.ts (suara + register +
//            gaya pembawaan)
//
// Dipisah karena suara dan wajah datang dari mesin yang berbeda. Kategori
// kreator lama membawa voice TTS, register bahasa ("bunda/bestie/genz"), dan
// delivery prompt yang sudah teruji di produksi — membuangnya berarti menulis
// ulang seluruh mesin suara demi mengganti foto. Dua influencer boleh berbagi
// suara; wajah mereka tetap berbeda karena `desc` berbeda.
//
// BATAS YANG HARUS DIKATAKAN APA ADANYA: kit influencer ini dibangun di
// sekitar penguncian identitas lewat GAMBAR — `01-passport-photo.png` disebut
// "facial-identity authority" di tiap master prompt. Pipeline kita TIDAK BISA
// memakainya: BytePlus menolak foto wajah asli sebagai referensi, terbukti
// 2026-08-12 ("input image may contain real person"). Jadi yang sampai ke
// model hanya `desc` di bawah — teks. Hasilnya SEJIWA dengan influencernya,
// bukan wajah yang identik. Foto di sini dipakai untuk PEMILIH, supaya brand
// tahu siapa yang mereka pilih, bukan sebagai referensi render.
export type AvatarGender = "female" | "male";

export interface AvatarPreset {
  /** Identitas influencer — bukan kategori kreator. */
  id: string;
  name: string;
  /** Niche-nya, satu baris. Dipakai brand memilih. */
  note: string;
  /** Potret untuk pemilih. BUKAN referensi render — lihat catatan di atas. */
  img: string;
  gender: AvatarGender;
  /** Kategori kreator (lib/personas.ts) yang dipinjam suaranya. WAJIB id yang
   *  benar-benar ada dan aktif — divalidasi backend saat job dibuat. */
  voice: string;
  /** Deskripsi fisik yang dikirim ke perencana shot sebagai avatar_custom_desc.
   *  Disusun dari umur + aura + lemari pakaian di master prompt HDRV. */
  desc: string;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "bianca-limanto", name: "Bianca Limanto", note: "music, fashion, and nocturnal editorial cult", img: "/avatars/hdrv/bianca-limanto.jpg", gender: "female", voice: "chindo",
    desc: "29-year-old Indonesian woman, cool, confident, fashion-forward, wearing sharp black cropped blazer, burgundy fitted top, charcoal wide-leg trousers, polished black boots, silver jewelry" },
  { id: "celine-wibowo", name: "Celine Wibowo", note: "mature styling, wardrobe advice, and confide", img: "/avatars/hdrv/celine-wibowo.jpg", gender: "female", voice: "ibu",
    desc: "44-year-old Indonesian woman, joyful, confident, stylish, wearing cropped denim jacket, black silk camisole, scarlet wide-leg tailored trousers, black pointed heels" },
  { id: "cinta-mahadewi", name: "Cinta Mahadewi", note: "fitness, dance, and vibrant feminine wellnes", img: "/avatars/hdrv/cinta-mahadewi.jpg", gender: "female", voice: "genz",
    desc: "young adult Indonesian woman, vibrant, sensual but tasteful, energetic, wearing coral cropped windbreaker, matching sports bra and leggings, white training shoes, pink headphones" },
  { id: "clarissa-limanto", name: "Clarissa Limanto", note: "tennis, fitness, and aspirational mature wel", img: "/avatars/hdrv/clarissa-limanto.jpg", gender: "female", voice: "ibu",
    desc: "41-year-old Indonesian woman, healthy, aspirational, energetic, wearing coral technical tennis jacket, ivory sports bra, pale sage high-waist leggings, white court trainers" },
  { id: "dr-caroline-ong", name: "Dr Caroline Ong", note: "dermatology, skincare, and evidence-based be", img: "/avatars/hdrv/dr-caroline-ong.jpg", gender: "female", voice: "chindo",
    desc: "28-year-old Indonesian woman, fresh, intelligent, trustworthy, wearing sage tailored blazer, ivory blouse, cream straight trousers, beige professional pumps" },
  { id: "dr-vania-sugianto", name: "Dr Vania Sugianto", note: "aesthetic medicine and premium beauty educat", img: "/avatars/hdrv/dr-vania-sugianto.jpg", gender: "female", voice: "chindo",
    desc: "29-year-old Indonesian woman, credible, elegant, reassuring, wearing espresso medical scrubs, structured cream sleeveless clinic coat, beige closed-toe professional shoes, delicate gold jewelry" },
  { id: "kirana-aulia", name: "Kirana Aulia", note: "beauty, makeup, and relatable feminine lifes", img: "/avatars/hdrv/kirana-aulia.jpg", gender: "female", voice: "genz",
    desc: "young adult Indonesian woman, radiant, friendly, camera-ready, wearing ribbed cherry-red fitted top, high-waist dark indigo jeans, nude slingback shoes, minimal gold hoops" },
  { id: "monica-tan", name: "Monica Tan", note: "art, interiors, luxury culture, and mature s", img: "/avatars/hdrv/monica-tan.jpg", gender: "female", voice: "ibu",
    desc: "48-year-old Indonesian woman, cultivated, commanding, sophisticated, wearing mustard asymmetric draped blouse, deep aubergine tailored trousers, sculptural gold earrings, pointed neutral heels" },
  { id: "natasha-wijaya", name: "Natasha Wijaya", note: "fitness, dance, and energetic wellness", img: "/avatars/hdrv/natasha-wijaya.jpg", gender: "female", voice: "genz",
    desc: "27-year-old Indonesian woman, bright, athletic, charismatic, wearing coral performance set: fitted long-sleeve zip jacket, coordinated high-waist leggings, clean white trainers" },
  { id: "nayla-rahmani", name: "Nayla Rahmani", note: "modest fashion, handbags, and polished lifes", img: "/avatars/hdrv/nayla-rahmani.jpg", gender: "female", voice: "hijaber",
    desc: "young adult Indonesian woman, warm, refined, trustworthy, wearing taupe hijab, chocolate blouse, long ivory tailored vest, wide-leg mocha trousers, nude loafers" },
  { id: "valerie-hartono", name: "Valerie Hartono", note: "styling, thrift fashion, and wardrobe transf", img: "/avatars/hdrv/valerie-hartono.jpg", gender: "female", voice: "genz",
    desc: "25-year-old Indonesian woman, playful, editorial, fashion-smart, wearing cropped light-wash denim jacket, black fitted turtleneck, draped crimson midi skirt, black ankle boots" },
  { id: "arka-pradana", name: "Arka Pradana", note: "sneakers, streetwear, and collectible fashio", img: "/avatars/hdrv/arka-pradana.jpg", gender: "male", voice: "genzpria",
    desc: "young adult Indonesian man, charming, youthful, trend-aware, wearing olive overshirt, textured cream tee, relaxed black trousers, distinctive multicolor premium sneakers, silver rings" },
  { id: "bima-satrya", name: "Bima Satrya", note: "coffee, menswear, and thoughtful everyday li", img: "/avatars/hdrv/bima-satrya.jpg", gender: "male", voice: "lokalpria",
    desc: "young adult Indonesian man, composed, masculine, approachable, wearing espresso knitted polo, black tailored trousers, classic watch, dark brown loafers" },
  { id: "elang-kresna", name: "Elang Kresna", note: "music, craftsmanship, and grounded masculine", img: "/avatars/hdrv/elang-kresna.jpg", gender: "male", voice: "lokalpria",
    desc: "young adult Indonesian man, grounded, soulful, approachable, wearing rust camp-collar shirt, black tailored trousers, brown leather watch, dark loafers" },
  { id: "jason-hartono", name: "Jason Hartono", note: "coffee, photography, and quiet urban lifesty", img: "/avatars/hdrv/jason-hartono.jpg", gender: "male", voice: "pria",
    desc: "26-year-old Indonesian man, calm, artistic, quietly attractive, wearing dark chocolate knitted polo, charcoal pleated trousers, brown leather watch, minimalist loafers" },
  { id: "jovan-mahesa", name: "Jovan Mahesa", note: "surf, fitness, and tropical travel", img: "/avatars/hdrv/jovan-mahesa.jpg", gender: "male", voice: "genzpria",
    desc: "young adult Indonesian man, strong, joyful, outdoorsy, wearing sage sleeveless top, sand linen drawstring trousers, rugged neutral sandals, beaded bracelet" },
  { id: "kenzo-halim", name: "Kenzo Halim", note: "music, fashion, and nightlife culture", img: "/avatars/hdrv/kenzo-halim.jpg", gender: "male", voice: "pria",
    desc: "28-year-old Indonesian man, magnetic, stylish, slightly mysterious, wearing black fluid satin shirt, tailored burgundy trousers, black leather boots, restrained silver jewelry" },
  { id: "nico-tan", name: "Nico Tan", note: "technology, gaming, and creator gadgets", img: "/avatars/hdrv/nico-tan.jpg", gender: "male", voice: "genzpria",
    desc: "22-year-old Indonesian man, youthful, clever, energetic, wearing cobalt utility overshirt, white ribbed tank, black tapered cargo trousers, modern white sneakers, slim silver chain" },
  { id: "reza-tanujaya", name: "Reza Tanujaya", note: "fitness, travel, and tropical active lifesty", img: "/avatars/hdrv/reza-tanujaya.jpg", gender: "male", voice: "pria",
    desc: "29-year-old Indonesian man, sunny, athletic, adventurous, wearing sage sleeveless performance top, cream drawstring athletic trousers, technical trainers, black sports watch" },
];

/** Preset berdasarkan id, atau null. */
export function getAvatarPreset(id: string | null | undefined): AvatarPreset | null {
  if (!id) return null;
  return AVATAR_PRESETS.find((a) => a.id === id) ?? null;
}
