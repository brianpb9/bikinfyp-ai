import { wajibAdmin } from "@/lib/admin-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { config } from "@/lib/config";

// DASHBOARD ADMIN — BACA SAJA.
//
// Tidak ada satu pun tombol yang mengubah data di sini, dan itu disengaja.
// Sistem ini belum punya konsep peran (lihat lib/admin-auth.ts); membangun
// halaman yang bisa MENGUBAH saldo atau membatalkan job sebelum peran itu ada
// berarti satu bug otorisasi memisahkan orang asing dari saldo semua pengguna.
//
// Yang mengubah data tetap lewat skrip CLI di laptop founder — tidak bisa
// diserang dari internet. Halaman ini menjawab pertanyaan yang selama ini
// memaksa membuka terminal: job apa yang gagal, kenapa, dan siapa yang kena.
//
// Begitu ada operator kedua atau refund manual jadi rutin, barulah peran dan
// tombol layak dibangun — dengan audit log, bukan tanpa.

export const dynamic = "force-dynamic";

interface BarisJob {
  id: string;
  state: string;
  format: string;
  quality_tier: string;
  created_at: string;
  completed_at: string | null;
  qc_result: string | null;
  email: string | null;
}

async function ambilData() {
  if (!postgresRuntimeEnabled()) return null;
  const pool = getPool(config.databaseUrl);
  const [job, ringkas, kredit] = await Promise.all([
    pool.query<BarisJob>(
      `SELECT j.id, j.state, j.format, j.quality_tier, j.created_at, j.completed_at,
              j.qc_result, u.email
         FROM jobs j LEFT JOIN users u ON u.id = j.user_id
        ORDER BY j.created_at DESC LIMIT 40`
    ),
    // BATAS WAKTU DIHITUNG DI JS, BUKAN DI SQL.
    //
    // `created_at` bertipe TEXT di seluruh skema — timestamp disimpan sebagai
    // string ISO-8601. Query lama berbunyi `created_at > NOW() - INTERVAL
    // '7 days'`, dan Postgres MENOLAK membandingkan text dengan timestamptz:
    //   operator does not exist: text > timestamp with time zone
    // Halaman admin gagal total dengan "server-side exception", bukan sekadar
    // salah angka.
    //
    // Diperbaiki mengikuti pola yang sudah dipakai di SELURUH kode lain
    // (lib/otp.ts, lib/extract.ts, lib/postgres/smoke-runtime.ts): hitung
    // ambangnya di JS sebagai ISO, lalu bandingkan teks dengan teks. Sah
    // karena ISO-8601 berurut secara leksikografis sama dengan kronologis —
    // dan kolomnya tetap bisa dipakai indeks, tidak seperti kalau di-cast.
    pool.query<{ state: string; n: string }>(
      `SELECT state, COUNT(*)::text AS n FROM jobs
        WHERE created_at > $1 GROUP BY state ORDER BY 2 DESC`,
      [new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString()]
    ),
    pool.query<{ n: string; total: string }>(
      `SELECT COUNT(DISTINCT user_id)::text AS n, COALESCE(SUM(delta),0)::text AS total
         FROM credit_ledger WHERE type = 'topup'`
    ),
  ]);
  return { job: job.rows, ringkas: ringkas.rows, kredit: kredit.rows[0] };
}

/** Alasan gagal dari qc_result — yang selama ini cuma bisa dilihat dengan
 *  membuka database. Ditampilkan apa adanya, tanpa dirapikan jadi kalimat
 *  ramah: operator butuh tahu check MANA yang menolak. */
function alasanGagal(qc: string | null): string {
  if (!qc) return "";
  try {
    const d = JSON.parse(qc) as { checks?: { code: string; status: string; detail?: string }[] };
    const gagal = (d.checks ?? []).filter((c) => c.status === "fail");
    if (gagal.length === 0) return "";
    return gagal.map((c) => `${c.code}: ${c.detail ?? "gagal"}`).join(" · ");
  } catch {
    return "";
  }
}

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export default async function AdminPage() {
  const user = await wajibAdmin();
  const data = await ambilData();

  if (!data) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-sm">
        <h1 className="font-display text-xl font-bold">Admin</h1>
        <p className="mt-2 text-zinc-600">
          Postgres tidak aktif di lingkungan ini — halaman ini hanya berguna di produksi.
        </p>
      </main>
    );
  }

  const { job, ringkas, kredit } = data;
  const gagal = job.filter((j) => j.state === "FAILED");

  return (
    <main className="mx-auto max-w-5xl space-y-6 p-6">
      <header>
        <h1 className="font-display text-xl font-bold text-zinc-900">Admin</h1>
        <p className="text-xs text-zinc-500">
          Masuk sebagai {user.email} · baca saja, tidak ada aksi yang mengubah data
        </p>
      </header>

      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <div className="rounded-xl border border-zinc-200 p-3">
          <p className="text-[11px] uppercase tracking-wide text-zinc-500">Top-up</p>
          <p className="font-display text-lg font-bold">{rupiah(Number(kredit?.total ?? 0))}</p>
          <p className="text-[11px] text-zinc-500">{kredit?.n ?? 0} pembeli</p>
        </div>
        {ringkas.slice(0, 3).map((r) => (
          <div key={r.state} className="rounded-xl border border-zinc-200 p-3">
            <p className="text-[11px] uppercase tracking-wide text-zinc-500">{r.state}</p>
            <p className="font-display text-lg font-bold">{r.n}</p>
            <p className="text-[11px] text-zinc-500">7 hari terakhir</p>
          </div>
        ))}
      </section>

      {gagal.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-base font-bold text-red-700">
            Job gagal ({gagal.length} dari 40 terakhir)
          </h2>
          <ul className="space-y-1">
            {gagal.map((j) => (
              <li key={j.id} className="rounded-lg border border-red-200 bg-red-50 p-3 text-xs">
                <div className="flex justify-between gap-2">
                  <span className="font-mono">{j.id.slice(0, 8)}</span>
                  <span className="text-zinc-600">{j.email ?? "—"}</span>
                </div>
                <p className="mt-1 text-red-800">{alasanGagal(j.qc_result) || "tanpa alasan tercatat"}</p>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="font-display text-base font-bold text-zinc-900">40 job terakhir</h2>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-xs">
            <thead>
              <tr className="border-b border-zinc-300 text-left">
                <th className="p-2">Job</th><th className="p-2">User</th><th className="p-2">Format</th>
                <th className="p-2">Tier</th><th className="p-2">State</th><th className="p-2">Dibuat</th>
              </tr>
            </thead>
            <tbody>
              {job.map((j) => (
                <tr key={j.id} className="border-b border-zinc-100">
                  <td className="p-2 font-mono">{j.id.slice(0, 8)}</td>
                  <td className="p-2 text-zinc-600">{j.email ?? "—"}</td>
                  <td className="p-2">{j.format}</td>
                  <td className="p-2">{j.quality_tier}</td>
                  <td className={`p-2 font-bold ${j.state === "FAILED" ? "text-red-700" : j.state === "READY" ? "text-green-700" : "text-zinc-600"}`}>
                    {j.state}
                  </td>
                  <td className="p-2 text-zinc-500">{new Date(j.created_at).toLocaleString("id-ID")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
