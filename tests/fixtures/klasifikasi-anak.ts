// Pembungkus satu-tembakan untuk klasifikasiGambar, dijalankan sebagai PROSES
// ANAK oleh tests/klasifikasi-gambar.test.ts.
//
// Kenapa proses terpisah, bukan panggilan langsung (temuan Reviewer 21 Agu):
// `Promise.race` hanya mengakhiri PENANTIAN test — ia tidak membatalkan
// klasifikasiGambar dan tidak membunuh biner anak yang sedang menggantung.
// Akibatnya, sesudah asersi tenggat, promise yang tertinggal melanjutkan
// pipeline-nya memakai PATH yang sudah dipulihkan dan fixture yang sudah
// dihapus — mencemari test lain — sementara child-nya menahan proses Node
// sampai selesai.
//
// Dengan proses anak sendiri (detached, punya process group), tenggat test bisa
// membunuh SELURUH grup: pembungkus ini, biner palsunya, dan `sleep`-nya.
// Lingkungan palsu (PATH) juga hanya berlaku di sini, jadi test induk tidak
// pernah memutasi process.env miliknya sendiri.
import { klasifikasiGambar } from "../../lib/media/klasifikasi-gambar";

const foto = process.argv[2];
if (!foto) {
  process.stderr.write("usage: klasifikasi-anak.ts <path-foto>\n");
  process.exit(2);
}
const hasil = await klasifikasiGambar(foto);
process.stdout.write(JSON.stringify(hasil));
