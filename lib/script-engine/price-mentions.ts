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
      total += (seSendiri ? 1 : (kelompok + tertunda) || 1) * pengali;
      pengaliTerakhir = pengali; kelompok = 0; tertunda = 0; continue;
    }
    tutup(i);
  }
  tutup(kata.length);
  return hasil;
}
