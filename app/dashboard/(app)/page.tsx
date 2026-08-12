import Link from "next/link";
import { ArrowRight, Eye, Film, Plus, Sparkles, Wallet } from "lucide-react";
import { requireOrgContext } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled } from "@/lib/postgres/smoke-runtime";
import { getOrgBalance } from "@/lib/org";
import { pgGetOrgBalance, pgGetOrgVideoStats, pgListRecentBulkRuns, pgListRecentVideos, type OrgVideoStats, type RecentBulkRun } from "@/lib/postgres/org";
import { formatTokens } from "../_components/format";
import { createSignedUrl } from "@/lib/signed-url";
import { campaignKindLabel, campaignFormatLabel } from "../_components/campaign-kind";
import { CampaignThumb } from "../_components/CampaignThumb";
import { BTN_PRIMARY } from "@/app/dashboard/_components/buttons";

export const dynamic = "force-dynamic";

const EMPTY_STATS: OrgVideoStats = { total: 0, ready: 0, awaiting_review: 0, spent_idr: 0 };

// Beranda org (M2-M4, dirombak 2026-08-11 atas masukan Brian: "bagian home
// visualnya juga harus di perbaiki, kampaye terakhir mungkin tidak seperti
// itu visualnya").
//
// Versi lama menampilkan kampanye sebagai baris teks polos berisi tanggal dan
// "2/3 siap" — tidak ada gambar sama sekali, padahal isi kampanye ADALAH
// gambar. Sekarang tiap kampanye tampil sebagai kartu dengan thumbnail scene
// pertama, nama produk, dan ajakan bertindak kalau ada yang menunggu ditinjau.
//
// Kartu analisis bisnis dipindah ke tab Profil: itu data yang diisi sekali
// lalu jarang disentuh, dan kehadirannya di layar kerja harian membuat hal
// yang penting (bikin video, lihat hasil) terdorong ke bawah lipatan.
export default async function DashboardHomePage() {
  const { membership } = await requireOrgContext();
  const pg = postgresRuntimeEnabled();
  const balance = pg ? await pgGetOrgBalance(membership.org_id) : getOrgBalance(membership.org_id);
  const stats = pg ? await pgGetOrgVideoStats(membership.org_id) : EMPTY_STATS;
  // Bulk-generate hanya jalan di runtime Postgres (lihat guard di route API-nya)
  // — dev SQLite selalu kosong di sini.
  const recentRuns: RecentBulkRun[] = pg ? await pgListRecentBulkRuns(membership.org_id) : [];
  const recentVideos = pg ? await pgListRecentVideos(membership.org_id) : [];

  return (
    <div className="space-y-8">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">{membership.org_name}</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Beranda</h1>
      </div>

      {/* Ajakan utama — satu aksi jelas, tidak bersaing dengan apa pun. */}
      <section className="flex flex-wrap items-center justify-between gap-6 rounded-2xl bg-gradient-to-br from-zinc-900 to-zinc-950 p-6 shadow-sm">
        <div className="min-w-0">
          <h2 className="font-display text-xl font-bold text-white">Bikin video baru</h2>
          <p className="mt-1 max-w-md text-sm text-zinc-400">
            Masukkan produknya, kami pilihkan formatnya dari kategori dan harganya —
            atau atur sendiri kalau kamu sudah punya konsepnya.
          </p>
        </div>
        {/* DUA jalur, bukan satu menggantikan yang lain. "Bikinin aja" untuk
            yang sudah tahu mau apa dan tidak mau mengatur lima layar; "Atur
            sendiri" tetap membuka seluruh pilihan seperti sebelumnya. */}
        <div className="flex shrink-0 flex-wrap items-center gap-3">
          <Link
            href="/dashboard/campaign?auto=1"
            className={BTN_PRIMARY}
          >
            <Sparkles size={16} /> Bikinin aja
          </Link>
          <Link
            href="/dashboard/campaign"
            className="inline-flex items-center gap-2 rounded-xl border border-zinc-700 px-5 py-3 text-sm font-semibold text-zinc-200 transition-colors hover:border-zinc-500 hover:text-white"
          >
            <Plus size={15} /> Atur sendiri
          </Link>
        </div>
      </section>

      <section className="grid grid-cols-3 gap-4">
        <Link href="/dashboard/credits" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-amber-400">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Wallet size={12} /> Token organisasi
          </p>
          {/* Angkanya saja — kata "token" sudah ada di label tepat di atasnya,
              dan mengulangnya membuat saldo tujuh digit terpotong jadi
              "3.000.000 tok…" di kartu selebar sepertiga. Angka yang tidak
              terbaca utuh lebih buruk daripada satuan yang tidak diulang. */}
          <p className="mt-2 truncate font-display text-3xl font-bold text-zinc-900">{formatTokens(balance)}</p>
          {/* Angka token itu satuan internal kami, bukan bahasa brand. Yang
              mereka putuskan adalah "cukup untuk berapa video lagi" — jadi
              itu yang ditulis, bukan menyuruh mereka membaginya sendiri. */}
          <p className="mt-0.5 text-xs text-zinc-500">± {Math.floor(balance / 12_000)} video 15 detik</p>
          <p className="mt-1 text-xs font-semibold text-amber-600">Tambah token</p>
        </Link>
        <Link href="/dashboard/library" className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm transition-colors hover:border-amber-400">
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Film size={12} /> Video siap
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-zinc-900">{stats.ready}</p>
          <p className="mt-1 text-xs font-semibold text-amber-600">Buka library</p>
        </Link>
        <Link
          href="/dashboard/library?filter=review"
          className={`rounded-2xl border p-5 shadow-sm transition-colors ${
            stats.awaiting_review > 0 ? "border-amber-400 bg-amber-50" : "border-zinc-200 bg-white hover:border-amber-400"
          }`}
        >
          <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-zinc-500">
            <Eye size={12} /> Perlu ditinjau
          </p>
          <p className="mt-2 font-display text-3xl font-bold text-zinc-900">{stats.awaiting_review}</p>
          {stats.awaiting_review > 0 && <p className="mt-1 text-xs font-semibold text-amber-700">Tinjau sekarang</p>}
        </Link>
      </section>

      {/* VIDEO TERBARU di atas daftar kampanye. Yang dibeli brand adalah
          videonya; kampanye cuma map untuk menemukannya. Beranda yang isinya
          angka dan folder terasa kosong justru karena hasilnya tidak pernah
          kelihatan tanpa masuk dua halaman lagi. */}
      {recentVideos.length > 0 && (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <h2 className="text-sm font-bold text-zinc-900">Video terbaru</h2>
            <Link href="/dashboard/library" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700">
              Semua video <ArrowRight size={13} />
            </Link>
          </div>
          <ul className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
            {recentVideos.map((v) => (
              <li key={v.job_id}>
                <Link href="/dashboard/library" className="group block" title={v.caption ?? v.product_name}>
                  <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-zinc-900">
                    <video
                      src={createSignedUrl(v.video_key)}
                      preload="metadata" muted playsInline
                      className="absolute inset-0 h-full w-full object-cover opacity-90 transition-opacity group-hover:opacity-100"
                    />
                    {campaignFormatLabel(v.format) && (
                      <span className="absolute left-1.5 top-1.5 rounded-md bg-black/65 px-1.5 py-0.5 text-[9px] font-bold text-white backdrop-blur">
                        {campaignFormatLabel(v.format)}
                      </span>
                    )}
                  </div>
                  <p className="mt-1.5 truncate text-[11px] font-medium text-zinc-600">{v.product_name}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      )}

      <section className="space-y-3">
        <div className="flex items-center justify-between">
          <h2 className="text-sm font-bold text-zinc-900">Kampanye terakhir</h2>
          <Link href="/dashboard/library" className="inline-flex items-center gap-1 text-xs font-semibold text-amber-600 hover:text-amber-700">
            Lihat semua <ArrowRight size={13} />
          </Link>
        </div>
        {recentRuns.length === 0 ? (
          <div className="flex flex-col items-center gap-2 rounded-2xl border border-dashed border-zinc-300 bg-white p-10 text-center">
            <Sparkles size={22} className="text-zinc-300" />
            <p className="text-sm text-zinc-500">Belum ada kampanye.</p>
            <Link href="/dashboard/campaign" className="inline-flex items-center gap-1 text-sm font-semibold text-amber-600 hover:text-amber-700">
              Mulai yang pertama <ArrowRight size={14} />
            </Link>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {recentRuns.map((run) => {
              const pct = run.total > 0 ? Math.round((run.ready_count / run.total) * 100) : 0;
              return (
                <li key={run.bulk_run_id}>
                  <Link
                    href={`/dashboard/campaign/${run.bulk_run_id}`}
                    className="group flex h-full flex-col overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                  >
                    {/* overflow-hidden + absolute inset-0 WAJIB di sini. Dengan
                        <img className="h-full">, tinggi 100% diukur terhadap
                        induk yang tingginya belum tentu — browser menyerah ke
                        auto, gambar dirender seukuran aslinya (potret 9:16),
                        dan kotaknya ikut molor jadi hampir 3x tinggi yang
                        diminta. aspect-ratio kalah oleh konten yang meluap. */}
                    <div className="relative aspect-[16/10] w-full overflow-hidden bg-zinc-900">
                      <CampaignThumb thumbKey={run.thumb_key} videoKey={run.video_key} />
                      {/* Jenis kampanye di kanan atas — kiri sudah dipakai
                          lencana status, dan menumpuk keduanya di sisi yang
                          sama membuat nama produk ikut tertutup. */}
                      <span className="absolute right-3 top-3 rounded-full bg-black/60 px-2.5 py-1 text-[10px] font-bold text-white backdrop-blur">
                        {campaignKindLabel(run.format)}
                      </span>
                      {run.review_count > 0 && (
                        <span className="absolute left-3 top-3 inline-flex items-center gap-1 rounded-full bg-amber-500 px-2.5 py-1 text-[10px] font-bold text-zinc-950">
                          <Eye size={10} /> {run.review_count} perlu ditinjau
                        </span>
                      )}
                    </div>
                    <div className="flex flex-1 flex-col p-4">
                      <p className="truncate text-sm font-bold text-zinc-900">{run.product_name ?? "Kampanye"}</p>
                      <p className="mt-0.5 text-xs text-zinc-500">
                        {new Date(run.created_at).toLocaleDateString("id-ID", { day: "numeric", month: "short", year: "numeric" })}
                        {campaignFormatLabel(run.format) && (
                          <>
                            <span className="mx-1.5 text-zinc-300">·</span>
                            {campaignFormatLabel(run.format)}
                          </>
                        )}
                      </p>
                      <div className="mt-auto pt-3">
                        <div className="h-1.5 w-full overflow-hidden rounded-full bg-zinc-100">
                          <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${pct}%` }} />
                        </div>
                        <p className="mt-1.5 text-xs font-semibold text-zinc-600">{run.ready_count}/{run.total} siap</p>
                      </div>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
