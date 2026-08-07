"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiFail } from "../_components/api";
import { ErrorText } from "../_components/ui";
import { loadFlow, rupiah, relTime } from "../_components/flow";

interface LedgerItem {
  id: string;
  delta: number;
  type: string;
  created_at: string;
}

// Nama paket berbasis manfaat + contoh visual per tier (2026-08-06: tester
// bingung "Senyap"; target user emak-emak — tunjukkan, jangan jelaskan).
// 2026-08-06: tier Teks+Musik pensiun — fokus persona bersuara.
const PACKAGES = [
  { id: "hq5", name: "5× AI Bersuara", price: 60_000, perVideo: "Rp12rb/video", tag: null, badge: "🎙️ AI-nya ngomong", voiced: true },
  { id: "hq10", name: "10× AI Bersuara", price: 120_000, perVideo: "Rp12rb/video", tag: "Paling laris", badge: "🎙️ AI-nya ngomong", voiced: true },
  { id: "super5", name: "5× AI Bersuara Pro", price: 400_000, perVideo: "Rp80rb/video", tag: null, badge: "🎙️ presenter ngomong asli, lip-sync sungguhan", voiced: true },
];

const LEDGER_LABEL: Record<string, string> = {
  topup: "Top-up",
  hold: "Bikin video (ditahan)",
  capture: "Bikin video (selesai)",
  release: "Refund (video gagal)",
  bonus: "Bonus",
};

// S9 — KREDIT & TOP-UP (denominasi rupiah, 3-tier final)
function KreditInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [balance, setBalance] = useState<number | null>(null);
  const [ledger, setLedger] = useState<LedgerItem[]>([]);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  // Riwayat: 5 teratas saja, sisanya di balik "Lihat selengkapnya" (Brian 2026-08-07).
  const [showAllLedger, setShowAllLedger] = useState(false);
  const checkoutLock = useRef(false);

  async function refresh() {
    try {
      const d = await apiFetch<{ balance: number; ledger: LedgerItem[] }>("/api/credits");
      setBalance(d.balance);
      setLedger(d.ledger);
    } catch {
      /* biarkan tampilan lama */
    }
  }
  useEffect(() => {
    refresh();
  }, []);

  async function topup(packageId: string) {
    // State disabled baru terlihat setelah render berikutnya; ref menutup celah
    // dua tap dalam frame yang sama agar tidak membuat dua intent Midtrans.
    if (checkoutLock.current) return;
    checkoutLock.current = true;
    setBusy(packageId);
    setMsg(null);
    setError(null);
    try {
      // Jalur utama: checkout Midtrans (Snap redirect). Bila gateway belum dipasang
      // kuncinya (mode demo tanpa key), jatuh ke topup instan dev.
      const res = await apiFetch<{ order_id: string; redirect_url: string }>("/api/credits/checkout", {
        json: { package_id: packageId },
      });
      setPendingOrder(res.order_id);
      setOrderStatus("pending");
      window.open(res.redirect_url, "_blank");
      setMsg("Order dibuat — selesaikan pembayaran di halaman Midtrans yang terbuka, lalu tap 'Sudah bayar? Cek status'.");
    } catch (err) {
      if (err instanceof ApiFail && err.code === "PAYMENT_NOT_CONFIGURED") {
        try {
          await apiFetch("/api/credits/topup", { json: { package_id: packageId } });
          setMsg("Pembayaran berhasil (mode demo — gateway online belum dipasang)");
          await refresh();
          // Balik otomatis ke titik alur terakhir (draft aman di sessionStorage)
          const target = params.get("return_to") ?? loadFlow().returnTo ?? "/";
          setTimeout(() => router.push(target), 900);
        } catch (err2) {
          setError(err2 instanceof Error ? err2.message : "Top-up gagal. Coba lagi ya.");
        }
      } else {
        setError(err instanceof ApiFail ? err.message : "Top-up gagal. Coba lagi ya.");
      }
    } finally {
      setBusy(null);
      checkoutLock.current = false;
    }
  }

  async function checkOrder() {
    if (!pendingOrder) return;
    setBusy("cek");
    try {
      const res = await apiFetch<{ status: string; message: string }>(`/api/orders/${pendingOrder}`);
      setOrderStatus(res.status);
      setMsg(res.message);
      if (res.status === "paid") {
        await refresh();
        const target = params.get("return_to") ?? loadFlow().returnTo ?? "/";
        setTimeout(() => router.push(target), 900);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Gagal cek status.");
    } finally {
      setBusy(null);
    }
  }

  const nSuper = balance === null ? null : Math.floor(balance / 80000);
  const nHq = balance === null ? null : Math.floor(balance / 12000);

  return (
    <main className="min-h-dvh space-y-7 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Dompet kreator</p><h1 className="font-display text-2xl font-bold">Kredit Saya</h1></div>

      {/* Kartu saldo ala rekening bank (permintaan Brian 2026-08-06): label kecil,
          nominal dominan, rincian "bisa buat apa" sebagai baris terpisah. */}
      <div className="overflow-hidden rounded-3xl bg-zinc-900 p-5 text-white shadow-xl shadow-zinc-900/25 ring-1 ring-white/10">
        <div className="flex items-center justify-between">
          <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">Saldo kredit</p>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/icons/ui/nav-kredit.png" alt="" className="h-5 w-5 opacity-80" />
        </div>
        <p className="mt-2 font-display text-[2.6rem] font-extrabold leading-none tracking-tight">
          {balance === null ? "…" : rupiah(balance)}
        </p>
        <p className="mt-1 text-xs text-zinc-400">BikinFYP.AI · dompet kreator</p>
        <div className="mt-4 grid grid-cols-2 gap-2 border-t border-white/10 pt-3 text-center">
          <div className="rounded-xl bg-white/5 px-2 py-2">
            <p className="font-display text-lg font-extrabold text-amber-300">{nHq ?? "…"}</p>
            <p className="text-[10px] leading-tight text-zinc-400">video AI Bersuara</p>
          </div>
          <div className="rounded-xl bg-white/5 px-2 py-2">
            <p className="font-display text-lg font-extrabold text-amber-300">{nSuper ?? "…"}</p>
            <p className="text-[10px] leading-tight text-zinc-400">video Bersuara Pro</p>
          </div>
        </div>
      </div>

      <section className="space-y-3">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih sesuai kebutuhan</p><h2 className="font-display text-xl font-bold">Isi ulang</h2></div>
        {PACKAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => topup(p.id)}
            disabled={busy !== null}
            className={`relative w-full rounded-2xl border-2 border-zinc-200 bg-white p-3 text-left shadow-sm transition-transform active:scale-[0.99] active:bg-zinc-50 disabled:opacity-60`}
          >
            {p.tag && (
              <span className="absolute right-3 top-2 rounded-full bg-amber-500 px-3 py-0.5 text-xs font-bold text-white shadow-sm">
                {p.tag}
              </span>
            )}
            <span className="flex items-center gap-3">
              {/* Contoh nyata hasil tier — "tunjukkan, jangan jelaskan" */}
              <video
                src={p.voiced ? "/previews/format-wajah.mp4" : "/previews/format-tangan.mp4"}
                autoPlay muted loop playsInline
                className="h-24 w-14 shrink-0 rounded-xl object-cover ring-1 ring-black/5"
              />
              <span className="min-w-0 flex-1">
                <span className="flex items-center justify-between gap-2">
                  <span className="font-bold">{p.name}</span>
                  <span className="shrink-0 font-bold">{rupiah(p.price)}</span>
                </span>
                <span className="mt-0.5 block text-xs font-semibold text-amber-700">{p.badge}</span>
                <span className="block text-sm text-zinc-500">{p.perVideo} · {busy === p.id ? "memproses..." : "tap untuk beli"}</span>
              </span>
            </span>
          </button>
        ))}
        <p className="text-xs leading-5 text-zinc-500">
          Semua paket bersuara: AI memperagakan produkmu + suara natural yang menjelaskan produk.
          <b> Pro</b> = kualitas gambar paling tajam.
        </p>
        {msg && <p className="rounded-2xl bg-green-50 p-3 text-center text-sm font-semibold text-green-700">{msg}</p>}
        <ErrorText message={error} />
        {pendingOrder && orderStatus !== "paid" && (
          <button
            type="button"
            onClick={checkOrder}
            disabled={busy !== null}
            className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-amber-500 font-bold text-amber-700 active:bg-amber-50 disabled:opacity-60"
          >
            {busy === "cek" ? "Mengecek..." : "Sudah bayar? Cek status"}
          </button>
        )}
      </section>

      <section className="space-y-2">
        <h2 className="font-display text-xl font-bold">Bayar pakai</h2>
        <div className="flex gap-2">
          {["QRIS", "GoPay", "OVO", "DANA"].map((m) => (
            <span key={m} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-600 shadow-sm">
              {m}
            </span>
          ))}
        </div>
        <p className="text-xs text-zinc-400">Mode demo: pembayaran langsung berhasil tanpa uang sungguhan.</p>
      </section>

      <section className="space-y-2">
        <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Transaksi terbaru</p><h2 className="font-display text-xl font-bold">Riwayat pemakaian</h2></div>
        {ledger.length === 0 ? (
          <p className="text-sm text-zinc-500">Belum ada riwayat.</p>
        ) : (
          <>
            {(showAllLedger ? ledger : ledger.slice(0, 5)).map((l) => (
              <div key={l.id} className="flex items-center justify-between border-b border-zinc-100 py-3 text-sm last:border-0">
                <span>
                  {LEDGER_LABEL[l.type] ?? l.type}
                  <span className="block text-xs text-zinc-400">{relTime(l.created_at)}</span>
                </span>
                <span className={`font-bold ${l.delta > 0 ? "text-green-600" : l.delta < 0 ? "text-zinc-800" : "text-zinc-400"}`}>
                  {l.delta > 0 ? `+${rupiah(l.delta)}` : l.delta === 0 ? "—" : `−${rupiah(Math.abs(l.delta))}`}
                </span>
              </div>
            ))}
            {!showAllLedger && ledger.length > 5 && (
              <button
                type="button"
                onClick={() => setShowAllLedger(true)}
                className="flex min-h-[44px] w-full items-center justify-center rounded-2xl border border-zinc-200 text-sm font-semibold text-zinc-600 active:bg-zinc-50"
              >
                Lihat selengkapnya ({ledger.length - 5} lagi)
              </button>
            )}
          </>
        )}
      </section>
    </main>
  );
}

export default function KreditPage() {
  return (
    <Suspense>
      <KreditInner />
    </Suspense>
  );
}
