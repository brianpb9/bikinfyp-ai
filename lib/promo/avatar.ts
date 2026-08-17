/**
 * Video Promosi — pemilihan avatar buat hook AI (Brian 2026-08-10): preset
 * dari bank persona kita, ATAU upload foto sendiri.
 *
 * PENTING (dites langsung 2026-08-10): BytePlus MENOLAK foto wajah manusia
 * realistis sebagai image reference di SEMUA mode (i2v polos, r2v
 * reference_image, first_frame, last_frame) — "may contain real person"
 * (privacy/anti-deepfake filter, bukan bug di sisi kita). Jadi foto upload
 * user TIDAK BISA dipakai langsung sebagai anchor visual presisi.
 *
 * Solusi: foto dibaca oleh Gemini (vision) jadi DESKRIPSI TEKS ciri-ciri
 * fisik (mirip gaya promptSeed di lib/personas.ts) — deskripsi itu yang
 * dipakai text-to-video, BUKAN fotonya sendiri. Hasilnya "terinspirasi dari
 * foto", bukan wajah persis sama — user perlu tau ini (lihat UI copy).
 */
import { config } from "../config";
import { getAvatarPreset } from "../avatar-presets";

export interface AvatarChoice {
  kind: "preset" | "custom";
  presetId?: string; // kind === "preset"
  customDescription?: string; // kind === "custom", hasil vision, di-cache di DB
}

/** Deskripsi teks final yang disuntik ke {{PERSON}} di hook-library.ts. */
export function resolveAvatarDescription(choice: AvatarChoice): string {
  if (choice.kind === "preset") {
    const avatar = choice.presetId ? getAvatarPreset(choice.presetId) : undefined;
    return avatar?.castLock ?? "a native Indonesian person, warm approachable everyday look";
  }
  return choice.customDescription ?? "a native Indonesian person, warm approachable everyday look";
}

const VISION_MODEL = "gemini-flash-latest";

/** Kirim foto ke Gemini vision, minta deskripsi ciri fisik gaya promptSeed
 * (BUKAN identitas/nama — cuma ciri visual buat text-to-video), Indonesia
 * atau bukan tidak masalah, cukup ciri fisik yang bisa direproduksi model
 * video sebagai orang BARU yang mirip, bukan foto asli yang direproduksi. */
export async function describeAvatarFromPhoto(imageBuffer: Buffer, mime: string): Promise<string> {
  if (!config.geminiApiKey) throw new Error("GEMINI_API_KEY belum di-set — deskripsi avatar tidak bisa dibuat.");
  const instruction =
    "Describe this person's general physical appearance in one dense sentence, suitable as a text-to-video " +
    "prompt seed for generating a NEW similar-looking person (not reproducing this exact photo): approximate " +
    "age range, skin tone, hair style/colour, face shape, build, general everyday style. Do NOT mention " +
    "identity, name, or anything that could identify a specific real individual. Do NOT mention clothing " +
    "colour (that varies per shot). Output ONLY the descriptive sentence, nothing else.";
  const res = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${VISION_MODEL}:generateContent?key=${config.geminiApiKey}`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contents: [
          {
            parts: [
              { text: instruction },
              { inlineData: { mimeType: mime, data: imageBuffer.toString("base64") } },
            ],
          },
        ],
      }),
    }
  );
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`Gemini vision HTTP ${res.status}: ${JSON.stringify(data).slice(0, 250)}`);
  const text = (data as { candidates?: { content?: { parts?: { text?: string }[] } }[] })
    ?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text || !text.trim()) throw new Error("Gemini vision: respons tanpa deskripsi.");
  return text.trim();
}
