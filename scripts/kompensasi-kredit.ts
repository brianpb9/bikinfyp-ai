/**
 * Kredit kompensasi ke satu wallet, lewat jalur ledger yang sah.
 *
 * Memakai grantBonus(): baris BARU bertipe 'bonus', tidak pernah menyentuh
 * baris lama. Ledger ini append-only dan dijaga trigger database, jadi
 * "membetulkan" catatan lama memang mustahil — riwayat uang harus bisa dibaca
 * ulang persis seperti kejadiannya.
 *
 * Idempoten lewat RUJUKAN. Skrip operasional hampir selalu dijalankan dua kali;
 * tanpa kunci itu, jalankan kedua menggandakan hadiahnya.
 *
 *   DATABASE_URL=... ORG=<uuid> USER=<uuid> CONFIRM=YA \
 *     npx tsx scripts/kompensasi-kredit.ts
 *
 * Tanpa CONFIRM=YA ia hanya melapor.
 */
import { PgCreditPaymentRepository } from "../lib/postgres/credit-payment";
import { config } from "../lib/config";

const orgId = process.env.ORG ?? "";
const userId = process.env.USER_ID ?? "";
const jalan = process.env.CONFIRM === "YA";

if (!/^postgres(ql)?:\/\//i.test(config.databaseUrl)) { console.error("DATABASE_URL PostgreSQL wajib."); process.exit(1); }
if (!orgId || !userId) { console.error("ORG dan USER_ID wajib diisi."); process.exit(1); }

/**
 * DUA baris, bukan satu — dan itu disengaja.
 *
 * Pengembalian dan itikad baik adalah dua hal berbeda secara pembukuan:
 * yang satu membatalkan pendapatan yang tidak jadi diberikan, yang satu biaya
 * hubungan pelanggan. Menggabungkannya jadi satu angka membuat keduanya tidak
 * bisa dipisahkan lagi nanti, dan ledger ini tidak bisa diedit.
 */
const POS = [
  { jumlah: 24000, alasan: "pipeline upgrade compensation — refund 2 job berbayar yang dibatalkan", rujukan: `kompensasi-refund-${orgId}` },
  { jumlah: 12000, alasan: "pipeline upgrade compensation — kredit itikad baik", rujukan: `kompensasi-goodwill-${orgId}` },
];

const repo = new PgCreditPaymentRepository(config.databaseUrl);
try {
  const sebelum = await repo.getBalance({ userId, orgId });
  console.log(`Saldo org sebelum: Rp${sebelum.toLocaleString("id-ID")}`);
  for (const p of POS) console.log(`  akan diberikan: Rp${p.jumlah.toLocaleString("id-ID")} — ${p.alasan}`);

  if (!jalan) {
    console.log(`\nMODE LAPOR SAJA. Dengan CONFIRM=YA total Rp${POS.reduce((a, p) => a + p.jumlah, 0).toLocaleString("id-ID")} masuk.`);
    process.exit(0);
  }

  let total = 0;
  for (const p of POS) {
    const hasil = await repo.grantBonus({ userId, orgId }, p.jumlah, { alasan: p.alasan, rujukan: p.rujukan });
    total += hasil.amountIdr;
    console.log(hasil.granted
      ? `  DIBERIKAN Rp${hasil.amountIdr.toLocaleString("id-ID")} — ${p.alasan}`
      : `  DILEWATI  rujukan "${p.rujukan}" sudah pernah diberikan`);
  }
  const sesudah = await repo.getBalance({ userId, orgId });
  console.log(`\nSaldo org sesudah: Rp${sesudah.toLocaleString("id-ID")} (naik Rp${(sesudah - sebelum).toLocaleString("id-ID")}, diberikan Rp${total.toLocaleString("id-ID")})`);
} finally {
  await repo.close();
}
