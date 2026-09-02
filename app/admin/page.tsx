import Link from "next/link";
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
// memaksa membuka terminal.
//
// Begitu ada operator kedua atau refund manual jadi rutin, barulah peran dan
// tombol layak dibangun — dengan audit log, bukan tanpa.
//
// ────────────────────────────────────────────────────────────────────────────
// SEMUA KOLOM WAKTU BERTIPE TEXT (ISO-8601), BUKAN timestamptz.
// Jadi batas waktu SELALU dihitung di JS lalu dikirim sebagai parameter.
// `created_at > NOW() - INTERVAL '7 days'` menjatuhkan SELURUH halaman dengan
// "operator does not exist: text > timestamp with time zone" — itu persis yang
// terjadi 2 Sep 2026, dan tests/admin-query.test.ts menjaganya agar tidak
// kembali.
// ────────────────────────────────────────────────────────────────────────────

export const dynamic = "force-dynamic";

const TAB = [
  { id: "ringkasan", label: "Ringkasan" },
  { id: "keuangan", label: "Keuangan" },
  { id: "pengguna", label: "Pengguna" },
  { id: "pesanan", label: "Pesanan" },
  { id: "pemakaian", label: "Pemakaian" },
  { id: "job", label: "Job" },
] as const;

type IdTab = (typeof TAB)[number]["id"];

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;
const angka = (n: number) => n.toLocaleString("id-ID");
const sejakHari = (n: number) => new Date(Date.now() - n * 24 * 60 * 60_000).toISOString();

function tanggal(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 16)
    : d.toLocaleString("id-ID", { dateStyle: "short", timeStyle: "short" });
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

/* ── data ─────────────────────────────────────────────────────────────── */

async function ambilRingkasan() {
  const pool = getPool(config.databaseUrl);
  const [pengguna, uang, job, biaya, gratis] = await Promise.all([
    pool.query<{ total: string; baru: string }>(
      `SELECT COUNT(*)::text AS total,
              COUNT(*) FILTER (WHERE created_at > $1)::text AS baru
         FROM users`,
      [sejakHari(30)],
    ),
    pool.query<{ pendapatan: string; transaksi: string; pembeli: string }>(
      `SELECT COALESCE(SUM(amount_idr),0)::text AS pendapatan,
              COUNT(*)::text AS transaksi,
              COUNT(DISTINCT user_id)::text AS pembeli
         FROM payments WHERE status = 'paid'`,
    ),
    pool.query<{ state: string; n: string }>(
      `SELECT state, COUNT(*)::text AS n FROM jobs
        WHERE created_at > $1 GROUP BY state ORDER BY 2 DESC`,
      [sejakHari(7)],
    ),
    pool.query<{ cogs: string; selesai: string }>(
      `SELECT COALESCE(SUM(cost_actual_idr),0)::text AS cogs,
              COUNT(*) FILTER (WHERE state = 'DONE')::text AS selesai
         FROM jobs`,
    ),
    // BIAYA PAKET GRATIS. Setiap pendaftar baru menerima bonus senilai satu
    // video, dan itu uang yang benar-benar keluar dari kas — bukan diskon.
    // Ditampilkan supaya ia terlihat sejak orang pertama mendaftar, bukan
    // mengejutkan di tagihan BytePlus akhir bulan.
    // Dihitung dari kredit_video, bukan credit_ledger: sejak paket gratis
    // berupa JATAH VIDEO, baris bonus rupiah berhenti bertambah — dan kartu
    // yang membaca tabel lama akan diam di angka bersejarah sementara
    // pendaftar baru terus menerima jatah. Kartu yang diam di angka lama lebih
    // berbahaya daripada kartu kosong: ia terlihat seperti kabar baik.
    pool.query<{ video: string; penerima: string }>(
      `SELECT COALESCE(SUM(delta),0)::text AS video,
              COUNT(DISTINCT user_id)::text AS penerima
         FROM kredit_video WHERE tipe = 'bonus'`,
    ),
  ]);
  return {
    pengguna: pengguna.rows[0],
    uang: uang.rows[0],
    job: job.rows,
    biaya: biaya.rows[0],
    gratis: gratis.rows[0],
  };
}

async function ambilKeuangan() {
  const pool = getPool(config.databaseUrl);
  const [bulanan, gateway, ledger] = await Promise.all([
    // substr, bukan date_trunc: kolomnya TEXT, dan ISO-8601 selalu "YYYY-MM".
    pool.query<{ bulan: string; pendapatan: string; transaksi: string }>(
      `SELECT substr(created_at,1,7) AS bulan,
              COALESCE(SUM(amount_idr),0)::text AS pendapatan,
              COUNT(*)::text AS transaksi
         FROM payments WHERE status = 'paid'
        GROUP BY 1 ORDER BY 1 DESC LIMIT 12`,
    ),
    pool.query<{ gateway: string; status: string; n: string; total: string }>(
      `SELECT gateway, status, COUNT(*)::text AS n, COALESCE(SUM(amount_idr),0)::text AS total
         FROM payments GROUP BY 1,2 ORDER BY 1,2`,
    ),
    pool.query<{ type: string; n: string; total: string }>(
      `SELECT type, COUNT(*)::text AS n, COALESCE(SUM(delta),0)::text AS total
         FROM credit_ledger GROUP BY 1 ORDER BY 3 DESC`,
    ),
  ]);
  return { bulanan: bulanan.rows, gateway: gateway.rows, ledger: ledger.rows };
}

async function ambilPengguna() {
  const pool = getPool(config.databaseUrl);
  // Saldo retail = SUM(delta) WHERE org_id IS NULL — aturan yang SAMA PERSIS
  // dengan getBalance() di lib/credits.ts. Menghitungnya beda di sini berarti
  // admin menampilkan saldo yang tidak pernah dilihat penggunanya.
  const { rows } = await pool.query<{
    id: string;
    email: string | null;
    name: string | null;
    created_at: string;
    saldo: string;
    jobs: string;
    job_terakhir: string | null;
  }>(
    `SELECT u.id, u.email, u.name, u.created_at,
            COALESCE((SELECT SUM(delta) FROM credit_ledger c
                       WHERE c.user_id = u.id AND c.org_id IS NULL),0)::text AS saldo,
            (SELECT COUNT(*) FROM jobs j WHERE j.user_id = u.id)::text AS jobs,
            (SELECT MAX(j.created_at) FROM jobs j WHERE j.user_id = u.id) AS job_terakhir
       FROM users u ORDER BY u.created_at DESC LIMIT 200`,
  );
  return rows;
}

async function ambilPesanan() {
  const pool = getPool(config.databaseUrl);
  const { rows } = await pool.query<{
    created_at: string;
    email: string | null;
    gateway: string;
    gateway_ref: string;
    amount_idr: number;
    status: string;
  }>(
    `SELECT p.created_at, u.email, p.gateway, p.gateway_ref, p.amount_idr, p.status
       FROM payments p LEFT JOIN users u ON u.id = p.user_id
      ORDER BY p.created_at DESC LIMIT 100`,
  );
  return rows;
}

async function ambilPemakaian() {
  const pool = getPool(config.databaseUrl);
  const { rows } = await pool.query<{
    email: string | null;
    n: string;
    selesai: string;
    gagal: string;
    cogs: string;
    tier: string | null;
  }>(
    `SELECT u.email,
            COUNT(j.id)::text AS n,
            COUNT(*) FILTER (WHERE j.state = 'DONE')::text AS selesai,
            COUNT(*) FILTER (WHERE j.state = 'FAILED')::text AS gagal,
            COALESCE(SUM(j.cost_actual_idr),0)::text AS cogs,
            (SELECT j2.quality_tier FROM jobs j2 WHERE j2.user_id = j.user_id
              GROUP BY j2.quality_tier ORDER BY COUNT(*) DESC LIMIT 1) AS tier
       FROM jobs j LEFT JOIN users u ON u.id = j.user_id
      GROUP BY u.email, j.user_id ORDER BY 2 DESC LIMIT 100`,
  );
  return rows;
}

async function ambilJob() {
  const pool = getPool(config.databaseUrl);
  const { rows } = await pool.query<{
    id: string;
    state: string;
    format: string;
    quality_tier: string;
    created_at: string;
    completed_at: string | null;
    qc_result: string | null;
    email: string | null;
    cost_actual_idr: number | null;
  }>(
    `SELECT j.id, j.state, j.format, j.quality_tier, j.created_at, j.completed_at,
            j.qc_result, j.cost_actual_idr, u.email
       FROM jobs j LEFT JOIN users u ON u.id = j.user_id
      ORDER BY j.created_at DESC LIMIT 60`,
  );
  return rows;
}

/* ── potongan tampilan ────────────────────────────────────────────────── */

function Kartu({ label, nilai, catatan }: { label: string; nilai: string; catatan?: string }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-3">
      <p className="text-[11px] uppercase tracking-wide text-zinc-500">{label}</p>
      <p className="font-display text-lg font-bold tabular-nums text-zinc-900">{nilai}</p>
      {catatan && <p className="text-[11px] text-zinc-500">{catatan}</p>}
    </div>
  );
}

function Tabel({ kepala, children }: { kepala: string[]; children: React.ReactNode }) {
  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-200 bg-white">
      <table className="w-full min-w-[42rem] text-left text-xs">
        <thead className="bg-zinc-50 text-[11px] uppercase tracking-wide text-zinc-500">
          <tr>
            {kepala.map((h) => (
              <th key={h} className="whitespace-nowrap p-2 font-semibold">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-zinc-100">{children}</tbody>
      </table>
    </div>
  );
}

function Lencana({ status }: { status: string }) {
  const warna =
    status === "paid" || status === "DONE"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed" || status === "FAILED"
        ? "bg-red-50 text-red-700"
        : "bg-amber-50 text-amber-700";
  return <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${warna}`}>{status}</span>;
}

function Kosong({ pesan }: { pesan: string }) {
  return (
    <p className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-500">{pesan}</p>
  );
}

/* ── halaman ──────────────────────────────────────────────────────────── */

export default async function AdminPage({ searchParams }: { searchParams: Promise<{ tab?: string }> }) {
  const user = await wajibAdmin();
  const { tab } = await searchParams;
  const aktif: IdTab = TAB.find((t) => t.id === tab)?.id ?? "ringkasan";

  if (!postgresRuntimeEnabled()) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-sm">
        <h1 className="font-display text-xl font-bold">Admin</h1>
        <p className="mt-2 text-zinc-600">
          Postgres tidak aktif di lingkungan ini — halaman ini hanya berguna di produksi.
        </p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-6xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <h1 className="font-display text-xl font-bold text-zinc-900">Admin</h1>
        <p className="text-xs text-zinc-500">
          Masuk sebagai {user.email} · <b>baca saja</b> — tidak ada aksi yang mengubah data
        </p>
      </header>

      <nav className="flex flex-wrap gap-1.5">
        {TAB.map((t) => (
          <Link
            key={t.id}
            href={`/admin?tab=${t.id}`}
            className={`rounded-lg px-3 py-1.5 text-sm font-semibold transition-colors ${
              aktif === t.id ? "bg-zinc-900 text-white" : "bg-zinc-100 text-zinc-600 hover:bg-zinc-200"
            }`}
          >
            {t.label}
          </Link>
        ))}
      </nav>

      {aktif === "ringkasan" && <Ringkasan />}
      {aktif === "keuangan" && <Keuangan />}
      {aktif === "pengguna" && <Pengguna />}
      {aktif === "pesanan" && <Pesanan />}
      {aktif === "pemakaian" && <Pemakaian />}
      {aktif === "job" && <Job />}
    </main>
  );
}

async function Ringkasan() {
  const { pengguna, uang, job, biaya, gratis } = await ambilRingkasan();
  const pendapatan = Number(uang?.pendapatan ?? 0);
  const cogs = Number(biaya?.cogs ?? 0);
  const margin = pendapatan - cogs;
  const persen = pendapatan > 0 ? Math.round((margin / pendapatan) * 100) : 0;

  return (
    <div className="space-y-4">
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Kartu
          label="Pendapatan"
          nilai={rupiah(pendapatan)}
          catatan={`${angka(Number(uang?.transaksi ?? 0))} transaksi lunas · ${angka(Number(uang?.pembeli ?? 0))} pembeli`}
        />
        <Kartu label="COGS terpakai" nilai={rupiah(cogs)} catatan={`${angka(Number(biaya?.selesai ?? 0))} job selesai`} />
        <Kartu
          label="Margin kotor"
          nilai={rupiah(margin)}
          catatan={pendapatan > 0 ? `${persen}% dari pendapatan` : "belum ada pendapatan"}
        />
        <Kartu
          label="Pengguna"
          nilai={angka(Number(pengguna?.total ?? 0))}
          catatan={`${angka(Number(pengguna?.baru ?? 0))} baru 30 hari`}
        />
        <Kartu
          label="Video gratis diberikan"
          nilai={angka(Number(gratis?.video ?? 0))}
          catatan={`${angka(Number(gratis?.penerima ?? 0))} pendaftar dapat paket gratis`}
        />
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Job 7 hari terakhir</h2>
        {job.length === 0 ? (
          <Kosong pesan="Belum ada job dalam 7 hari terakhir." />
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {job.map((r) => (
              <Kartu key={r.state} label={r.state} nilai={angka(Number(r.n))} />
            ))}
          </div>
        )}
      </section>

      {/* Angka margin di atas MEMBANDINGKAN DUA HAL YANG SAMA JANGKAUANNYA —
          pendapatan sepanjang masa terhadap COGS sepanjang masa. Itu sah
          sebagai gambaran kasar, tapi BUKAN laporan periode; menyebutnya
          "margin bulan ini" akan salah. Rincian per bulan ada di tab Keuangan. */}
      <p className="text-[11px] leading-5 text-zinc-500">
        Margin di atas dihitung sepanjang masa: pendapatan lunas dikurangi COGS seluruh job.
        Untuk pembacaan per periode, buka tab Keuangan.
      </p>
    </div>
  );
}

async function Keuangan() {
  const { bulanan, gateway, ledger } = await ambilKeuangan();
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Pendapatan per bulan</h2>
        {bulanan.length === 0 ? (
          <Kosong pesan="Belum ada pembayaran lunas." />
        ) : (
          <Tabel kepala={["Bulan", "Transaksi", "Pendapatan"]}>
            {bulanan.map((r) => (
              <tr key={r.bulan}>
                <td className="p-2 font-medium">{r.bulan}</td>
                <td className="p-2 tabular-nums">{angka(Number(r.transaksi))}</td>
                <td className="p-2 tabular-nums font-semibold">{rupiah(Number(r.pendapatan))}</td>
              </tr>
            ))}
          </Tabel>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Pembayaran per gateway &amp; status</h2>
        {gateway.length === 0 ? (
          <Kosong pesan="Belum ada pembayaran tercatat." />
        ) : (
          <Tabel kepala={["Gateway", "Status", "Jumlah", "Nilai"]}>
            {gateway.map((r) => (
              <tr key={`${r.gateway}-${r.status}`}>
                <td className="p-2">{r.gateway}</td>
                <td className="p-2"><Lencana status={r.status} /></td>
                <td className="p-2 tabular-nums">{angka(Number(r.n))}</td>
                <td className="p-2 tabular-nums">{rupiah(Number(r.total))}</td>
              </tr>
            ))}
          </Tabel>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Buku kredit</h2>
        {/* Ledger APPEND-ONLY: topup positif, hold negatif, release
            mengembalikan. Jumlah seluruh baris = saldo seluruh pengguna. */}
        {ledger.length === 0 ? (
          <Kosong pesan="Buku kredit masih kosong." />
        ) : (
          <Tabel kepala={["Jenis", "Baris", "Total delta"]}>
            {ledger.map((r) => (
              <tr key={r.type}>
                <td className="p-2">{r.type}</td>
                <td className="p-2 tabular-nums">{angka(Number(r.n))}</td>
                <td
                  className={`p-2 tabular-nums font-semibold ${
                    Number(r.total) < 0 ? "text-red-600" : "text-emerald-700"
                  }`}
                >
                  {rupiah(Number(r.total))}
                </td>
              </tr>
            ))}
          </Tabel>
        )}
      </section>
    </div>
  );
}

async function Pengguna() {
  const rows = await ambilPengguna();
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-zinc-900">Pengguna ({rows.length})</h2>
      {rows.length === 0 ? (
        <Kosong pesan="Belum ada pengguna terdaftar." />
      ) : (
        <Tabel kepala={["Email", "Nama", "Saldo", "Job", "Job terakhir", "Daftar"]}>
          {rows.map((u) => (
            <tr key={u.id}>
              <td className="p-2 font-medium">{u.email ?? "—"}</td>
              <td className="p-2 text-zinc-500">{u.name ?? "—"}</td>
              <td
                className={`p-2 tabular-nums font-semibold ${
                  Number(u.saldo) > 0 ? "text-emerald-700" : "text-zinc-400"
                }`}
              >
                {rupiah(Number(u.saldo))}
              </td>
              <td className="p-2 tabular-nums">{angka(Number(u.jobs))}</td>
              <td className="whitespace-nowrap p-2 text-zinc-500">{tanggal(u.job_terakhir)}</td>
              <td className="whitespace-nowrap p-2 text-zinc-500">{tanggal(u.created_at)}</td>
            </tr>
          ))}
        </Tabel>
      )}
      <p className="text-[11px] leading-5 text-zinc-500">
        Saldo dihitung dengan aturan yang sama persis dengan yang dilihat pengguna —
        jumlah delta buku kredit, tanpa saldo organisasi.
      </p>
    </section>
  );
}

async function Pesanan() {
  const rows = await ambilPesanan();
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-zinc-900">Riwayat pesanan ({rows.length})</h2>
      {rows.length === 0 ? (
        <Kosong pesan="Belum ada pesanan." />
      ) : (
        <Tabel kepala={["Waktu", "Email", "Gateway", "Referensi", "Nilai", "Status"]}>
          {rows.map((p) => (
            <tr key={p.gateway_ref}>
              <td className="whitespace-nowrap p-2 text-zinc-500">{tanggal(p.created_at)}</td>
              <td className="p-2">{p.email ?? "—"}</td>
              <td className="p-2">{p.gateway}</td>
              <td className="p-2 font-mono text-[11px] text-zinc-500">{p.gateway_ref}</td>
              <td className="p-2 tabular-nums font-semibold">{rupiah(p.amount_idr)}</td>
              <td className="p-2"><Lencana status={p.status} /></td>
            </tr>
          ))}
        </Tabel>
      )}
    </section>
  );
}

async function Pemakaian() {
  const rows = await ambilPemakaian();
  return (
    <section className="space-y-2">
      <h2 className="text-sm font-bold text-zinc-900">Pemakaian per klien</h2>
      {rows.length === 0 ? (
        <Kosong pesan="Belum ada job tercatat." />
      ) : (
        <Tabel kepala={["Email", "Job", "Selesai", "Gagal", "Tier utama", "COGS terpakai"]}>
          {rows.map((r, i) => (
            <tr key={`${r.email ?? "anon"}-${i}`}>
              <td className="p-2 font-medium">{r.email ?? "—"}</td>
              <td className="p-2 tabular-nums">{angka(Number(r.n))}</td>
              <td className="p-2 tabular-nums text-emerald-700">{angka(Number(r.selesai))}</td>
              <td className={`p-2 tabular-nums ${Number(r.gagal) > 0 ? "text-red-600" : "text-zinc-400"}`}>
                {angka(Number(r.gagal))}
              </td>
              <td className="p-2 text-zinc-500">{r.tier ?? "—"}</td>
              <td className="p-2 tabular-nums">{rupiah(Number(r.cogs))}</td>
            </tr>
          ))}
        </Tabel>
      )}
      <p className="text-[11px] leading-5 text-zinc-500">
        COGS diambil dari <code>cost_actual_idr</code> yang dicatat worker per job — biaya yang
        benar-benar terpakai, bukan taksiran dari daftar harga.
      </p>
    </section>
  );
}

async function Job() {
  const rows = await ambilJob();
  const gagal = rows.filter((j) => j.state === "FAILED");
  return (
    <div className="space-y-5">
      {gagal.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-bold text-red-700">Gagal terbaru ({gagal.length})</h2>
          <Tabel kepala={["Waktu", "Email", "Tier", "Alasan"]}>
            {gagal.map((j) => (
              <tr key={j.id}>
                <td className="whitespace-nowrap p-2 text-zinc-500">{tanggal(j.created_at)}</td>
                <td className="p-2">{j.email ?? "—"}</td>
                <td className="p-2">{j.quality_tier}</td>
                <td className="p-2 text-red-700">{alasanGagal(j.qc_result) || "tanpa qc_result"}</td>
              </tr>
            ))}
          </Tabel>
        </section>
      )}

      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Job terbaru ({rows.length})</h2>
        {rows.length === 0 ? (
          <Kosong pesan="Belum ada job." />
        ) : (
          <Tabel kepala={["Waktu", "Email", "Format", "Tier", "State", "COGS"]}>
            {rows.map((j) => (
              <tr key={j.id}>
                <td className="whitespace-nowrap p-2 text-zinc-500">{tanggal(j.created_at)}</td>
                <td className="p-2">{j.email ?? "—"}</td>
                <td className="p-2 text-zinc-500">{j.format}</td>
                <td className="p-2">{j.quality_tier}</td>
                <td className="p-2"><Lencana status={j.state} /></td>
                <td className="p-2 tabular-nums text-zinc-500">
                  {j.cost_actual_idr ? rupiah(j.cost_actual_idr) : "—"}
                </td>
              </tr>
            ))}
          </Tabel>
        )}
      </section>
    </div>
  );
}
