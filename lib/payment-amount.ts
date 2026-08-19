// Pengikatan jumlah callback gateway ke order lokal. Signature yang sah
// membuktikan SIAPA yang menandatangani payload, bukan bahwa payload itu milik
// order ini — jumlahnya wajib dicocokkan ke amount yang tersimpan sebelum
// transisi status atau kredit ledger apa pun. Dipakai webhook Midtrans & Duitku.

/** Gateway mengirim string desimal ("60000" / "60000.00"); simpanan kita rupiah bulat. */
export function grossAmountMatchesStoredAmount(grossAmount: unknown, expectedAmountIdr: number): boolean {
  const match = /^(\d+)(?:\.(\d{1,2}))?$/.exec(String(grossAmount ?? ""));
  if (!match || !Number.isSafeInteger(expectedAmountIdr) || expectedAmountIdr < 0) return false;
  // Jumlah checkout IDR wajib rupiah bulat persis. Jangan bulatkan data provider.
  return BigInt(match[1]) === BigInt(expectedAmountIdr) && (!match[2] || /^0{1,2}$/.test(match[2]));
}
