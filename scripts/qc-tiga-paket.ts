/**
 * QC atas hasil uji tiga paket — angka, bukan mata saya.
 *
 * Dipakai pemeriksa yang SAMA dengan yang menolak job produksi 2f95311f:
 * QC-02 (morphing/anomali tangan) dan QC-11 (jumlah subjek). Menilai hasil
 * render dengan mata sendiri lalu menyebutnya "bersih" adalah persis kebiasaan
 * yang membuat mutu buruk bertahan; gerbang yang sudah ada harus yang menjawab.
 */
import { qcHandMorphing, qcSubjekLokal } from "../lib/media/qc";

const berkas = process.argv.slice(2);
if (!berkas.length) { console.error("Sebutkan file video."); process.exit(1); }

for (const f of berkas) {
  const nama = f.split("/").slice(-2)[0];
  const kerja = `/tmp/qc-${nama}`;
  const hasil: string[] = [];
  for (const [label, jalan] of [
    ["QC-02 tangan", () => qcHandMorphing(f, kerja)],
    ["QC-11 subjek", () => qcSubjekLokal(f, 1, kerja)],
  ] as const) {
    try {
      const c = await jalan();
      hasil.push(`${label}: ${c.status.toUpperCase()}${c.detail ? ` — ${c.detail}` : ""}`);
    } catch (e) {
      hasil.push(`${label}: ERROR — ${(e as Error).message}`);
    }
  }
  console.log(`\n=== ${nama} ===\n${hasil.join("\n")}`);
}
