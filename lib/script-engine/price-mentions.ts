/** Parser harga lisan Indonesia, dibagi antara truth validator dan SA6. */
const KATA_SATUAN: Record<string, number> = {
  nol: 0, satu: 1, se: 1, dua: 2, tiga: 3, empat: 4, lima: 5,
  enam: 6, tujuh: 7, delapan: 8, sembilan: 9,
};

export function hargaTerbilang(text: string): { frasa: string; nilai: number }[] {
  const kata = text.toLowerCase().match(/[a-z]+/g) ?? [];
  const hasil: { frasa: string; nilai: number }[] = [];
  let kelompok = 0;
  let tertunda = 0;
  let total = 0;
  let pengaliTerakhir = Infinity;
  let mulai = -1;
  let punyaAngka = false;
  const reset = () => { kelompok = 0; tertunda = 0; total = 0; pengaliTerakhir = Infinity; mulai = -1; punyaAngka = false; };
  const tutup = (sampai: number) => {
    if (total > 0) hasil.push({ frasa: kata.slice(mulai, sampai).join(" "), nilai: Math.round(total + kelompok + tertunda) });
    reset();
  };
  for (let i = 0; i < kata.length; i++) {
    const w = kata[i];
    const tandai = () => { if (mulai < 0) mulai = i; punyaAngka = true; };
    if (w in KATA_SATUAN) { tandai(); tertunda = KATA_SATUAN[w]; continue; }
    if (w === "sepuluh") { tandai(); tertunda = 10; continue; }
    if (w === "sebelas") { tandai(); tertunda = 11; continue; }
    if (w === "belas") { tandai(); tertunda = 10 + tertunda; continue; }
    if (w === "puluh") { tandai(); kelompok += tertunda * 10; tertunda = 0; continue; }
    if (w === "setengah") { tandai(); tertunda += 0.5; continue; }
    if (w === "ratus" || w === "seratus") {
      tandai(); kelompok += (w === "seratus" ? 1 : tertunda || 1) * 100; tertunda = 0; continue;
    }
    if (w === "ribu" || w === "seribu" || w === "juta" || w === "sejuta") {
      const seSendiri = w.startsWith("se");
      if (!punyaAngka && !seSendiri) { tutup(i); continue; }
      const pengali = w.includes("juta") ? 1_000_000 : 1_000;
      if (pengali >= pengaliTerakhir) tutup(i);
      tandai();
      // Default satu hanya untuk bentuk implisit seribu/sejuta. Token eksplisit
      // "nol" adalah 0, bukan alasan mengubahnya menjadi satu.
      const nilaiDasar = seSendiri ? 1 : punyaAngka ? kelompok + tertunda : 1;
      total += nilaiDasar * pengali;
      pengaliTerakhir = pengali; kelompok = 0; tertunda = 0; continue;
    }
    tutup(i);
  }
  tutup(kata.length);
  return hasil;
}

export interface HargaIndonesiaMention {
  frasa: string;
  nilai: number;
  bentuk: "unit" | "currency" | "rupiah" | "terbilang";
}

const nilaiNominalPenuh = (raw: string): number => Number(raw.replace(/[.,\s]/g, ""));

/** Hilangkan hanya span nominal berdigit sebelum pemeriksaan angka umum L-14. */
export function tanpaNominalHargaTertulis(text: string): string {
  return text
    .replace(/\b(?:rp|idr)\s*\.?\s*\d+(?:[.,]\d{3})*\b(?![.,]\d)/gi, " ")
    .replace(/\d+(?:[.,]\d{3})*\s*rupiah\b/gi, " ")
    .replace(/\d+(?:[.,]\d+)?\s*(?:ribu|rb|ribuan|juta|jt|perak)\b/gi, " ");
}

/**
 * Detektor harga bersama untuk naskah tertulis maupun lisan. Angka biasa
 * seperti "3 kartu" atau "15 detik" sengaja tidak dihitung: nominal wajib
 * membawa penanda mata uang/satuan, atau ditulis terbilang sampai ribu/juta.
 */
export function deteksiHargaIndonesia(text: string): HargaIndonesiaMention[] {
  const hasil: HargaIndonesiaMention[] = [];
  const occupied: Array<[number, number]> = [];
  const add = (match: RegExpExecArray, nilai: number, bentuk: HargaIndonesiaMention["bentuk"]) => {
    // Nol tetap sebuah KLAIM HARGA bila penanda mata uang/satuannya eksplisit.
    // approved price 0 berarti "tidak ada klaim harga", bukan izin berkata Rp0.
    if (!Number.isFinite(nilai) || nilai < 0) return;
    hasil.push({ frasa: match[0], nilai: Math.round(nilai), bentuk });
    occupied.push([match.index, match.index + match[0].length]);
  };
  const overlaps = (match: RegExpExecArray) => occupied.some(([start, end]) => match.index < end && match.index + match[0].length > start);

  const unit = /(\d+(?:[.,]\d+)?)\s*(ribu|rb|ribuan|juta|jt|perak)\b/gi;
  for (const match of text.matchAll(unit)) {
    const value = Number(match[1].replace(",", "."));
    const multiplier = /juta|jt/i.test(match[2]) ? 1_000_000 : /perak/i.test(match[2]) ? 1 : 1_000;
    add(match, value * multiplier, "unit");
  }
  const currency = /\b(?:rp|idr)\s*\.?\s*(\d+(?:[.,]\d{3})*)\b(?![.,]\d)/gi;
  for (const match of text.matchAll(currency)) if (!overlaps(match)) add(match, nilaiNominalPenuh(match[1]), "currency");
  const rupiah = /(\d+(?:[.,]\d{3})*)\s*rupiah\b/gi;
  for (const match of text.matchAll(rupiah)) if (!overlaps(match)) add(match, nilaiNominalPenuh(match[1]), "rupiah");
  const zero = String.raw`(?:0+(?:[.,]0+)?|nol|zero)`;
  const unitHarga = String.raw`(?:rupiah|ribu|rb|juta|jt|perak)`;
  const labelHarga = String.raw`(?:harga(?:nya)?|biaya(?:nya)?|tarif(?:nya)?|banderol(?:nya)?)`;
  const linker = String.raw`(?:itu|adalah|sekarang|saat|ini|jadi|tetap|cuma|hanya|sebesar|senilai)`;
  const zeroGrammars = [
    new RegExp(String.raw`\b(?:rp|idr)\s*\.?\s*${zero}\b`, "gi"),
    new RegExp(String.raw`\b${zero}\s*${unitHarga}\b`, "gi"),
    new RegExp(String.raw`\b${labelHarga}\s*(?:[:=–—-]\s*)?(?:(?:${linker})\s+){0,3}${zero}\b`, "gi"),
  ];
  for (const grammar of zeroGrammars) {
    for (const match of text.matchAll(grammar)) if (!overlaps(match)) add(match, 0, "terbilang");
  }
  for (const mention of hargaTerbilang(text)) {
    hasil.push({ ...mention, bentuk: "terbilang" });
  }
  return hasil;
}
