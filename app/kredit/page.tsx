"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiFail } from "../_components/api";
import { ErrorText } from "../_components/ui";
import { loadFlow, rupiah } from "../_components/flow";

/**
 * KREDIT — dihitung per JENIS VIDEO, bukan rupiah.
 *
 * Yang berubah dari versi sebelumnya bukan tampilannya, melainkan apa yang
 * dihitung. Saldo rupiah dipakai menjawab tiga pertanyaan sekaligus: berapa
 * uang tersisa, berapa video yang bisa dibuat, dan video jenis apa. Sekarang
 * layar ini menjawab pertanyaan yang benar-benar dipunyai pembeli — "berapa
 * video Premium yang masih bisa saya bikin" — dengan angka, bukan pembagian.
 *
 * Dua ember dibedakan di layar, bukan cuma di database: kredit paket punya
 * tanggal habis, kredit satuan tidak. Menjumlahkannya jadi satu angka akan
 * menyembunyikan tanggal itu sampai hari jatahnya hilang.
 */

interface SisaJenis { langganan: number; topup: number; total: number }
interface Jenis {
  id: "standard" | "premium" | "ultra";
  label: string;
  jelas: string;
  resolusi: string;
  harga_idr: number | null;
  bisa_ditopup: boolean;
}
interface Paket {
  id: string; nama: string; keterangan: string; harga_idr: number; masa_hari: number;
  kuota: { standard: number; premium: number; ultra: number }; total_video: number;
}
interface Langganan { id: string; paket_nama: string; berakhir_pada: string; sisa: Record<string, number> }
interface Katalog {
  sisa: Record<string, SisaJenis>;
  jenis: Jenis[];
  paket: Paket[];
  langganan: Langganan[];
}

const tanggal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
};

function KreditInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [katalog, setKatalog] = useState<Katalog | null>(null);
  const [jumlah, setJumlah] = useState<Record<string, number>>({});
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [pendingOrder, setPendingOrder] = useState<string | null>(null);
  const [orderStatus, setOrderStatus] = useState<string | null>(null);
  // DUA PERTANYAAN BERBEDA, dan menyatukannya yang dulu membuat pendaftaran
  // merchant Duitku ditolak:
  //   bisaBayar    -> "gateway-nya bisa dipakai sekarang?" (kunci terpasang)
  //   paymentsLive -> "ini uang sungguhan?"                (production + izin)
  // Tombol mengikuti yang pertama; klaim uang sungguhan mengikuti yang kedua.
  const [bisaBayar, setBisaBayar] = useState<boolean | null>(null);
  const [paymentsLive, setPaymentsLive] = useState<boolean | null>(null);
  const [modeSandbox, setModeSandbox] = useState<boolean | null>(null);
  // Kanal DATANG DARI SERVER, tidak diketik di klien: daftar yang diketik di
  // sini bisa memuat kanal yang server tolak, dan pembeli baru tahu setelah
  // menekan.
  const [kanal, setKanal] = useState<{ code: string; name: string; type: string }[]>([]);
  const [kanalDipilih, setKanalDipilih] = useState<string | null>(null);
  const [instruksi, setInstruksi] = useState<{ va?: string; url?: string; nama?: string } | null>(null);
  const checkoutLock = useRef(false);

  async function refresh() {
    try {
      setKatalog(await apiFetch<Katalog>("/api/kredit-video"));
    } catch {
      /* biarkan tampilan lama — layar kosong lebih buruk daripada layar basi */
    }
  }

  useEffect(() => {
    refresh();
    apiFetch<{ payments_env: string; payments_live: boolean; payments_configured: boolean; payment_channels?: { code: string; name: string; type: string }[] }>("/api/meta")
      .then((m) => {
        setBisaBayar(m.payments_configured);
        setPaymentsLive(m.payments_live);
        setModeSandbox(m.payments_env === "sandbox");
        setKanal(Array.isArray(m.payment_channels) ? m.payment_channels : []);
      })
      .catch(() => { setBisaBayar(false); setPaymentsLive(false); setModeSandbox(null); });
  }, []);

  // Kembali dari halaman pembayaran: returnUrl Duitku membawa ?merchantOrderId.
  // Tab hasil redirect tidak mewarisi state tab asal, jadi ordernya dilanjutkan
  // dari query — statusnya langsung dicek tanpa menunggu user menekan apa pun.
  useEffect(() => {
    const ord = params.get("merchantOrderId") ?? params.get("order");
    if (!ord) return;
    setPendingOrder(ord);
    setOrderStatus("pending");
    apiFetch<{ status: string; message: string }>(`/api/orders/${ord}`)
      .then((res) => { setOrderStatus(res.status); setMsg(res.message); if (res.status === "paid") refresh(); })
      .catch(() => { /* tombol "Cek status" tetap jadi jalan manualnya */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  async function checkout(badan: Record<string, unknown>, kunci: string) {
    // State disabled baru terlihat pada render berikutnya; ref menutup celah
    // dua tap dalam frame yang sama agar tidak lahir dua invoice.
    if (checkoutLock.current) return;
    checkoutLock.current = true;
    setBusy(kunci); setMsg(null); setError(null); setInstruksi(null);
    try {
      const res = await apiFetch<{ order_id: string; amount_idr: number; redirect_url: string; va_number?: string }>(
        "/api/kredit-video/checkout",
        { json: { ...badan, ...(kanalDipilih ? { payment_method: kanalDipilih } : {}) } },
      );
      setPendingOrder(res.order_id);
      setOrderStatus("pending");
      const nama = kanal.find((k) => k.code === kanalDipilih)?.name;
      if (res.va_number) {
        // Nomor VA ditampilkan DI TEMPAT: pembeli harus menyalinnya ke aplikasi
        // banknya, dan membuka tab baru justru memindahkannya menjauh.
        setInstruksi({ va: res.va_number, nama });
      } else {
        setInstruksi({ url: res.redirect_url, nama });
        window.open(res.redirect_url, "_blank");
        setMsg("Scan QRIS di halaman yang terbuka, lalu tap 'Sudah bayar? Cek status'.");
      }
    } catch (err) {
      // Pesan server disampaikan apa adanya. Menggantinya dengan "gagal, coba
      // lagi" pernah membuang alasan sebenarnya ("pembayaran belum aktif") dan
      // orang mencoba berulang kali tanpa pernah tahu kenapa.
      setError(err instanceof ApiFail ? err.message : "Checkout gagal. Coba lagi ya.");
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

  const bisaTopup = katalog?.jenis.filter((j) => j.bisa_ditopup) ?? [];
  const totalTopup = bisaTopup.reduce((n, j) => n + (jumlah[j.id] ?? 0) * (j.harga_idr ?? 0), 0);
  const adaPilihan = bisaTopup.some((j) => (jumlah[j.id] ?? 0) > 0);
  const tombolMati = busy !== null || bisaBayar !== true || (kanal.length > 0 && !kanalDipilih);

  return (
    <main className="min-h-dvh space-y-7 bg-gradient-to-b from-amber-50/70 via-white to-white px-4 pb-28 pt-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Dompet kreator</p>
        <h1 className="font-display text-2xl font-bold">Kredit Video Saya</h1>
      </div>

      {/* Saldo per JENIS. Tiga angka, bukan satu — karena tiga jenis itu tidak
          bisa saling menggantikan, dan satu angka gabungan akan menjanjikan
          video yang jatahnya sebenarnya sudah habis. */}
      <div className="overflow-hidden rounded-3xl bg-zinc-900 p-5 text-white shadow-xl shadow-zinc-900/25 ring-1 ring-white/10">
        <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-zinc-400">Sisa jatah video</p>
        <div className="mt-3 grid grid-cols-3 gap-2 text-center">
          {(katalog?.jenis ?? []).map((j) => {
            const s = katalog?.sisa[j.id];
            return (
              <div key={j.id} className="rounded-xl bg-white/5 px-2 py-3">
                <p className="font-display text-3xl font-extrabold leading-none text-amber-300">
                  {s ? s.total : "…"}
                </p>
                <p className="mt-1 text-[11px] font-semibold text-zinc-300">{j.label}</p>
                {s && s.langganan > 0 && (
                  <p className="text-[10px] leading-tight text-zinc-500">{s.langganan} dari paket</p>
                )}
              </div>
            );
          })}
        </div>
        {(katalog?.langganan ?? []).map((l) => (
          <p key={l.id} className="mt-3 border-t border-white/10 pt-3 text-xs text-zinc-400">
            Paket <b className="text-zinc-200">{l.paket_nama}</b> — jatah paket habis {tanggal(l.berakhir_pada)}.
            Kredit satuan tidak ikut hangus.
          </p>
        ))}
      </div>

      {bisaBayar === false && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Pembayaran online belum aktif, jadi pembelian dimatikan dulu. Jatah yang sekarang tetap bisa dipakai.
        </p>
      )}
      {bisaBayar === true && modeSandbox === true && (
        <p className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <b>Mode uji coba.</b> Pembayaran memakai sandbox Duitku, jadi <b>tidak ada uang sungguhan yang dipotong</b>,
          dan jatah hanya bertambah untuk akun penguji terdaftar.
        </p>
      )}

      {/* Kanal dipilih SEBELUM paket. Harga VA dan QRIS sama, tapi cara
          bayarnya berbeda jauh — ditanya sesudah menekan membuat orang merasa
          sudah terlanjur. */}
      {bisaBayar === true && kanal.length > 0 && (
        <div className="rounded-2xl border-2 border-zinc-200 bg-white p-3">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-400">Bayar pakai</p>
          <div className="mt-2 grid grid-cols-2 gap-2">
            {kanal.map((k) => (
              <button
                key={k.code} type="button" onClick={() => setKanalDipilih(k.code)}
                aria-pressed={kanalDipilih === k.code}
                className={`rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition-colors ${
                  kanalDipilih === k.code ? "border-amber-500 bg-amber-50 text-zinc-900" : "border-zinc-200 text-zinc-600 active:bg-zinc-50"
                }`}
              >
                {k.name}
                {k.type === "qris" && <span className="mt-0.5 block text-[11px] font-normal text-zinc-400">Scan dari aplikasi apa pun</span>}
              </button>
            ))}
          </div>
          {!kanalDipilih && <p className="mt-2 text-xs text-zinc-500">Pilih dulu cara bayarnya.</p>}
        </div>
      )}

      {(katalog?.paket.length ?? 0) > 0 && (
        <section className="space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Berlangganan</p>
            <h2 className="font-display text-xl font-bold">Paket bulanan</h2>
          </div>
          {katalog?.paket.map((p) => (
            <button
              key={p.id} type="button" disabled={tombolMati}
              onClick={() => checkout({ mode: "langganan", paket_id: p.id }, `paket-${p.id}`)}
              className="w-full rounded-2xl border-2 border-zinc-200 bg-white p-4 text-left shadow-sm transition-transform active:scale-[0.99] disabled:opacity-60"
            >
              <span className="flex items-center justify-between gap-2">
                <span className="font-bold">{p.nama}</span>
                <span className="shrink-0 font-bold text-amber-700">{rupiah(p.harga_idr)}</span>
              </span>
              {p.keterangan && <span className="mt-0.5 block text-sm text-zinc-500">{p.keterangan}</span>}
              <span className="mt-2 flex flex-wrap gap-2 text-xs">
                {p.kuota.standard > 0 && <span className="rounded-full bg-zinc-100 px-2 py-1 font-semibold">{p.kuota.standard}× Standard</span>}
                {p.kuota.premium > 0 && <span className="rounded-full bg-zinc-100 px-2 py-1 font-semibold">{p.kuota.premium}× Premium</span>}
                {p.kuota.ultra > 0 && <span className="rounded-full bg-zinc-100 px-2 py-1 font-semibold">{p.kuota.ultra}× Ultra</span>}
              </span>
              <span className="mt-2 block text-xs text-zinc-500">
                Berlaku {p.masa_hari} hari. Jatah paket hangus saat masa berlakunya habis.
                {busy === `paket-${p.id}` ? " · memproses..." : ""}
              </span>
            </button>
          ))}
        </section>
      )}

      {bisaTopup.length > 0 && (
        <section className="space-y-3">
          <div>
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Beli satuan</p>
            <h2 className="font-display text-xl font-bold">Tambah kredit</h2>
            <p className="mt-1 text-sm text-zinc-500">Kredit satuan <b>tidak pernah hangus</b>.</p>
          </div>
          {bisaTopup.map((j) => (
            <div key={j.id} className="flex items-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white p-3">
              <div className="min-w-0 flex-1">
                <p className="font-bold">{j.label}</p>
                <p className="text-xs text-zinc-500">{j.resolusi} · {j.jelas}</p>
                <p className="mt-0.5 text-sm font-semibold text-amber-700">{rupiah(j.harga_idr ?? 0)}/video</p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <button
                  type="button" aria-label={`Kurangi ${j.label}`}
                  className="h-10 w-10 rounded-xl border-2 border-zinc-200 text-lg font-bold active:bg-zinc-50"
                  onClick={() => setJumlah((s) => ({ ...s, [j.id]: Math.max(0, (s[j.id] ?? 0) - 1) }))}
                >−</button>
                <span className="w-8 text-center font-display text-lg font-bold tabular-nums">{jumlah[j.id] ?? 0}</span>
                <button
                  type="button" aria-label={`Tambah ${j.label}`}
                  className="h-10 w-10 rounded-xl border-2 border-zinc-200 text-lg font-bold active:bg-zinc-50"
                  onClick={() => setJumlah((s) => ({ ...s, [j.id]: Math.min(500, (s[j.id] ?? 0) + 1) }))}
                >+</button>
              </div>
            </div>
          ))}
          <div className="rounded-2xl bg-zinc-900 p-4 text-white">
            <div className="flex items-center justify-between">
              <span className="text-sm text-zinc-300">Total</span>
              <span className="font-display text-2xl font-extrabold">{rupiah(totalTopup)}</span>
            </div>
            <button
              type="button"
              disabled={tombolMati || !adaPilihan}
              onClick={() => checkout(
                { mode: "topup", items: bisaTopup.filter((j) => (jumlah[j.id] ?? 0) > 0).map((j) => ({ jenis: j.id, qty: jumlah[j.id] })) },
                "topup",
              )}
              className="mt-3 min-h-[48px] w-full rounded-xl bg-amber-500 font-bold text-white disabled:opacity-40"
            >
              {busy === "topup" ? "Memproses..." : adaPilihan ? "Bayar sekarang" : "Pilih dulu jumlahnya"}
            </button>
          </div>
        </section>
      )}

      {katalog && bisaTopup.length === 0 && (
        <p className="rounded-2xl border border-zinc-200 bg-white p-3 text-sm text-zinc-500">
          Pembelian satuan belum dibuka. Harga per jenis video diatur admin.
        </p>
      )}

      {msg && <p className="rounded-2xl bg-green-50 p-3 text-center text-sm font-semibold text-green-700">{msg}</p>}
      <ErrorText message={error} />

      {instruksi?.va && (
        <div className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-700">{instruksi.nama}</p>
          <p className="mt-1 text-xs text-amber-900">Transfer ke nomor Virtual Account ini:</p>
          <p className="mt-2 select-all font-display text-2xl font-extrabold tracking-wider text-zinc-900">{instruksi.va}</p>
          <button
            type="button"
            onClick={() => { try { navigator.clipboard.writeText(instruksi.va!); setMsg("Nomor VA disalin."); } catch { setMsg("Salin manual ya."); } }}
            className="mt-3 min-h-[44px] w-full rounded-xl border-2 border-amber-500 font-bold text-amber-800 active:bg-amber-100"
          >
            Salin nomor
          </button>
          <p className="mt-2 text-xs leading-5 text-amber-900">
            Berlaku 60 menit. Setelah transfer, tap &quot;Sudah bayar? Cek status&quot; di bawah.
          </p>
        </div>
      )}
      {instruksi?.url && !instruksi.va && (
        <a href={instruksi.url} target="_blank" rel="noreferrer"
           className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-amber-500 font-bold text-amber-700 active:bg-amber-50">
          Buka lagi halaman {instruksi.nama ?? "pembayaran"}
        </a>
      )}
      {bisaBayar === true && (
        <section className="space-y-2">
          <h2 className="font-display text-lg font-bold">Bayar pakai</h2>
          <div className="flex flex-wrap gap-2">
            {kanal.map((k) => (
              <span key={k.code} className="rounded-xl border border-zinc-200 bg-white px-4 py-2 text-sm font-semibold text-zinc-600 shadow-sm">
                {k.name}
              </span>
            ))}
          </div>
          {/* Klaim UANG SUNGGUHAN tetap dikunci payments_live, terpisah dari
              tombolnya. Tombol boleh hidup di sandbox — itu yang diminta Duitku
              untuk diperlihatkan — tapi mengatakan "uangmu benar-benar
              dipotong" di lingkungan uji adalah bohong. */}
          {paymentsLive !== true && (
            <p className="rounded-2xl bg-amber-50 p-3 text-sm text-amber-800">
              Metode di atas dilayani lewat sandbox Duitku selama masa verifikasi —
              belum memotong uang sungguhan.
            </p>
          )}
        </section>
      )}

      {pendingOrder && orderStatus !== "paid" && (
        <button type="button" onClick={checkOrder} disabled={busy !== null}
          className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-amber-500 font-bold text-amber-700 active:bg-amber-50 disabled:opacity-60">
          {busy === "cek" ? "Mengecek..." : "Sudah bayar? Cek status"}
        </button>
      )}
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
