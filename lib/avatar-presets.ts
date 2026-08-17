// HDRV influencer roster — the only avatar-picker source for promo, retail,
// campaign, and matrix. The legacy generic category portraits remain voice
// presets in personas.ts, but are not selectable identities anymore.

export type AvatarGender = "female" | "male";
export type AvatarRegister = "bunda" | "bestie" | "genz" | "netral";

export interface AvatarPreset {
  id: string;
  name: string;
  note: string;
  img: string;
  gender: AvatarGender;
  register: AvatarRegister;
  /** Existing TTS/persona category. Identity and voice deliberately stay separate. */
  voice: string;
  /** CAST-LOCK grounded in the passport + full-body reference images. */
  castLock: string;
  /** Backward-compatible alias consumed by the existing render pipeline. */
  desc: string;
  /** Complete reference pack copied from the HDRV source folder. */
  referenceImages: readonly [string, string, string, string];
}

type AvatarDefinition = Omit<AvatarPreset, "desc" | "referenceImages">;

const references = (id: string): AvatarPreset["referenceImages"] => [
  `/avatars/hdrv/${id}/01-passport-photo.png`,
  `/avatars/hdrv/${id}/02-full-body-360-reference.png`,
  `/avatars/hdrv/${id}/03-face-360-reference.png`,
  `/avatars/hdrv/${id}/04-five-emotions-reference.png`,
];

const defineAvatar = (avatar: AvatarDefinition): AvatarPreset => ({
  ...avatar,
  desc: avatar.castLock,
  referenceImages: references(avatar.id),
});

export const AVATAR_PRESETS: AvatarPreset[] = [
  defineAvatar({
    id: "arka-pradana", name: "Arka Pradana", note: "Sneakers, streetwear, collectible fashion",
    img: "/avatars/hdrv/arka-pradana/01-passport-photo.png", gender: "male", register: "genz", voice: "genzpria",
    castLock: "CAST-LOCK: Arka Pradana, young adult Indonesian man with medium warm-brown skin, a slim oval face, dark almond eyes, a broad natural smile, clean-shaven face, and thick wavy black hair parted at the center. Lean build. Fixed wardrobe: olive overshirt over a textured cream T-shirt, relaxed black trousers, multicolor premium sneakers, and silver rings.",
  }),
  defineAvatar({
    id: "bianca-limanto", name: "Bianca Limanto", note: "Music, fashion, nocturnal editorial culture",
    img: "/avatars/hdrv/bianca-limanto/01-passport-photo.png", gender: "female", register: "bestie", voice: "chindo",
    castLock: "CAST-LOCK: Bianca Limanto, 29-year-old Indonesian woman with medium tan skin, an oval face, defined cheekbones, dark almond eyes, and shoulder-length softly waved black hair. Slim build with a cool, confident expression. Fixed wardrobe: sharp black cropped blazer, burgundy fitted top, charcoal wide-leg trousers, polished black boots, and silver jewelry.",
  }),
  defineAvatar({
    id: "bima-satrya", name: "Bima Satrya", note: "Coffee, menswear, thoughtful everyday lifestyle",
    img: "/avatars/hdrv/bima-satrya/01-passport-photo.png", gender: "male", register: "netral", voice: "lokalpria",
    castLock: "CAST-LOCK: Bima Satrya, young adult Indonesian man with medium tan skin, a long oval face, dark almond eyes, a straight nose, clean-shaven jaw, and medium-length black hair parted loosely at the center. Lean build and composed expression. Fixed wardrobe: espresso knitted polo, black tailored trousers, classic watch, and dark brown loafers.",
  }),
  defineAvatar({
    id: "celine-wibowo", name: "Celine Wibowo", note: "Mature styling, wardrobe advice, confident fashion",
    img: "/avatars/hdrv/celine-wibowo/01-passport-photo.png", gender: "female", register: "bunda", voice: "ibu",
    castLock: "CAST-LOCK: Celine Wibowo, 44-year-old Indonesian woman with light-medium warm skin, a softly angular oval face, warm dark eyes, and a chin-length black bob with a visible silver streak. Medium-lean build and joyful smile. Fixed wardrobe: cropped light-denim jacket, black silk camisole, scarlet wide-leg tailored trousers, and black pointed heels.",
  }),
  defineAvatar({
    id: "cinta-mahadewi", name: "Cinta Mahadewi", note: "Fitness, dance, vibrant feminine wellness",
    img: "/avatars/hdrv/cinta-mahadewi/01-passport-photo.png", gender: "female", register: "genz", voice: "genz",
    castLock: "CAST-LOCK: Cinta Mahadewi, young adult Indonesian woman with medium-deep warm-brown skin, an oval face, large dark almond eyes, full lips, and shoulder-length softly waved black hair. Athletic curvy build and energetic expression. Fixed wardrobe: coral cropped windbreaker, matching coral sports bra and leggings, white training shoes, and pink headphones.",
  }),
  defineAvatar({
    id: "clarissa-limanto", name: "Clarissa Limanto", note: "Tennis, fitness, aspirational mature wellness",
    img: "/avatars/hdrv/clarissa-limanto/01-passport-photo.png", gender: "female", register: "bunda", voice: "ibu",
    castLock: "CAST-LOCK: Clarissa Limanto, 41-year-old Indonesian woman with medium warm-tan skin, a long oval face, dark eyes, and shoulder-length softly waved dark hair with subtle warm highlights. Lean athletic build and healthy confident expression. Fixed wardrobe: coral technical tennis jacket, ivory sports bra, pale-sage high-waist leggings, and white court trainers.",
  }),
  defineAvatar({
    id: "dr-caroline-ong", name: "Dr Caroline Ong", note: "Dermatology, skincare, evidence-based beauty",
    img: "/avatars/hdrv/dr-caroline-ong/01-passport-photo.png", gender: "female", register: "netral", voice: "chindo",
    castLock: "CAST-LOCK: Dr Caroline Ong, 28-year-old Indonesian woman with light-medium warm skin, a balanced oval face, dark almond eyes, and straight shoulder-length black hair with a side part. Medium-slim build and calm trustworthy expression. Fixed wardrobe: sage tailored blazer, ivory blouse, cream straight trousers, and beige professional pumps.",
  }),
  defineAvatar({
    id: "dr-vania-sugianto", name: "Dr Vania Sugianto", note: "Aesthetic medicine, premium beauty education",
    img: "/avatars/hdrv/dr-vania-sugianto/01-passport-photo.png", gender: "female", register: "netral", voice: "chindo",
    castLock: "CAST-LOCK: Dr Vania Sugianto, 29-year-old Indonesian woman with light-medium warm skin, a softly oval face, dark almond eyes, and straight black hair center-parted into a neat low bun. Slim build and poised reassuring expression. Fixed wardrobe: espresso medical scrubs under a structured cream sleeveless clinic coat, beige closed-toe professional shoes, and delicate gold jewelry.",
  }),
  defineAvatar({
    id: "elang-kresna", name: "Elang Kresna", note: "Music, craftsmanship, grounded masculine lifestyle",
    img: "/avatars/hdrv/elang-kresna/01-passport-photo.png", gender: "male", register: "netral", voice: "lokalpria",
    castLock: "CAST-LOCK: Elang Kresna, young adult Indonesian man with deep warm-tan skin, a long angular face, dark eyes, a neat moustache and short goatee, and close-cropped black hair. Lean athletic build and grounded expression. Fixed wardrobe: rust camp-collar shirt, black tailored trousers, brown leather watch, and dark loafers.",
  }),
  defineAvatar({
    id: "jason-hartono", name: "Jason Hartono", note: "Coffee, photography, quiet urban lifestyle",
    img: "/avatars/hdrv/jason-hartono/01-passport-photo.png", gender: "male", register: "netral", voice: "pria",
    castLock: "CAST-LOCK: Jason Hartono, 26-year-old Indonesian man with light-medium warm skin, a soft oval face, dark almond eyes, a clean-shaven jaw, and thick wavy black hair parted at the center. Slim build and calm artistic expression. Fixed wardrobe: dark chocolate knitted polo, charcoal pleated trousers, brown leather watch, and minimalist loafers.",
  }),
  defineAvatar({
    id: "jovan-mahesa", name: "Jovan Mahesa", note: "Surf, fitness, tropical travel",
    img: "/avatars/hdrv/jovan-mahesa/01-passport-photo.png", gender: "male", register: "genz", voice: "genzpria",
    castLock: "CAST-LOCK: Jovan Mahesa, young adult Indonesian man with deep warm-brown skin, a long angular face, dark eyes, short tight black curls, and a clean-shaven face. Tall athletic muscular build and joyful outdoorsy expression. Fixed wardrobe: sage sleeveless top, sand linen drawstring trousers, rugged neutral sandals, and a beaded bracelet.",
  }),
  defineAvatar({
    id: "kenzo-halim", name: "Kenzo Halim", note: "Music, fashion, nightlife culture",
    img: "/avatars/hdrv/kenzo-halim/01-passport-photo.png", gender: "male", register: "bestie", voice: "pria",
    castLock: "CAST-LOCK: Kenzo Halim, 28-year-old Indonesian man with medium tan skin, an angular oval face, narrow dark eyes, a clean-shaven jaw, and long layered black hair swept away from the face. Lean build and magnetic reserved expression. Fixed wardrobe: black fluid satin shirt, tailored burgundy trousers, black leather boots, and restrained silver jewelry.",
  }),
  defineAvatar({
    id: "kirana-aulia", name: "Kirana Aulia", note: "Beauty, makeup, relatable feminine lifestyle",
    img: "/avatars/hdrv/kirana-aulia/01-passport-photo.png", gender: "female", register: "genz", voice: "genz",
    castLock: "CAST-LOCK: Kirana Aulia, young adult Indonesian woman with medium warm-tan skin, a heart-shaped oval face, dark almond eyes, full lips, and long softly waved black hair. Slim build and radiant friendly expression. Fixed wardrobe: ribbed cherry-red fitted top, high-waist dark-indigo jeans, nude slingback shoes, and minimal gold hoops.",
  }),
  defineAvatar({
    id: "monica-tan", name: "Monica Tan", note: "Art, interiors, luxury culture, mature style",
    img: "/avatars/hdrv/monica-tan/01-passport-photo.png", gender: "female", register: "bunda", voice: "ibu",
    castLock: "CAST-LOCK: Monica Tan, 48-year-old Indonesian woman with light-medium warm skin, a mature oval face, dark almond eyes, and a sleek chin-length black bob with prominent silver streaks. Medium-lean build and cultivated commanding expression. Fixed wardrobe: mustard asymmetric one-shoulder blouse, deep-aubergine tailored trousers, sculptural gold earrings, and pointed neutral heels.",
  }),
  defineAvatar({
    id: "natasha-wijaya", name: "Natasha Wijaya", note: "Fitness, dance, energetic wellness",
    img: "/avatars/hdrv/natasha-wijaya/01-passport-photo.png", gender: "female", register: "bestie", voice: "genz",
    castLock: "CAST-LOCK: Natasha Wijaya, 27-year-old Indonesian woman with light-medium warm skin, a heart-shaped face, dark almond eyes, and long black hair tied in a high ponytail. Athletic build and bright charismatic expression. Fixed wardrobe: coral fitted long-sleeve zip performance jacket, matching high-waist leggings, and clean white trainers.",
  }),
  defineAvatar({
    id: "nayla-rahmani", name: "Nayla Rahmani", note: "Modest fashion, handbags, polished lifestyle",
    img: "/avatars/hdrv/nayla-rahmani/01-passport-photo.png", gender: "female", register: "bestie", voice: "hijaber",
    castLock: "CAST-LOCK: Nayla Rahmani, young adult Indonesian woman with light-medium warm skin, a soft oval face, dark almond eyes, and a taupe hijab fitted neatly around her face and shoulders. Medium-slim build and warm refined expression. Fixed wardrobe: chocolate blouse, long ivory tailored vest, wide-leg mocha trousers, and nude loafers.",
  }),
  defineAvatar({
    id: "nico-tan", name: "Nico Tan", note: "Technology, gaming, creator gadgets",
    img: "/avatars/hdrv/nico-tan/01-passport-photo.png", gender: "male", register: "genz", voice: "genzpria",
    castLock: "CAST-LOCK: Nico Tan, 22-year-old Indonesian man with light-medium warm skin, an angular oval face, dark almond eyes, a clean-shaven jaw, and thick black hair styled upward with a textured front. Slim build and clever energetic expression. Fixed wardrobe: cobalt utility overshirt, white ribbed T-shirt, black tapered cargo trousers, modern white sneakers, and a slim silver chain.",
  }),
  defineAvatar({
    id: "reza-tanujaya", name: "Reza Tanujaya", note: "Fitness, travel, tropical active lifestyle",
    img: "/avatars/hdrv/reza-tanujaya/01-passport-photo.png", gender: "male", register: "bestie", voice: "pria",
    castLock: "CAST-LOCK: Reza Tanujaya, 29-year-old Indonesian man with medium warm-tan skin, a softly square oval face, dark eyes, short neatly cropped black hair, and a clean-shaven jaw. Athletic muscular build and sunny confident expression. Fixed wardrobe: sage sleeveless performance top, cream drawstring athletic trousers, technical trainers, and a black sports watch.",
  }),
  defineAvatar({
    id: "valerie-hartono", name: "Valerie Hartono", note: "Styling, thrift fashion, wardrobe transformation",
    img: "/avatars/hdrv/valerie-hartono/01-passport-photo.png", gender: "female", register: "genz", voice: "genz",
    castLock: "CAST-LOCK: Valerie Hartono, 25-year-old Indonesian woman with light-medium warm skin, an oval face, dark almond eyes, and a straight jaw-length black bob tucked behind one ear. Slim build and playful editorial expression. Fixed wardrobe: cropped light-wash denim jacket over a black fitted turtleneck, draped crimson midi skirt, and black ankle boots.",
  }),
];

export function getAvatarPreset(id: string | null | undefined): AvatarPreset | null {
  if (!id) return null;
  return AVATAR_PRESETS.find((avatar) => avatar.id === id) ?? null;
}
