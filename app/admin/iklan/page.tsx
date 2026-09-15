import Link from "next/link";
import { wajibAdmin } from "@/lib/admin-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { PanelIklan } from "./PanelIklan";

// IKLAN SINEMATIK — BETA KHUSUS ADMIN.
//
// Format ini BELUM dijual dan belum muncul di mana pun untuk pengguna. Ia
// dipasang di sini justru supaya bisa dinilai lewat alur yang sebenarnya —
// antrean, worker, storage, pemutar yang sama — bukan lewat skrip di laptop.
//
// Yang perlu diingat saat membacanya: review independen terakhir (14 Sep 2026)
// memberi Reject di kisaran 4/10 terhadap referensi Blueprint. Jadi halaman ini
// bukan pengumuman bahwa formatnya siap; ia alat untuk membuktikan kapan siap.

export const dynamic = "force-dynamic";

export default async function HalamanIklanBeta() {
  const user = await wajibAdmin();

  if (!postgresRuntimeEnabled()) {
    return (
      <main className="mx-auto max-w-3xl p-6 text-sm">
        <h1 className="font-display text-xl font-bold">Iklan Sinematik (beta)</h1>
        <p className="mt-2 text-zinc-600">Postgres tidak aktif — beta ini jalan lewat worker Postgres.</p>
      </main>
    );
  }

  return (
    <main className="mx-auto max-w-4xl space-y-5 p-4 sm:p-6">
      <header className="space-y-1">
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="font-display text-xl font-bold text-zinc-900">Iklan Sinematik <span className="align-middle text-xs font-semibold text-amber-700">BETA</span></h1>
          <Link href="/admin" className="text-xs font-semibold text-amber-700 underline underline-offset-2">← kembali ke admin</Link>
        </div>
        <p className="text-xs text-zinc-500">Masuk sebagai {user.email} · format <code>iklan_sinematik</code>, 30 detik, ≥8 shot</p>
      </header>

      <div className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-xs leading-5 text-amber-900">
        <b>Belum siap dijual.</b> Review independen terakhir menilai hasilnya <b>Reject (±4/10)</b> terhadap
        referensi. Render di sini <b>tidak memotong kredit</b> siapa pun, tapi biaya providernya nyata:
        ±Rp25 rb (standard) dan ±Rp60 rb (ultra) per video. Maksimal 2 render berjalan bersamaan.
      </div>

      <PanelIklan />
    </main>
  );
}
