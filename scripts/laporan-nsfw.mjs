/**
 * KPI PENOLAKAN NSFW PROVIDER — board review 19 Agu §4.3.
 *
 * Sebelum ini angka penolakan hidup dari ingatan ("6/10 malam itu", "~9% di
 * canary") — tidak ada satu perintah yang menariknya dari data produksi.
 * Skrip ini HANYA MEMBACA (SELECT saja, nol mutasi) dan melaporkan per format:
 * berapa job gagal karena penolakan konten provider, dibanding seluruh job
 * yang benar-benar berangkat render, dalam N hari terakhir.
 *
 * Target beta privat (board §4.3): hands_only ≤20%, talking_head ≤35%.
 * Kalau lebih: matriks format ditata ulang, BUKAN menulis ulang naskah —
 * standar-10 §E: penolakan NSFW bukan selalu bug naskah.
 *
 * Metodologi, jujur soal batasnya:
 * - "Ditolak" = transisi FAILED yang alasannya cocok pola konten
 *   (sensitive/risk/content policy/NSFW). Alasan lain (timeout, kuota) TIDAK
 *   dihitung penolakan.
 * - "Berangkat render" = job yang mencapai state terminal DAN sempat memegang
 *   biaya (cost_actual_idr > 0) ATAU sukses (READY). Job yang mati di gate
 *   pra-bayar tidak dihitung berangkat — gate menolak itu fitur, bukan
 *   penolakan provider.
 *
 * Pakai:  DATABASE_URL="postgres://…" node scripts/laporan-nsfw.mjs [hari=7]
 */
import pg from "pg";

const hari = Math.max(1, Number(process.argv[2] ?? 7));
const url = process.env.DATABASE_URL;
if (!url || !/^postgres/i.test(url)) {
  console.error("DATABASE_URL PostgreSQL wajib di-set (read-only, SELECT saja).");
  process.exit(2);
}

const POLA_KONTEN = "(sensitive|risk[_ ]?level|content polic|nsfw)";
const TARGET = { hands_only: 0.2, talking_head: 0.35 };

const c = new pg.Client({ connectionString: url });
await c.connect();
try {
  const sejak = new Date(Date.now() - hari * 86_400_000).toISOString();
  const { rows } = await c.query(
    `SELECT j.format,
            count(*) FILTER (WHERE j.state = 'READY') AS sukses,
            count(*) FILTER (WHERE j.state IN ('FAILED','REFUNDED')
              AND EXISTS (SELECT 1 FROM audit_log a WHERE a.entity='jobs' AND a.entity_id=j.id
                          AND a.action='job.transition' AND a.meta::jsonb->>'to'='FAILED'
                          AND (a.meta::jsonb->>'reason') ~* $2)) AS ditolak_konten,
            count(*) FILTER (WHERE j.state IN ('FAILED','REFUNDED')) AS gagal_semua,
            count(*) FILTER (WHERE j.state = 'READY' OR j.cost_actual_idr > 0
              OR j.state IN ('FAILED','REFUNDED')) AS terminal
     FROM jobs j
     WHERE j.created_at >= $1
     GROUP BY j.format ORDER BY j.format`,
    [sejak, POLA_KONTEN]
  );

  console.log(`KPI penolakan konten provider — ${hari} hari terakhir (sejak ${sejak.slice(0, 10)})`);
  if (!rows.length) { console.log("(tidak ada job di jendela ini)"); process.exit(0); }
  let adaPelanggaran = false;
  for (const r of rows) {
    const berangkat = Number(r.sukses) + Number(r.ditolak_konten);
    const rate = berangkat ? Number(r.ditolak_konten) / berangkat : 0;
    const target = TARGET[r.format];
    const status = target === undefined ? "" : rate <= target ? " ✅" : " ⛔ DI ATAS TARGET";
    if (target !== undefined && rate > target) adaPelanggaran = true;
    console.log(
      `${r.format.padEnd(13)} sukses=${r.sukses}  ditolak-konten=${r.ditolak_konten}  ` +
      `gagal-lain=${Number(r.gagal_semua) - Number(r.ditolak_konten)}  ` +
      `rate=${(rate * 100).toFixed(1)}%${target !== undefined ? ` (target ≤${target * 100}%)` : ""}${status}`
    );
  }
  console.log("\nCatatan: penolakan konten di-refund otomatis (failJob → release); "
    + "rate di atas target = tata ulang matriks format, bukan tulis ulang naskah (standar-10 §E).");
  process.exit(adaPelanggaran ? 1 : 0);
} finally {
  await c.end();
}
