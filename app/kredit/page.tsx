"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiFail } from "../_components/api";
import { ErrorText } from "../_components/ui";
import { loadFlow, rupiah, relTime } from "../_components/flow";
import { PAKET_KREDIT } from "../../lib/paket-kredit";

interface LedgerItem {
  id: string;
  delta: number;
  type: string;
  created_at: string;
}

// Nama paket berbasis manfaat + contoh visual per tier (2026-08-06: tester
// bingung "Senyap"; target user emak-emak — tunjukkan, jangan jelaskan).
// 2026-08-06: tier Teks+Musik pensiun — fokus persona bersuara.
//
// Daftarnya pindah ke lib/paket-kredit.ts (2026-08-14) supaya halaman harga
// PUBLIK dan halaman checkout ini membaca angka yang sama. Dua daftar harga
// yang harus dijaga sama selamanya cepat atau lambat berbeda — dan yang
// membaca halaman publik justru reviewer gateway pembayaran.
const PACKAGES = PAKET_KREDIT;

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
  // r13 (review produk 2026-08-07): jangan lagi menebak status pembayaran dari
  // kegagalan fallback dev — tanya server langsung (null = belum tahu).
  const [paymentsLive, setPaymentsLive] = useState<boolean | null>(null);
  // DUA PERTANYAAN BERBEDA, dan menyatukannya yang membuat pendaftaran
  // merchant Duitku ditolak.
  //
  //   paymentsLive  -> "ini uang sungguhan?"  (production + izin Brian)
  //   bisaBayar     -> "gateway-nya bisa dipakai sekarang?" (kunci terpasang)
  //
  // Sebelum 26 Agu halaman ini cuma punya yang pertama, jadi selama Duitku
  // masih sandbox tombol belinya mati total. Duitku justru meminta melihat
  // checkout sampai pembayaran DI SANDBOX MEREKA — persis alur yang kita
  // tutup sendiri. Jadi tombolnya kini terbuka begitu kuncinya terpasang,
  // dan status "uang mainan" dinyatakan terang-terangan alih-alih
  // disembunyikan dengan mematikan tombolnya.
  const [bisaBayar, setBisaBayar] = useState<boolean | null>(null);
  const [modeSandbox, setModeSandbox] = useState<boolean | null>(null);
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
    apiFetch<{ payments_live: boolean; payments_env: string; payments_configured: boolean }>("/api/meta")
      .then((m) => {
        setPaymentsLive(m.payments_live);
        setBisaBayar(m.payments_configured);
        setModeSandbox(m.payments_env === "sandbox");
      })
      .catch(() => { setPaymentsLive(false); setBisaBayar(false); setModeSandbox(null); });
  }, []);

  // Kembali dari halaman pembayaran: returnUrl Duitku membawa ?merchantOrderId=...
  // (jalur Midtrans lama memakai ?order=...). Tab hasil redirect tidak mewarisi state
  // tab asal, jadi order-nya dilanjutkan dari query — status langsung dicek
  // tanpa menunggu user menekan apa pun.
  useEffect(() => {
    const ord = params.get("merchantOrderId") ?? params.get("order");
    if (!ord) return;
    setPendingOrder(ord);
    setOrderStatus("pending");
    apiFetch<{ status: string; message: string }>(`/api/orders/${ord}`)
      .then((res) => {
        setOrderStatus(res.status);
        setMsg(res.message);
        if (res.status === "paid") refresh();
      })
      .catch(() => { /* biarkan tombol "Cek status" sebagai jalan manual */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function topup(packageId: string) {
    // State disabled baru terlihat setelah render berikutnya; ref menutup celah
    // dua tap dalam frame yang sama agar tidak membuat dua invoice Duitku.
    if (checkoutLock.current) return;
    checkoutLock.current = true;
    setBusy(packageId);
    setMsg(null);
    setError(null);
    try {
      // Jalur utama: checkout gateway aktif (Duitku POP; Midtrans Snap tetap
      // ada sebagai rollback — sama-sama redirect URL). Bila gateway belum
      // dipasang kuncinya (mode demo tanpa key), jatuh ke topup instan dev.
      const res = await apiFetch<{ order_id: string; redirect_url: string }>("/api/credits/checkout", {
        json: { package_id: packageId },
      });
      setPendingOrder(res.order_id);
      setOrderStatus("pending");
      window.open(res.redirect_url, "_blank");
      setMsg("Order dibuat — selesaikan pembayaran di halaman pembayaran yang terbuka, lalu tap 'Sudah bayar? Cek status'.");
    } catch (err) {
      // r13 (review produk 2026-08-07): jalur demo HANYA boleh dicoba kalau
      // server sudah bilang pembayaran belum aktif; sebelumnya err2 (fallback
      // dev diblokir di production) diganti pesan generik "Top-up gagal" yang
      // MEMBUANG pesan jujur server ("Pembayaran online belum aktif — hubungi
      // tim kami") — user production tidak pernah tahu alasan sebenarnya.
      if (err instanceof ApiFail && err.code === "PAYMENT_NOT_CONFIGURED") {
        try {
          await apiFetch("/api/credits/topup", { json: { package_id: packageId } });
          setMsg("Pembayaran berhasil (mode demo — gateway online belum dipasang)");
          await refresh();
          // Balik otomatis ke titik alur terakhir (draft aman di sessionStorage)
          const target = params.get("return_to") ?? loadFlow().returnTo ?? "/";
          setTimeout(() => router.push(target), 900);
        } catch {
          // Jalur dev diblokir (production) -> tampilkan pesan JUJUR asli dari
          // server, bukan pesan generik yang menyembunyikan alasan sebenarnya.
          setError(err.message);
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
        <p className="mt-1 text-xs text-zinc-400">BikinFYP AI · dompet kreator</p>
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
        {/* Pemberitahuan pembayaran mati harus muncul SEBELUM tombolnya, bukan di
            bawah. Sebelumnya tombol tetap aktif dan pengguna baru tahu setelah
            menekan "beli" lalu menerima error — kegagalan yang bisa diramalkan
            tapi tetap dibiarkan terjadi. */}
        {bisaBayar === false && (
          <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
            Pembayaran online belum aktif, jadi top-up dimatikan dulu. Kreditmu yang
            sekarang tetap bisa dipakai. Kami kabari begitu sudah bisa.
          </p>
        )}
        {/* MODE UJI HARUS DIKATAKAN, BUKAN DISEMBUNYIKAN.
            Checkout sandbox jalan penuh — tapi tidak memotong uang, dan
            webhook sandbox hanya mengkredit akun penguji terdaftar
            (app/api/webhooks/duitku). Membiarkan orang menyelesaikan
            pembayaran lalu heran kreditnya tidak bertambah adalah kegagalan
            yang bisa diramalkan; kalimat ini yang mencegahnya. */}
        {bisaBayar === true && modeSandbox === true && (
          <p className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
            <b>Mode uji coba.</b> Pembayaran memakai sandbox Duitku, jadi{" "}
            <b>tidak ada uang sungguhan yang dipotong</b> dan kredit belum bertambah
            di luar akun penguji. Alur checkout sampai halaman pembayaran sudah jalan
            penuh — ini yang sedang diverifikasi penyedia pembayaran kami.
          </p>
        )}
        {PACKAGES.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => topup(p.id)}
            // "!== true", BUKAN "=== false".
            //
            // bisaBayar punya TIGA keadaan: true, false, dan null selagi
            // /api/meta belum menjawab. Pemeriksaan "=== false" membiarkan
            // tombolnya hidup selama keadaan null — jendela kecil di awal muat
            // halaman, tapi persis jendela yang ditekan orang tidak sabar
            // (temuan audit QA putaran kedua, 16 Agu 2026).
            //
            // Default aman: tertutup sampai server BILANG boleh. Yang berubah
            // 26 Agu hanya PERTANYAANNYA — dari "sudah uang sungguhan?" jadi
            // "kuncinya sudah terpasang?" — bukan longgarnya default.
            disabled={busy !== null || bisaBayar !== true}
            aria-disabled={busy !== null || bisaBayar !== true}
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
                <span className="block text-sm text-zinc-500">{p.perVideo} · {bisaBayar === null ? "mengecek pembayaran..." : bisaBayar === false ? "pembayaran belum aktif" : busy === p.id ? "memproses..." : modeSandbox ? "tap untuk coba (mode uji)" : "tap untuk beli"}</span>
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
        {/* r13 (review produk 2026-08-07): dulu badge metode bayar + klaim "mode
            demo" tampil TANPA SYARAT ke SEMUA user termasuk production — padahal
            Duitku belum aktif, jadi klaimnya salah. Sekarang jujur sesuai
            status server (/api/meta payments_live), bukan asumsi tetap. */}
        {/* Metode bayar ditampilkan begitu gateway-nya bisa dipakai — pembeli
            memang perlu tahu akan bertemu apa di halaman pembayaran. Yang
            TIDAK boleh ikut adalah klaim uang sungguhan; itu tetap dikunci
            paymentsLive. */}
        {bisaBayar === true ? (
          <>
            <div className="flex gap-2">
              {["QRIS", "GoPay", "OVO", "DANA"].map((m) => (
                <span key={m} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-600 shadow-sm">
                  {m}
                </span>
              ))}
            </div>
            {paymentsLive !== true && (
              <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
                Metode di atas dilayani lewat sandbox Duitku selama masa verifikasi —
                belum memotong uang sungguhan.
              </p>
            )}
          </>
        ) : bisaBayar === false ? (
          <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
            Pembayaran online sedang kami siapkan — belum bisa top-up pakai uang sungguhan dulu ya. Coba lagi dalam beberapa hari.
          </p>
        ) : null}
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
