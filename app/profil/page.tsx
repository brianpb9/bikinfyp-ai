import Link from "next/link";
import { redirect } from "next/navigation";
import { getAuthUserFromCookies } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { config } from "@/lib/config";
import { TOPUP_PACKAGES } from "@/lib/credits";

// PROFIL — satu tempat untuk pertanyaan "punyaku sekarang apa?".
//
// Sebelumnya jawabannya tersebar: saldo di /kredit, video di /video, riwayat
// pembelian tidak di mana-mana, dan data akun hanya muncul sebagai satu baris
// di menu pojok. Orang yang ingin tahu apakah pembayarannya kemarin masuk
// harus menebak halaman mana yang menyimpannya.

export const dynamic = "force-dynamic";

const rupiah = (n: number) => `Rp${Math.round(n).toLocaleString("id-ID")}`;

function tanggal(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso.slice(0, 16)
    : d.toLocaleString("id-ID", { dateStyle: "medium", timeStyle: "short" });
}

const LABEL_STATUS: Record<string, { teks: string; kelas: string }> = {
  paid: { teks: "Lunas", kelas: "bg-emerald-50 text-emerald-700" },
  sandbox_paid: { teks: "Lunas (uji)", kelas: "bg-sky-50 text-sky-700" },
  pending: { teks: "Menunggu", kelas: "bg-amber-50 text-amber-700" },
  failed: { teks: "Gagal", kelas: "bg-red-50 text-red-700" },
  cancelled: { teks: "Dibatalkan", kelas: "bg-zinc-100 text-zinc-500" },
};

const LABEL_JOB: Record<string, { teks: string; kelas: string }> = {
  DONE: { teks: "Selesai", kelas: "bg-emerald-50 text-emerald-700" },
  READY: { teks: "Siap", kelas: "bg-emerald-50 text-emerald-700" },
  FAILED: { teks: "Gagal", kelas: "bg-red-50 text-red-700" },
};

async function ambil(userId: string) {
  const pool = getPool(config.databaseUrl);
  const [saldo, jobs, bayar] = await Promise.all([
    pool.query<{ saldo: string }>(
      // Aturan yang SAMA dengan getBalance(): tanpa saldo organisasi.
      "SELECT COALESCE(SUM(delta),0)::text AS saldo FROM credit_ledger WHERE user_id = $1 AND org_id IS NULL",
      [userId],
    ),
    pool.query<{ id: string; state: string; format: string; quality_tier: string; created_at: string }>(
      `SELECT id, state, format, quality_tier, created_at FROM jobs
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId],
    ),
    pool.query<{ created_at: string; gateway_ref: string; amount_idr: number; status: string; raw_payload: string | null }>(
      `SELECT created_at, gateway_ref, amount_idr, status, raw_payload FROM payments
        WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId],
    ),
  ]);
  return { saldo: Number(saldo.rows[0]?.saldo ?? 0), jobs: jobs.rows, bayar: bayar.rows };
}

function paketDari(raw: string | null): string | null {
  if (!raw) return null;
  try {
    const id = (JSON.parse(raw) as { package_id?: string }).package_id;
    return TOPUP_PACKAGES.find((p) => p.id === id)?.name ?? id ?? null;
  } catch {
    return null;
  }
}

export default async function HalamanProfil() {
  const user = await getAuthUserFromCookies();
  if (!user) redirect("/onboarding?daftar=1");

  if (!postgresRuntimeEnabled()) {
    return (
      <main className="mx-auto max-w-md p-6 text-sm">
        <h1 className="font-display text-xl font-bold">Profil</h1>
        <p className="mt-2 text-zinc-600">Halaman ini butuh Postgres aktif.</p>
      </main>
    );
  }

  const { saldo, jobs, bayar } = await ambil(user.id);
  const lunasTerakhir = bayar.find((b) => b.status === "paid");
  const paketAktif = lunasTerakhir ? paketDari(lunasTerakhir.raw_payload) : null;

  return (
    <main className="mx-auto max-w-md space-y-5 p-4 pb-8">
      <header>
        <h1 className="font-display text-2xl font-extrabold text-zinc-900">Profil</h1>
        <p className="text-sm text-zinc-500">{user.email ?? user.phone ?? "Akun saya"}</p>
      </header>

      {/* Saldo & paket */}
      <section className="rounded-2xl bg-zinc-900 p-4 text-white">
        <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-zinc-400">Sisa saldo</p>
        <p className="font-display text-3xl font-extrabold tabular-nums">{rupiah(saldo)}</p>
        <p className="mt-1 text-xs text-zinc-400">
          {paketAktif ? `Pembelian terakhir: ${paketAktif}` : "Belum ada pembelian"}
        </p>
        <Link
          href="/kredit"
          className="mt-3 flex min-h-[44px] w-full items-center justify-center rounded-xl bg-amber-500 font-bold text-zinc-950"
        >
          Isi ulang
        </Link>
      </section>

      {/* Data akun */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Data akun</h2>
        <dl className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white px-4">
          <Baris k="Email" v={user.email ?? "—"} />
          <Baris k="Nama" v={user.name ?? "—"} />
          <Baris k="Nomor HP" v={user.phone ?? "—"} />
          <Baris k="Bergabung" v={tanggal(user.created_at)} />
        </dl>

        {/* TIDAK ADA "RESET PASSWORD", dan itu bukan fitur yang terlupa.
            Masuk ke BikinFYP memakai kode sekali-pakai yang dikirim ke email —
            tidak ada password yang disimpan, jadi tidak ada yang bisa direset,
            bocor, atau dipakai ulang. Menaruh tombol "reset password" di sini
            akan menjanjikan pengamanan yang tidak ada bendanya. */}
        <div className="rounded-2xl border border-zinc-200 bg-zinc-50 p-3 text-xs leading-5 text-zinc-600">
          <b>Akun ini tanpa password.</b> Setiap kali masuk, kami kirim kode sekali-pakai
          ke {user.email ?? "email kamu"}. Tidak ada password yang bisa bocor atau perlu diganti —
          yang perlu kamu jaga cuma akses ke email itu sendiri.
        </div>
      </section>

      {/* Riwayat pembelian */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Riwayat pembelian</h2>
        {bayar.length === 0 ? (
          <Kosong pesan="Belum ada pembelian." />
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
            {bayar.map((b) => {
              const s = LABEL_STATUS[b.status] ?? { teks: b.status, kelas: "bg-zinc-100 text-zinc-600" };
              return (
                <li key={b.gateway_ref} className="flex items-center justify-between gap-3 p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-zinc-900">
                      {paketDari(b.raw_payload) ?? "Top-up"}
                    </span>
                    <span className="block text-[11px] text-zinc-400">{tanggal(b.created_at)}</span>
                  </span>
                  <span className="shrink-0 text-right">
                    <span className="block text-sm font-bold tabular-nums">{rupiah(b.amount_idr)}</span>
                    <span className={`mt-0.5 inline-block rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.kelas}`}>
                      {s.teks}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {/* Riwayat generate */}
      <section className="space-y-2">
        <h2 className="text-sm font-bold text-zinc-900">Riwayat video</h2>
        {jobs.length === 0 ? (
          <Kosong pesan="Belum ada video dibuat." />
        ) : (
          <ul className="divide-y divide-zinc-100 rounded-2xl border border-zinc-200 bg-white">
            {jobs.map((j) => {
              const s = LABEL_JOB[j.state] ?? { teks: j.state, kelas: "bg-amber-50 text-amber-700" };
              return (
                <li key={j.id} className="flex items-center justify-between gap-3 p-3">
                  <span className="min-w-0">
                    <span className="block text-sm font-semibold text-zinc-900">{j.quality_tier}</span>
                    <span className="block text-[11px] text-zinc-400">
                      {j.format} · {tanggal(j.created_at)}
                    </span>
                  </span>
                  <span className={`shrink-0 rounded px-1.5 py-0.5 text-[11px] font-semibold ${s.kelas}`}>{s.teks}</span>
                </li>
              );
            })}
          </ul>
        )}
        <Link href="/video" className="block text-center text-sm font-semibold text-amber-700 underline underline-offset-4">
          Lihat semua video
        </Link>
      </section>
    </main>
  );
}

function Baris({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-3 text-sm">
      <dt className="text-zinc-500">{k}</dt>
      <dd className="min-w-0 truncate font-medium text-zinc-900">{v}</dd>
    </div>
  );
}

function Kosong({ pesan }: { pesan: string }) {
  return (
    <p className="rounded-2xl border border-dashed border-zinc-300 p-5 text-center text-sm text-zinc-500">{pesan}</p>
  );
}
