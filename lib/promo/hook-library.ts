/**
 * Video Promosi — pustaka hook AI, hasil riset 30 ide / 6 gelombang
 * (docs/AI_HOOK_PROMPTS_V1-V6.md + docs/AI_HOOK_MASTER_REPORT.md, dinilai
 * Brian 0-5). HANYA ide yang TIDAK gagal yang masuk sini — 13 ide gagal
 * (7, 9, 11, 12, 14, 16-29) sengaja DIBUANG, bukan lupa dimasukkan:
 * - 7, 9, 11, 12: anatomi manusia jebol (Aturan A/C)
 * - 14, 16-25: terlalu standar, "bukan AI hook", bisa direkam manusia sendiri
 * - 26-29: epik tapi fenomena bukan benda akrab (Aturan I) / produk tidak berperan (Aturan J)
 *
 * Toggle hook (Brian 2026-08-10, direvisi ke 5 level 2026-08-10 — "kemarin
 * kita buat 5 level?") dipetakan dari skor asli (bukan skala baru dikarang):
 * skor 11 hook final jatuh persis di 6 nilai unik (4.0/4.3/4.5-4.6/4.7/4.8),
 * jadi 4.5 & 4.6 digabung satu level supaya jadi 5 level bersih, tiap level
 * 2-3 pilihan asli — bukan dipaksa kosong/tunggal.
 *   Level 1 (4.0): sapuan-dua-dunia, angkot-semua-pegang
 *   Level 2 (4.3): mati-lampu, dunia-ngebut, unboxing-reaksi*
 *   Level 3 (4.5-4.6): shockwave, rakit-sendiri, jatuh-dari-langit
 *   Level 4 (4.7): produk-raksasa, ojol-tembus-tembok
 *   Level 5 (4.8): pasar-beku, krl-ruang-tamu
 *
 * (*) unboxing-reaksi DITAMBAHKAN 2026-08-11 atas permintaan langsung Brian
 * (referensi: utas @mightyking "I generated 20 unboxing UGC clips"). Ide ini
 * TIDAK ikut gelombang penilaian 30-ide di atas — skornya belum pernah
 * dinilai. Ditaruh di level 2 karena Brian menyebut levelnya eksplisit, dan
 * intensitasnya memang cocok: ada beat emosional, tapi tidak melanggar
 * fisika seperti level 4-5. Precedent sama seperti 5 persona pria di
 * lib/personas.ts (testScore null, diaktifkan atas permintaan eksplisit).
 *
 * {{PERSON}} = placeholder diganti deskripsi avatar (preset atau upload
 * sendiri via Gemini vision, lihat lib/promo/avatar.ts) pada ide yang
 * menampilkan orang. Ide product-only (1, 3, 5) tidak punya {{PERSON}} —
 * avatar yang dipilih tidak dipakai untuk ide-ide itu.
 */

export type HookIntensity = 1 | 2 | 3 | 4 | 5;

export interface HookLibraryEntry {
  id: string;
  title: string;
  score: number; // nilai asli Brian, 0-5
  intensity: HookIntensity;
  mode: "i2v" | "r2v";
  hasPerson: boolean;
  durationSec: number;
  prompt: string;
  negative: string;
  reverse?: boolean; // ide 3: generate maju lalu diputar mundur di post
}

export const HOOK_LIBRARY: HookLibraryEntry[] = [
  // --- LEVEL 1 (skor 4.0, paling tenang) ---
  {
    id: "sapuan-dua-dunia",
    title: "Sapuan dua dunia",
    score: 4.0,
    intensity: 1,
    mode: "i2v",
    hasPerson: true,
    durationSec: 8,
    prompt:
      "Locked-off static camera on a tripod, chest-up vertical framing, no camera movement. {{PERSON}} sits at a " +
      "desk in a home room, looking at the camera. Beat 1 (0-1.5s): the whole frame is the \"before\" world: dim " +
      "yellowish light, messy desk covered in clutter, wrinkled shirt, tired slouched posture, dull flat colours. " +
      "Beat 2 (1.5-5.5s): a soft vertical seam of warm light appears at the far left edge of the frame and " +
      "sweeps steadily to the right, like a curtain being drawn across reality. Everything to the LEFT of the " +
      "seam is transformed as it passes: the light becomes bright and clean, the desk becomes tidy, the shirt " +
      "becomes crisp, the person's posture straightens and they smile, colours become rich and warm. Everything " +
      "to the RIGHT of the seam remains the dim messy \"before\" world. The seam moves at a constant even speed " +
      "and stays perfectly vertical. Beat 3 (5.5-7s): the seam reaches the right edge and the entire frame is " +
      "now the bright clean world. They lean slightly toward the camera, smiling. Beat 4 (7-8s): the warm light " +
      "from the seam blooms and floods the whole frame, washing everything out into a soft warm white. FINAL " +
      "FRAME: the entire frame is a clean soft warm white, almost fully blown out, with only the faintest shape visible.",
    negative: "no hard cut, no black frame, no flicker, no strobe, no seam stopping midway",
  },
  {
    id: "angkot-semua-pegang",
    title: "Angkot, semua pegang barang sama",
    score: 4.0,
    intensity: 1,
    mode: "r2v",
    hasPerson: true,
    durationSec: 9,
    prompt:
      "Vertical handheld phone shot from inside a public minivan (angkot) in an Indonesian city, daytime. Worn " +
      "vinyl bench seats facing each other, open windows, street and warung fronts sliding past outside, " +
      "natural sunlight flickering through the windows. Beat 1 (0-2s): the camera is held selfie-style by " +
      "{{PERSON}}, who looks slightly bored, swaying with the vehicle. Ordinary and unremarkable. Beat 2 " +
      "(2-4s): the camera pans slowly to the right along the bench of passengers. The first passenger is " +
      "holding THE PRODUCT from the reference image in their lap, looking at it calmly. Beat 3 (4-6.5s): the " +
      "pan continues. EVERY passenger on the bench is holding the exact same product in the same way, calmly " +
      "and casually, as if it is completely normal. Five or six people, different ages and clothing, all with " +
      "the identical product, matching the reference image exactly in colour, shape and proportion — do not " +
      "redesign it. Nobody reacts. Nobody looks at the camera. Beat 4 (6.5-9s): the camera pans back to the " +
      "original passenger, who slowly looks down at their own empty hands, then lifts their head and stares " +
      "straight into the camera with a deadpan expression. They speak in Indonesian, saying: \"kok cuma aku " +
      "yang belum punya?\" Natural conversational Indonesian, not a newsreader. Do not speak English. FINAL " +
      "FRAME: the passenger looks straight into the camera, deadpan, hands empty and open in their lap, the " +
      "other passengers holding the product soft behind them.",
    negative: "no English speech, no exaggerated comedy faces, no laughing, no different product variants, no crowd staring at camera",
  },
  {
    id: "mati-lampu",
    title: "Mati lampu sekampung, satu jendela menyala",
    score: 4.3,
    intensity: 2,
    mode: "r2v",
    hasPerson: true,
    durationSec: 10,
    prompt:
      "Vertical handheld phone shot with slight natural sway. An Indonesian residential neighbourhood (kampung) " +
      "at night, seen from the alley: rows of small houses, overhead cables, a narrow lane. Beat 1 (0-2s): the " +
      "whole neighbourhood is lit normally — warm light glowing from many windows, a streetlamp on, the blue " +
      "flicker of a television through one curtain. Beat 2 (2-3.5s): every light in the entire frame cuts out " +
      "at once. Total darkness. The streetlamp dies, all the windows go black, the television flicker vanishes. " +
      "Only faint moonlight and the silhouettes of rooftops remain. Somewhere a dog barks. Beat 3 (3.5-6s): one " +
      "single window in the middle of the frame is still glowing — a soft, cool white light, steady and calm, " +
      "the only light in the entire neighbourhood. The camera moves slowly toward that window. Beat 4 (6-10s): " +
      "the camera arrives at the window and looks in. Inside, {{PERSON}} sits calmly on the floor, completely " +
      "relaxed, their face lit by their phone screen. THE PRODUCT from the reference image sits beside them " +
      "connected to the phone by a short cable, matching the reference image exactly in colour, shape and " +
      "proportion — do not redesign it. They are unbothered while the rest of the neighbourhood is dark. FINAL " +
      "FRAME: the product sits beside the person in the calm glow of the phone screen, centered and in sharp " +
      "focus, the dark room and dark neighbourhood around it.",
    negative: "no product glowing by itself, no product lighting the whole room, no lightning, no fire, no candles, no distorted faces, no text on screen",
  },
  {
    // Ditambahkan 2026-08-11 (Brian) — BELUM lewat penilaian rasa formal,
    // lihat catatan (*) di header file. Satu-satunya hook di pustaka ini
    // yang "biasa saja" secara fisika: kekuatannya di REAKSI, bukan di
    // kejadian mustahil — sengaja, karena unboxing adalah format UGC paling
    // terbukti di TikTok Shop dan brand butuh versi yang terasa autentik.
    id: "unboxing-reaksi",
    title: "Unboxing, reaksi jujur",
    score: 4.3,
    intensity: 2,
    mode: "r2v",
    hasPerson: true,
    durationSec: 9,
    prompt:
      "Vertical handheld selfie-style phone shot, chest-up framing, slight natural sway, as if the phone is " +
      "propped up on a table. An ordinary Indonesian home room in the afternoon: plain painted wall, soft " +
      "daylight from a window off to one side, a little everyday clutter. {{PERSON}} sits behind a table with " +
      "a plain unbranded brown cardboard parcel in front of them, still taped shut. Beat 1 (0-1.5s): they look " +
      "straight into the camera holding the sealed parcel with both hands, shaking it lightly next to their " +
      "ear, eyebrows raised, curious and playful. Beat 2 (1.5-3.5s): they tear the tape and pull the flaps " +
      "open. Crumpled paper filler puffs up slightly as the flaps release. The inside of the box is dim and " +
      "ordinary — no glow, no light coming out of it. Beat 3 (3.5-5.5s): they look down into the open box and " +
      "their expression changes to genuine surprise — eyes widening, mouth opening, a small involuntary laugh, " +
      "one hand coming up to cover their mouth for a moment. Beat 4 (5.5-7.5s): both hands reach in and lift " +
      "THE PRODUCT from the reference image out of the box, holding it carefully with two hands, matching the " +
      "reference image exactly in colour, shape and proportion — do not redesign it. Loose paper filler falls " +
      "back into the box. Beat 5 (7.5-9s): they bring the product up to chest height, turn it slightly so its " +
      "front face is square to the camera, and grin. They speak in Indonesian, saying: \"ya ampun, sebagus ini " +
      "aslinya?\" Natural conversational Indonesian, not a newsreader. Do not speak English. FINAL FRAME: the " +
      "product is held still with both hands at chest height, front face square to the camera, centered and in " +
      "sharp focus, filling roughly one third of the frame width, the open cardboard box soft in the " +
      "foreground below.",
    negative:
      "no English speech, no glowing box, no light beams from inside the box, no confetti, no smoke, no " +
      "sparkles, no branded packaging tape, no text on the box, no different product, no redesigned packaging, " +
      "no extra hands, no extra fingers, no distorted face, no exaggerated cartoon reaction",
  },
  // --- LEVEL 3 (skor 4.5-4.6) ---
  {
    id: "shockwave",
    title: "Shockwave dari produk",
    score: 4.5,
    intensity: 3,
    mode: "i2v",
    hasPerson: false,
    durationSec: 8,
    prompt:
      "Locked-off static camera on a phone tripod, eye-level, no camera movement, no zoom. An ordinary " +
      "Indonesian home living room in the background, warm afternoon daylight from a window on the left, " +
      "slightly cluttered: papers on the table, a cardboard box, a thin curtain. Beat 1 (0-1.5s): the product " +
      "sits perfectly still on the wooden table, exactly as in the reference image. Absolutely nothing moves. " +
      "Calm, ordinary, boring. Beat 2 (1.5-3s): the product begins to vibrate very slightly. A faint ring of " +
      "heat distortion forms in the air around it. The papers nearest to it start to tremble. Beat 3 (3-5s): a " +
      "sudden invisible shockwave bursts outward from the product in every direction. Papers fly off the " +
      "table, the curtain whips backward, the cardboard box tips over, a cloud of fine dust rolls outward " +
      "across the floor. The camera shakes hard for half a second from the blast, then settles back to its " +
      "locked position. The product itself stays exactly where it is, completely undamaged and still sharp. " +
      "Beat 4 (5-6.5s): the dust hangs and slowly settles. Papers drift down. The room is now visibly messier " +
      "than at the start, but quiet again. Beat 5 (6.5-8s): a human hand and forearm enter the frame from the " +
      "bottom right and reach slowly toward the product, fingers open, about to pick it up. FINAL FRAME: the " +
      "hand's fingers are just touching the product, which remains centered and in sharp focus, undamaged, " +
      "identical to the reference image.",
    negative: "no fire, no flames, no explosion sparks, no broken product, no gore, no face",
  },
  {
    id: "rakit-sendiri",
    title: "Rakit-sendiri (trik putar-balik)",
    score: 4.5,
    intensity: 3,
    mode: "i2v",
    hasPerson: false,
    durationSec: 6,
    reverse: true,
    prompt:
      "Locked-off static camera, no movement, no zoom. The product sits centered on a clean surface exactly as " +
      "in the reference image, softly lit, shallow depth of field, calm neutral background. Beat 1 (0-0.7s): " +
      "completely still. The product is pristine and sharp. Beat 2 (0.7-1.3s): fine hairline fractures spread " +
      "across the product's surface, glowing faintly along the cracks. Beat 3 (1.3-3s): the product bursts " +
      "apart into many clean geometric fragments that fly outward and upward in all directions, spinning " +
      "slowly, trailing fine particles. The fragments are dry and solid — no fire, no smoke, no liquid. Beat 4 " +
      "(3-6s): the fragments continue drifting outward in slow motion, spreading wider and thinning out, still " +
      "moving steadily at the end of the shot. The centre of the frame is now empty except for a few small " +
      "drifting particles. FINAL FRAME: fragments are still in motion, spread wide across the frame, none of " +
      "them frozen or stopped.",
    negative: "no fire, no smoke, no liquid, no gore, no still frozen ending, no camera movement",
  },
  {
    id: "dunia-ngebut",
    title: "Dunia ngebut, dia diam",
    score: 4.3,
    intensity: 2,
    mode: "r2v",
    hasPerson: true,
    durationSec: 10,
    prompt:
      "Vertical shot on a tripod, locked-off, no camera movement. A busy pedestrian bridge or sidewalk in " +
      "Jakarta at dusk, city buildings and traffic behind, warm streetlights just turning on. Beat 1 (0-2s): " +
      "normal speed. {{PERSON}} stands still in the centre of the frame, facing the camera, holding THE " +
      "PRODUCT from the reference image in both hands at chest height, matching the reference image exactly " +
      "in colour, shape and proportion — do not redesign it. People walk past on either side at normal speed. " +
      "Beat 2 (2-7s): the world around them accelerates into a long-exposure time-lapse. Pedestrians become " +
      "fast smeared streaks of motion blur, headlights stretch into continuous ribbons of light, clouds race " +
      "across the sky, the sunset drops and the sky shifts from orange to deep blue. The person in the centre " +
      "stays completely still and perfectly sharp, in focus, not blurred at all, still holding the product. " +
      "Their clothes and hair move only very slightly. Beat 3 (7-10s): the time-lapse decelerates smoothly " +
      "back to normal speed. The streaks resolve back into ordinary walking people. It is now night, the " +
      "streetlights are fully on, and the person is still standing in exactly the same position holding the " +
      "product. FINAL FRAME: the person stands perfectly still facing the camera at night, holding the " +
      "product at chest height, centered and sharp, city lights soft and glowing behind them.",
    negative: "no sharp background people, no frozen bystanders, no strobing, no flickering, no distorted faces in blur, no text on signage",
  },
  {
    id: "jatuh-dari-langit",
    title: "Produk jatuh dari langit, ditangkap",
    score: 4.6,
    intensity: 3,
    mode: "r2v",
    hasPerson: true,
    durationSec: 9,
    prompt:
      "Static selfie-style shot from a phone on a small tripod, chest-up framing, vertical. {{PERSON}} sits at " +
      "a desk in an ordinary home room, plain painted ceiling visible above, soft daylight. They are " +
      "mid-sentence, talking casually and relaxed to the camera, natural and unaware. Beat 1 (0-1s): normal, " +
      "calm, talking to camera. Beat 2 (1-2s): a hairline crack shoots across the ceiling with a puff of " +
      "plaster dust. They stop talking and look up, confused. Beat 3 (2-4.5s): the ceiling breaks open and THE " +
      "PRODUCT from the reference image falls through the hole, tumbling slowly in the air toward the camera, " +
      "catching the light on its surfaces. Fine plaster dust and small debris fall around it. The product " +
      "stays perfectly intact and exactly matches the reference image, same colour, same shape, same " +
      "proportions — do not redesign it. Beat 4 (4.5-7s): their eyes widen, they push back slightly and raise " +
      "both hands open above their chest, tracking the falling product. Beat 5 (7-9s): they catch the product " +
      "cleanly with both hands at chest height, pull it in, and hold it steady facing the camera, breathing " +
      "hard, with a surprised delighted expression. FINAL FRAME: the product is held still with both hands at " +
      "chest height, centered, facing the camera, in sharp focus, filling roughly one third of the frame width.",
    negative: "no different product, no redesigned packaging, no injury, no blood, no collapsing walls",
  },
  // --- LEVEL 4-5 (skor 4.7-4.8, tertinggi) ---
  {
    id: "produk-raksasa",
    title: "Produk raksasa + dorong masuk",
    score: 4.7,
    intensity: 4,
    mode: "r2v",
    hasPerson: false,
    durationSec: 8,
    prompt:
      "Vertical shot. A narrow Indonesian residential alley (gang) in late afternoon: low houses, tangled " +
      "overhead cables, a warung with a faded awning, a few parked motorbikes, laundry hanging. Golden hour " +
      "light. Beat 1 (0-2s): handheld phone-style shot, slight natural sway, looking down the alley. Two or " +
      "three neighbours are standing in the alley looking upward, small in frame. Beat 2 (2-4s): the camera " +
      "tilts up to reveal THE PRODUCT from the reference image standing at the end of the alley at the scale " +
      "of a four-storey building, upright and monumental, perfectly matching the reference image in colour, " +
      "shape and proportion — do not redesign it. Its surface catches the golden light. Motorbikes ride past " +
      "underneath, tiny by comparison. Beat 3 (4-8s): the camera pushes forward smoothly and continuously " +
      "toward the giant product, moving closer and closer, the alley falling away at the edges of frame, " +
      "until the product's surface completely fills the entire frame. FINAL FRAME: the product's surface " +
      "fills 100% of the frame, evenly lit, slightly soft focus, no background visible at all, no edges of the " +
      "product visible.",
    negative: "no different product, no redesigned packaging, no text on product, no crowd panic, no destruction",
  },
  {
    id: "ojol-tembus-tembok",
    title: "Ojol nembus tempat mustahil",
    score: 4.7,
    intensity: 4,
    mode: "r2v",
    hasPerson: true,
    durationSec: 9,
    prompt:
      "Vertical handheld phone shot, natural slight sway. Interior of an ordinary Indonesian home living room, " +
      "afternoon daylight, tiled floor, a simple sofa. {{PERSON}} sits on the sofa scrolling their phone, " +
      "relaxed and bored. Beat 1 (0-1.5s): calm and ordinary. They glance up at the camera and shrug. Beat 2 " +
      "(1.5-3s): a low engine rumble builds. They look toward the wall, confused. Dust trickles from the " +
      "ceiling. Beat 3 (3-6s): a motorbike ridden by a delivery courier in a plain green jacket and helmet " +
      "rides straight DOWN the interior wall of the living room, tyres gripping the vertical wall, headlight " +
      "on, and lands smoothly on the tiled floor with a small skid. No damage to the wall, no debris, no fire " +
      "— it is treated as completely normal. Beat 4 (6-7.5s): the courier calmly reaches into their delivery " +
      "box and takes out THE PRODUCT from the reference image, matching it exactly in colour, shape and " +
      "proportion — do not redesign it. Beat 5 (7.5-9s): the courier holds the product out toward the camera " +
      "at chest height with one hand, arm extended, offering it directly to the viewer. The seated person " +
      "looks at it with wide eyes. The courier speaks casually in Indonesian, saying: \"pesanan atas nama " +
      "kakak, ya.\" Natural conversational Indonesian, not a newsreader. Do not speak English. FINAL FRAME: " +
      "the product is held out toward the camera at chest height, centered and in sharp focus, the courier's " +
      "hand and forearm visible, arm fully extended.",
    negative: "no English speech, no brand logo on jacket, no visible license plate, no crash, no fire, no damaged wall",
  },
  {
    id: "pasar-beku",
    title: "Waktu berhenti di pasar",
    score: 4.8,
    intensity: 5,
    mode: "r2v",
    hasPerson: false,
    durationSec: 10,
    prompt:
      "Vertical shot. A busy traditional Indonesian market (pasar) in the morning: crowded narrow aisles, " +
      "fabric awnings, crates of vegetables, hanging plastic bags, warm light filtering through the canopy. " +
      "Handheld phone-style camera with natural sway. Beat 1 (0-2.5s): full motion and life. Shoppers walk " +
      "past, a vendor tosses a plastic bag, a hand pours water from a scoop, dust and steam drift through " +
      "shafts of light. Busy, noisy, normal. Beat 2 (2.5-3.5s): everything in the frame FREEZES completely " +
      "mid-motion — people mid-step with one foot raised, the tossed bag suspended in the air, the poured " +
      "water frozen as a solid arc of droplets, the drifting dust motionless. The camera keeps moving with its " +
      "natural handheld sway, so the frozen world feels genuinely three dimensional. Colour drains slightly " +
      "toward cool grey. Beat 3 (3.5-7s): only THE PRODUCT from the reference image is unaffected — it rests " +
      "on a market stall, still in full warm colour and gently catching the light, matching the reference " +
      "image exactly in colour, shape and proportion — do not redesign it. The camera drifts slowly through " +
      "the frozen crowd toward it, passing between motionless shoppers. Beat 4 (7-10s): a hand and forearm " +
      "enter frame from the bottom, reach into the frozen scene, and pick the product up off the stall, " +
      "lifting it toward the camera. As the product is lifted, warm colour begins bleeding back into the " +
      "frozen world around it. FINAL FRAME: the product is held in the hand close to the camera, centered and " +
      "sharp in full warm colour, the frozen market soft and desaturated behind it.",
    negative: "no slow motion blur on frozen subjects, no ghosting, no camera freeze, no different product, no text on stalls",
  },
  {
    id: "krl-ruang-tamu",
    title: "KRL menembus ruang tamu",
    score: 4.8,
    intensity: 5,
    mode: "r2v",
    hasPerson: true,
    durationSec: 9,
    prompt:
      "Cinematic vertical shot, locked-off tripod at seated eye level. An ordinary Indonesian living room in " +
      "the afternoon: tiled floor, a sofa, a wall clock, a plain painted wall across the back of frame. " +
      "{{PERSON}} sits calmly on the sofa facing the camera, holding THE PRODUCT from the reference image in " +
      "both hands, matching it exactly in colour, shape and proportion. Beat 1 (0-1.5s): calm and ordinary. " +
      "They are relaxed, looking at the camera. Beat 2 (1.5-2.5s): a deep vibration builds. The wall clock " +
      "rattles. Dust shakes loose from the ceiling. A distant train horn sounds, getting closer fast. Beat 3 " +
      "(2.5-6s): a full-size commuter train bursts through the back wall from the left and roars horizontally " +
      "across the entire room behind the sofa, filling the whole back of frame, windows and lights streaking " +
      "past, wind blasting through the room, curtains and papers flying, the person's hair and shirt whipping " +
      "violently. Beat 4 (6-8s): the train's last carriage passes and exits through the right side of frame. " +
      "The wind dies. Dust and papers drift down. The back wall is now an open train-sized gap with rails " +
      "running through it. Beat 5 (8-9s): the person has not moved at all. Still seated, still calm, still " +
      "holding the product in exactly the same position, hair settling back down. FINAL FRAME: the person " +
      "sits calmly holding the product at chest height, centered and sharp, the open wall and rails visible " +
      "behind them, dust settling.",
    negative: "no crowds, no other people, no injury, no blood, no fire, no derailment, no destroyed sofa, no distorted face, no extra fingers, no text, no logo",
  },
];

export function getHooksByIntensity(intensity: HookIntensity): HookLibraryEntry[] {
  return HOOK_LIBRARY.filter((h) => h.intensity === intensity);
}

export function getHookById(id: string): HookLibraryEntry | undefined {
  return HOOK_LIBRARY.find((h) => h.id === id);
}

/** Ganti {{PERSON}} dengan deskripsi avatar; ide tanpa {{PERSON}} (product-only) diteruskan apa adanya. */
export function fillPersonInPrompt(prompt: string, personDesc: string | null): string {
  if (!prompt.includes("{{PERSON}}")) return prompt;
  return prompt.replaceAll("{{PERSON}}", personDesc ?? "a native Indonesian person");
}
