// SSML builder dari segmen skrip (aturan pasca-proses BR-04.3):
// "written beat" di skrip (koma, ellipsis, "nah,", tanda baca) -> <break time="...ms"/>;
// harga -> <emphasis level="strong">; marker eksplisit "<jeda Nms>" -> <break time="Nms"/>.
//
// CATATAN RISET: Google Chirp3-HD TIDAK mendukung SSML (hanya teks polos dengan
// tanda baca natural) — lihat buildChirpText(). Azure Neural mendukung SSML penuh.

const DISCOURSE_MARKERS = ["nah", "jadi gini", "sumpah", "eh", "btw"];
const PRICE_REGEX = /\d+([.,]\d+)?\s?(ribu|rb|ribuan|juta|jt)\b/gi;

export function escapeXml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Terapkan aturan jeda pada teks yang SUDAH di-escape. */
function applyBreaks(escaped: string): string {
  let out = escaped;
  // Marker eksplisit dari penulis skrip: <jeda 800ms> (sudah ke-escape jadi &lt;jeda 800ms&gt;)
  out = out.replace(/&lt;jeda\s+(\d+)\s*(?:ms)?&gt;/g, '<break time="$1ms"/>');
  // Ellipsis -> jeda panjang
  out = out.replace(/\.\.\./g, '<break time="500ms"/>');
  // Koma setelah discourse marker -> jeda sedang
  for (const m of DISCOURSE_MARKERS) {
    const re = new RegExp(`\\b(${m.replace(" ", "\\s")}),`, "gi");
    out = out.replace(re, "$1" + '<break time="300ms"/>');
  }
  // Koma biasa -> jeda mikro
  out = out.replace(/,(?!\s*<break)/g, '<break time="150ms"/>');
  // Titik -> jeda kalimat (hindari titik yang sudah jadi bagian tag/ellipsis)
  out = out.replace(/\.(?!\s*<break)/g, '<break time="350ms"/>');
  // Seru & tanya -> jeda sedang
  out = out.replace(/([!?])(?!\s*<break)/g, '$1<break time="300ms"/>');
  return out;
}

/** Harga dibungkus emphasis strong. */
function applyEmphasis(text: string): string {
  return text.replace(PRICE_REGEX, (m) => `<emphasis level="strong">${m}</emphasis>`);
}

/** SSML lengkap untuk Azure Neural (voice id-ID). */
export function buildSsml(text: string, voiceName: string): string {
  const body = applyEmphasis(applyBreaks(escapeXml(text)));
  return (
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="id-ID">` +
    `<voice name="${voiceName}">${body}</voice></speak>`
  );
}

/** Isi SSML tanpa wrapper <speak> — untuk kebutuhan tes. */
export function buildSsmlBody(text: string): string {
  return applyEmphasis(applyBreaks(escapeXml(text)));
}

/**
 * Teks untuk Google Chirp3-HD: SSML tidak didukung, jadi marker "<jeda Nms>"
 * diganti tanda baca natural (koma/ellipsis) yang dihormati model.
 */
export function buildChirpText(text: string): string {
  return text
    .replace(/<jeda\s+\d+\s*(?:ms)?>/g, "... ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Estimasi biaya TTS per karakter (USD). Sumber: Google Chirp3-HD $30/1M, Azure Neural $16/1M. */
export const TTS_RATES = {
  googleChirp3HdPerMChars: 30,
  azureNeuralPerMChars: 16,
} as const;
