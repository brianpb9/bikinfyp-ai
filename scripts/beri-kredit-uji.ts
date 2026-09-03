/**
 * Beri jatah video UJI ke satu akun — lewat jalur domain, bukan SQL mentah.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA BUKAN INSERT LANGSUNG
 * ─────────────────────────────────────────────────────────────────────────────
 * PgKreditVideo.bonus() adalah jalur yang sama dengan bonus pendaftaran: ia
 * menulis baris kredit DAN barisnya tercatat sebagai 'bonus' dengan catatan.
 * INSERT tangan melewati itu, dan kredit yang muncul tanpa jejak adalah
 * persis jenis selisih yang paling mahal ditelusuri kemudian.
 *
 * Dipakai untuk menyiapkan akun penguji supaya tiga paket bisa diuji ujung ke
 * ujung. Berpagar: butuh KREDIT_UJI=ya-saya-yakin, dan emailnya harus disebut.
 *
 *   KREDIT_UJI=ya-saya-yakin npx tsx scripts/beri-kredit-uji.ts <email> <jenis:qty>...
 */
import { closeAllPools, getPool } from "../lib/postgres/pool";
import { PgKreditVideo } from "../lib/postgres/kredit-video";
import { JENIS_VIDEO, type JenisVideo } from "../lib/kredit-video";
import { config } from "../lib/config";

const arg = process.argv.slice(2);
const email = (arg[0] ?? "").toLowerCase();
const permintaan = arg.slice(1).map((x) => {
  const [jenis, qty] = x.split(":");
  return { jenis: jenis as JenisVideo, qty: Number(qty) };
});

if (!email || !permintaan.length) {
  throw new Error("Pakai: beri-kredit-uji.ts <email> standard:2 premium:2 ultra:2");
}
if (process.env.KREDIT_UJI !== "ya-saya-yakin") {
  throw new Error("Ditolak: setel KREDIT_UJI=ya-saya-yakin.");
}
for (const p of permintaan) {
  if (!JENIS_VIDEO.includes(p.jenis)) throw new Error(`jenis tidak dikenal: ${p.jenis}`);
  if (!Number.isInteger(p.qty) || p.qty < 1 || p.qty > 20) throw new Error(`qty tidak masuk akal: ${p.qty}`);
}

const pool = getPool(config.databaseUrl);
try {
  const { rows } = await pool.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE lower(email) = $1", [email],
  );
  if (!rows[0]) throw new Error(`tidak ada akun dengan email ${email}`);
  const repo = new PgKreditVideo(config.databaseUrl);
  for (const p of permintaan) {
    await repo.bonus(rows[0].id, p.jenis, p.qty, "jatah uji fungsional tiga paket (operator, atas permintaan Brian)");
    console.log(`+${p.qty} ${p.jenis} -> ${rows[0].email}`);
  }
  console.log(JSON.stringify(await repo.sisa(rows[0].id), null, 2));
} finally {
  await closeAllPools();
}
