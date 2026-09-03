"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiFail, pesanUntukPengguna} from "../_components/api";
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
interface Langganan { id: string; paket_id: string; paket_nama: string; berakhir_pada: string; sisa: Record<string, number> }
interface PesananTertunda {
  order_id: string; amount_idr: number; dibuat_pada: string;
  paket_id: string | null; items: { jenis: string; qty: number }[];
  va_number: string | null; redirect_url: string | null;
}
interface Katalog {
  sisa: Record<string, SisaJenis>;
  jenis: Jenis[];
  paket: Paket[];
  langganan: Langganan[];
  pesanan_tertunda: PesananTertunda[];
}

/** "5 menit lalu" — umur pesanan lebih berguna daripada jam pastinya. */
const waktuSingkat = (iso: string) => {
  const menit = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (menit < 1) return "baru saja";
  if (menit < 60) return `${menit} menit lalu`;
  return `${Math.round(menit / 60)} jam lalu`;
};

const tanggal = (iso: string) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso.slice(0, 10) : d.toLocaleDateString("id-ID", { day: "numeric", month: "long", year: "numeric" });
};

function KreditInner() {
  const router = useRouter();
  const params = useSearchParams();
  const [katalog, setKatalog] = useState<Katalog | null>(null);
  const [jumlah, setJumlah] = useState<Record<string, number>>({});
  // Paket bulanan dan kredit satuan BOLEH dibeli sekaligus dalam satu
  // pesanan. Aturan hangusnya tetap berbeda — jatah paket habis di akhir masa,
  // jatah satuan tidak — dan itu dinyatakan terpisah di ringkasan, bukan
  // diselesaikan dengan melarang keduanya digabung.
  const [paketDipilih, setPaketDipilih] = useState<string | null>(null);
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
      const res = await apiFetch<{ order_id: string; amount_idr: number; redirect_url: string; va_number?: string; dilanjutkan?: boolean }>(
        "/api/kredit-video/checkout",
        { json: { ...badan, ...(kanalDipilih ? { payment_method: kanalDipilih } : {}) } },
      );
      setPendingOrder(res.order_id);
      setOrderStatus("pending");
      const nama = kanal.find((k) => k.code === kanalDipilih)?.name;
      // Server MELANJUTKAN pesanan yang sama alih-alih membuat yang baru.
      // Dikatakan apa adanya: orang yang mengira pesanan pertamanya hilang
      // akan mengira ini pesanan kedua, dan mencari-cari tagihan yang tidak
      // pernah ada.
      if (res.dilanjutkan) setMsg("Ini pesanan yang tadi belum dibayar — nomornya sama, bukan tagihan baru.");
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

  async function batalkan(orderId: string) {
    setBusy("batal"); setError(null);
    try {
      await apiFetch(`/api/orders/${orderId}`, { method: "DELETE" });
      setMsg("Pesanan dibatalkan.");
      await refresh();
    } catch (err) {
      setError(pesanUntukPengguna(err, "Gagal membatalkan pesanan."));
    } finally {
      setBusy(null);
    }
  }

  /**
   * Cek satu pesanan. `diam` = pemeriksaan latar; ia tidak menyalakan indikator
   * sibuk dan tidak menampilkan galat, supaya polling otomatis tidak membuat
   * layar berkedip atau memunculkan pesan merah saat jaringan sekejap putus.
   */
  async function checkOrder(orderId?: string, diam = false) {
    const target = orderId ?? pendingOrder;
    if (!target) return;
    if (!diam) setBusy("cek");
    try {
      const res = await apiFetch<{ status: string; message: string }>(`/api/orders/${target}`);
      setPendingOrder(target);
      setOrderStatus(res.status);
      if (!diam || res.status !== "pending") setMsg(res.message);
      if (res.status === "paid") {
        await refresh();
        setPaketDipilih(null);
        setJumlah({});
        // ANTAR PULANG KE TEMPAT KERJANYA.
        //
        // Orang membuka halaman ini karena jatahnya habis di tengah alur
        // membuat konten. Meninggalkannya di halaman dompet setelah membayar
        // memaksa ia mencari sendiri jalan kembali ke pekerjaan yang tadi
        // terhenti.
        // "/bikin/jenis" adalah langkah PERTAMA alur bikin konten (lihat
        // LANGKAH di app/_components/ui.tsx) — "/bikin" sendiri bukan halaman.
        // Kalau pengguna datang dari tengah alur, return_to atau flow.returnTo
        // mengembalikannya persis ke langkah yang tadi terhenti.
        const target = params.get("return_to") ?? loadFlow().returnTo ?? "/bikin/jenis";
        setTimeout(() => router.push(target), 1200);
      }
    } catch (err) {
      if (!diam) setError(pesanUntukPengguna(err, "Gagal cek status."));
    } finally {
      if (!diam) setBusy(null);
    }
  }

  /**
   * PEMBERITAHUAN OTOMATIS SAAT PEMBAYARAN MASUK.
   *
   * Callback Duitku tiba di server, bukan di layar ini — jadi tanpa polling,
   * halaman ini tidak akan pernah tahu pembayarannya sudah lunas. Sebelumnya
   * satu-satunya cara mengetahuinya adalah menekan "Cek status" sendiri, dan
   * orang yang tidak tahu tombol itu ada akan menyimpulkan pembayarannya
   * gagal.
   *
   * Diperiksa tiap 5 detik selama 10 menit — cukup panjang untuk transfer VA
   * yang selesai di aplikasi bank, dan berhenti sendiri supaya tab yang
   * ditinggalkan terbuka tidak memanggil server selamanya.
   */
  useEffect(() => {
    if (!pendingOrder) return;
    if (orderStatus && orderStatus !== "pending") return;
    let hidup = true;
    let sisa = 120; // 120 x 5 detik = 10 menit
    const jam = setInterval(() => {
      if (!hidup || sisa-- <= 0) { clearInterval(jam); return; }
      void checkOrder(pendingOrder, true);
    }, 5000);
    return () => { hidup = false; clearInterval(jam); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingOrder, orderStatus]);

  const bisaTopup = katalog?.jenis.filter((j) => j.bisa_ditopup) ?? [];
  const totalTopup = bisaTopup.reduce((n, j) => n + (jumlah[j.id] ?? 0) * (j.harga_idr ?? 0), 0);
  const adaSatuan = bisaTopup.some((j) => (jumlah[j.id] ?? 0) > 0);
  const paket = katalog?.paket.find((p) => p.id === paketDipilih) ?? null;

  // ISI KERANJANG — satu tempat yang tahu apa yang sedang dibeli.
  //
  // Sebelum ini tidak ada tempat seperti ini: tiap tombol beli langsung
  // memanggil checkout, jadi tidak ada satu pun layar yang bisa menjawab
  // "saya sedang membeli apa, berapa totalnya".
  //
  // Keranjangnya boleh memuat paket DAN satuan sekaligus; keduanya tetap
  // ditampilkan sebagai dua baris terpisah karena masa berlakunya berbeda.
  const barisSatuan = bisaTopup
    .filter((j) => (jumlah[j.id] ?? 0) > 0)
    .map((j) => ({ jenis: j.id, qty: jumlah[j.id] as number, label: j.label, subtotal: (jumlah[j.id] ?? 0) * (j.harga_idr ?? 0) }));
  const adaIsi = Boolean(paket) || barisSatuan.length > 0;
  const totalKeranjang = (paket?.harga_idr ?? 0) + totalTopup;
  const badanPesanan: Record<string, unknown> = {
    mode: paket && barisSatuan.length ? "campuran" : paket ? "langganan" : "topup",
    ...(paket ? { paket_id: paket.id } : {}),
    ...(barisSatuan.length ? { items: barisSatuan.map((b) => ({ jenis: b.jenis, qty: b.qty })) } : {}),
  };

  // Tombol bayar HANYA menunggu hal yang benar-benar kurang, dan layar
  // MENGATAKAN apa itu. Versi sebelumnya mematikan semua tombol beli selama
  // kanal belum dipilih — tanpa penjelasan di dekat tombolnya — jadi menekan
  // paket bulanan tidak menghasilkan apa pun sama sekali.
  const kurang =
    bisaBayar !== true
      ? "Pembayaran online belum aktif."
      : !adaIsi
        ? "Pilih dulu paket atau jumlah videonya."
        : kanal.length > 0 && !kanalDipilih
          ? "Pilih dulu cara bayarnya."
          : null;
  const tombolMati = busy !== null || kurang !== null;

  function pilihPaket(id: string) {
    setError(null);
    // Satu paket per pesanan — dua paket sekaligus akan membuat dua periode
    // langganan dari satu pembayaran, dan indeks unik database menolaknya.
    // Kredit satuan TIDAK ikut dikosongkan: keduanya boleh berbarengan.
    setPaketDipilih((lama) => (lama === id ? null : id));
  }
  function ubahJumlah(id: string, delta: number) {
    setError(null);
    setJumlah((s) => ({ ...s, [id]: Math.max(0, Math.min(500, (s[id] ?? 0) + delta)) }));
  }

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

      {/* PAKET AKTIF — dipajang lebih dulu, seperti halaman billing SaaS mana
          pun. Orang yang membuka halaman ini pertama-tama ingin tahu "saya
          sedang berlangganan apa, sampai kapan, dan sisanya berapa". Sebelum
          ini halaman langsung menawarkan paket seolah ia belum punya apa-apa —
          dan tanggal berakhirnya tidak muncul di mana pun. */}
      {(katalog?.langganan.length ?? 0) > 0 && (
        <section className="space-y-2 rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-emerald-700">Paket aktif</p>
          {katalog?.langganan.map((l) => {
            const hari = Math.max(0, Math.ceil((new Date(l.berakhir_pada).getTime() - Date.now()) / 86_400_000));
            return (
              <div key={l.id} className="rounded-xl bg-white p-3">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="font-display text-lg font-bold">{l.paket_nama}</p>
                  <p className="shrink-0 text-xs font-semibold text-emerald-700">
                    {hari > 0 ? `${hari} hari lagi` : "berakhir hari ini"}
                  </p>
                </div>
                <p className="mt-0.5 text-xs text-zinc-500">Berlaku sampai {tanggal(l.berakhir_pada)}</p>
                <div className="mt-2 flex flex-wrap gap-2 text-xs">
                  {(["standard", "premium", "ultra"] as const).map((j) =>
                    l.sisa[j] > 0 ? (
                      <span key={j} className="rounded-full bg-emerald-100 px-2 py-1 font-semibold text-emerald-800">
                        Sisa {l.sisa[j]}× {j === "standard" ? "Standard" : j === "premium" ? "Premium" : "Ultra"}
                      </span>
                    ) : null,
                  )}
                </div>
              </div>
            );
          })}
          <p className="text-xs leading-5 text-emerald-900">
            Jatah paket <b>hangus</b> saat masa berlakunya habis. Beli paket yang sama lagi untuk{" "}
            <b>memperpanjang</b> — jatah dan masanya ditambahkan, tidak ada yang hangus. Butuh tambahan
            yang tidak terikat masa? Beli <b>kredit satuan</b> di bawah.
          </p>
        </section>
      )}

      {/* PESANAN YANG BELUM DIBAYAR — dikatakan lebih dulu, sebelum orang
          membuat pesanan kedua. Cara paling umum orang membayar dua kali
          bukan karena serakah, melainkan karena tidak tahu yang pertama masih
          menunggu. */}
      {(katalog?.pesanan_tertunda.length ?? 0) > 0 && (
        <section className="space-y-2 rounded-2xl border-2 border-sky-400 bg-sky-50 p-4">
          <p className="text-xs font-bold uppercase tracking-[0.14em] text-sky-700">Belum dibayar</p>
          {katalog?.pesanan_tertunda.map((o) => (
            <div key={o.order_id} className="rounded-xl bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold">{rupiah(o.amount_idr)}</p>
                <p className="shrink-0 text-xs text-zinc-500">{waktuSingkat(o.dibuat_pada)}</p>
              </div>
              {o.va_number && (
                <p className="mt-1 select-all font-display text-lg font-extrabold tracking-wider">{o.va_number}</p>
              )}
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {o.redirect_url && !o.va_number && (
                  <a href={o.redirect_url} target="_blank" rel="noreferrer" className="font-bold text-sky-700 underline">
                    Lanjutkan bayar
                  </a>
                )}
                <button
                  type="button"
                  className="font-bold text-sky-700 underline"
                  onClick={() => void checkOrder(o.order_id)}
                >
                  Cek status
                </button>
                <button
                  type="button"
                  className="text-zinc-500 underline"
                  onClick={() => batalkan(o.order_id)}
                >
                  Batalkan
                </button>
              </div>
            </div>
          ))}
          <p className="text-xs leading-5 text-sky-900">
            Kalau kamu sudah bayar, tap <b>Cek status</b>. Jangan buat pesanan baru untuk hal yang sama —
            dua nomor pembayaran yang sama-sama hidup berarti bisa terbayar dua kali.
          </p>
        </section>
      )}

      {bisaBayar === false && (
        <p className="rounded-2xl border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          Pembayaran online belum aktif, jadi pembelian dimatikan dulu. Jatah yang sekarang tetap bisa dipakai.
        </p>
      )}
      {bisaBayar === true && modeSandbox === true && (
        <p className="rounded-2xl border-2 border-amber-400 bg-amber-50 p-3 text-sm text-amber-900">
          <b>Mode uji coba.</b> Pembayaran memakai sandbox Duitku, jadi{" "}
          {paymentsLive !== true && <b>belum memotong uang sungguhan</b>}
          {paymentsLive !== true && ", "}
          dan jatah hanya bertambah untuk akun penguji terdaftar.
        </p>
      )}

      {/* ── APA YANG DIBELI ─────────────────────────────────────────────
          Dua cara membeli, dan bedanya BUKAN harga melainkan MASA BERLAKU.
          Sebelumnya keduanya berdiri sebagai dua daftar tombol beli yang
          mirip, tanpa satu kalimat pun yang menjelaskan bedanya — jadi wajar
          kalau membingungkan. Sekarang bedanya dinyatakan di kepala tiap
          bagian, dan memilih salah satu mengosongkan yang lain. */}

      {(katalog?.paket.length ?? 0) > 0 && (
        <section className="space-y-3">
          <div className="rounded-2xl bg-zinc-900 px-4 py-3 text-white">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Pilihan 1 · Langganan</p>
            <h2 className="font-display text-lg font-bold">Paket bulanan</h2>
            <p className="mt-0.5 text-xs leading-5 text-zinc-300">
              Lebih hemat per video. Jatahnya <b className="text-white">hangus</b> saat masa berlakunya habis.
            </p>
          </div>
          {katalog?.paket.map((p) => {
            const terpilih = paketDipilih === p.id;
            // Paket yang SEDANG dipakai tidak boleh tampil seolah pembeli
            // belum punya apa-apa. Ia tetap BISA dibeli lagi — orang yang
            // menghabiskan jatahnya dalam seminggu harus bisa menambah — tapi
            // aksinya dinyatakan apa adanya: menambah, bukan mengganti.
            const sedangAktif = katalog?.langganan.some((l) => l.paket_id === p.id) ?? false;
            const punyaLangganan = (katalog?.langganan.length ?? 0) > 0;
            return (
              <button
                key={p.id} type="button" onClick={() => pilihPaket(p.id)}
                aria-pressed={terpilih}
                className={`relative w-full rounded-2xl border-2 p-4 text-left shadow-sm transition-transform active:scale-[0.99] ${
                  terpilih ? "border-amber-500 bg-amber-50" : sedangAktif ? "border-emerald-300 bg-white" : "border-zinc-200 bg-white"
                }`}
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
                {sedangAktif && (
                  <span className="absolute right-3 top-3 rounded-full bg-emerald-600 px-2 py-0.5 text-[11px] font-bold text-white">
                    Paket aktif
                  </span>
                )}
                <span className={`mt-2 block text-xs font-semibold ${terpilih ? "text-amber-700" : "text-zinc-400"}`}>
                  {terpilih
                    ? "✓ Dipilih — lihat ringkasan di bawah"
                    : sedangAktif
                      ? `+${p.masa_hari} hari · tap untuk MEMPERPANJANG paket ini`
                      : punyaLangganan
                        ? `Berlaku ${p.masa_hari} hari · tap untuk menambah paket ini`
                        : `Berlaku ${p.masa_hari} hari · tap untuk pilih`}
                </span>
              </button>
            );
          })}
        </section>
      )}

      {bisaTopup.length > 0 && (
        <section className="space-y-3">
          <div className="rounded-2xl border-2 border-zinc-200 bg-white px-4 py-3">
            <p className="text-xs font-bold uppercase tracking-[0.16em] text-zinc-400">Pilihan 2 · Sekali beli</p>
            <h2 className="font-display text-lg font-bold">Kredit satuan</h2>
            <p className="mt-0.5 text-xs leading-5 text-zinc-500">
              Beli sebanyak yang kamu perlu. <b className="text-zinc-900">Tidak pernah hangus</b>, tapi harga per videonya
              lebih tinggi daripada paket.
            </p>
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
                  onClick={() => ubahJumlah(j.id, -1)}
                >−</button>
                <span className="w-8 text-center font-display text-lg font-bold tabular-nums">{jumlah[j.id] ?? 0}</span>
                <button
                  type="button" aria-label={`Tambah ${j.label}`}
                  className="h-10 w-10 rounded-xl border-2 border-zinc-200 text-lg font-bold active:bg-zinc-50"
                  onClick={() => ubahJumlah(j.id, 1)}
                >+</button>
              </div>
            </div>
          ))}
        </section>
      )}

      {katalog && bisaTopup.length === 0 && (katalog.paket.length ?? 0) === 0 && (
        <p className="rounded-2xl border border-zinc-200 bg-white p-3 text-sm text-zinc-500">
          Belum ada paket maupun harga satuan yang dibuka. Hubungi tim kami ya.
        </p>
      )}

      {/* ── RINGKASAN PESANAN ───────────────────────────────────────────
          Inilah yang hilang sebelumnya. Tiap tombol beli langsung memanggil
          checkout, jadi tidak ada satu pun layar yang bisa menjawab "saya
          sedang membeli apa, berapa totalnya" — dan ketika tombolnya diam
          (kanal belum dipilih), tidak ada apa pun yang memberi tahu kenapa. */}
      {adaIsi && (
        <section className="space-y-3 rounded-2xl border-2 border-amber-400 bg-amber-50 p-4">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-display text-lg font-bold">Ringkasan pesanan</h2>
            <button type="button" className="text-xs underline" onClick={() => { setPaketDipilih(null); setJumlah({}); }}>
              kosongkan
            </button>
          </div>

          {/* Paket dan satuan tetap DUA BARIS TERPISAH walau dibayar sekaligus:
              yang satu hangus di akhir masa, yang satu tidak. Menggabungkannya
              jadi satu baris akan menyembunyikan perbedaan yang paling penting
              bagi pembeli. */}
          {paket && (
            <div className="rounded-xl bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold">Paket {paket.nama}</p>
                <p className="shrink-0 font-bold tabular-nums">{rupiah(paket.harga_idr)}</p>
              </div>
              <ul className="mt-1 space-y-0.5 text-sm text-zinc-600">
                {paket.kuota.standard > 0 && <li>· {paket.kuota.standard}× Standard</li>}
                {paket.kuota.premium > 0 && <li>· {paket.kuota.premium}× Premium</li>}
                {paket.kuota.ultra > 0 && <li>· {paket.kuota.ultra}× Ultra</li>}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">
                Berlaku {paket.masa_hari} hari — jatah paket hangus saat masa berlakunya habis.
              </p>
              {/* SUDAH BERLANGGANAN? Katakan sekarang, bukan sesudah dibayar.
                  Paket kedua DITAMBAHKAN, bukan menggantikan — dan orang yang
                  mengira langganan pertamanya gagal berhak tahu itu sebelum
                  membayar lagi. */}
              {/* Akibatnya BEDA untuk paket yang sama dan paket yang berbeda —
                  dan itu harus dikatakan sebelum tombol Bayar ditekan, bukan
                  ditemukan sendiri sesudahnya. */}
              {(() => {
                const aktifSama = katalog?.langganan.find((l) => l.paket_id === paket.id);
                const aktifLain = katalog?.langganan.filter((l) => l.paket_id !== paket.id) ?? [];
                if (aktifSama) {
                  const baru = new Date(new Date(aktifSama.berakhir_pada).getTime() + paket.masa_hari * 86_400_000);
                  return (
                    <p className="mt-2 rounded-lg bg-emerald-100 p-2 text-xs leading-5 text-emerald-900">
                      <b>Ini memperpanjang paket {aktifSama.paket_nama} kamu.</b> Jatahnya ditambahkan ke yang sekarang,
                      dan masa berlakunya mundur dari {tanggal(aktifSama.berakhir_pada)} jadi{" "}
                      <b>{tanggal(baru.toISOString())}</b>. Tidak ada jatah lama yang hangus.
                    </p>
                  );
                }
                if (aktifLain.length) {
                  return (
                    <p className="mt-2 rounded-lg bg-amber-100 p-2 text-xs leading-5 text-amber-900">
                      <b>Kamu masih punya paket {aktifLain[0].paket_nama} aktif</b> sampai {tanggal(aktifLain[0].berakhir_pada)}.
                      Paket ini <b>ditambahkan</b>, bukan menggantikan — jatah lamamu tetap utuh dan justru dipakai lebih dulu.
                    </p>
                  );
                }
                return null;
              })()}
            </div>
          )}

          {barisSatuan.length > 0 && (
            <div className="rounded-xl bg-white p-3">
              <div className="flex items-baseline justify-between gap-2">
                <p className="font-bold">Kredit satuan</p>
                <p className="shrink-0 font-bold tabular-nums">{rupiah(totalTopup)}</p>
              </div>
              <ul className="mt-1 space-y-0.5 text-sm text-zinc-600">
                {barisSatuan.map((b) => (
                  <li key={b.jenis}>· {b.qty}× {b.label} — {rupiah(b.subtotal)}</li>
                ))}
              </ul>
              <p className="mt-2 text-xs text-zinc-500">Kredit satuan tidak pernah hangus.</p>
            </div>
          )}

          {kanal.length > 0 && (
            <div>
              <p className="text-xs font-bold uppercase tracking-[0.14em] text-zinc-500">Bayar pakai</p>
              <div className="mt-2 grid grid-cols-2 gap-2">
                {kanal.map((k) => (
                  <button
                    key={k.code} type="button" onClick={() => setKanalDipilih(k.code)}
                    aria-pressed={kanalDipilih === k.code}
                    className={`rounded-xl border-2 px-3 py-2 text-left text-sm font-semibold transition-colors ${
                      kanalDipilih === k.code ? "border-amber-500 bg-white text-zinc-900" : "border-amber-200 bg-white/60 text-zinc-600"
                    }`}
                  >
                    {k.name}
                    {k.type === "qris" && <span className="mt-0.5 block text-[11px] font-normal text-zinc-400">Scan dari aplikasi apa pun</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          <div className="flex items-center justify-between border-t border-amber-200 pt-3">
            <span className="text-sm font-semibold text-zinc-600">Total bayar</span>
            <span className="font-display text-2xl font-extrabold">{rupiah(totalKeranjang)}</span>
          </div>

          <button
            type="button" disabled={tombolMati}
            onClick={() => checkout(badanPesanan, "bayar")}
            className="min-h-[52px] w-full rounded-xl bg-amber-500 font-display text-lg font-bold text-white disabled:opacity-40"
          >
            {busy === "bayar" ? "Memproses..." : "Bayar sekarang"}
          </button>
          {/* Kalau tombolnya mati, layar MENGATAKAN apa yang kurang. Tombol
              diam tanpa penjelasan adalah cara tercepat membuat orang mengira
              sistemnya rusak. */}
          {kurang && <p className="text-center text-sm font-semibold text-amber-800">{kurang}</p>}
        </section>
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
      {/* Bagian "Bayar pakai" yang berdiri sendiri DIHAPUS 3 Sep 2026.
          Pemilihan kanal sudah ada di dalam ringkasan pesanan, tepat di atas
          tombol Bayar. Daftar kedua di bawah halaman tidak bisa dipilih dan
          tidak menjelaskan apa-apa — ia hanya membuat orang bertanya-tanya
          mana yang berlaku. Klaim "belum memotong uang sungguhan" pindah ke
          spanduk mode uji di atas, tempat orang membacanya sebelum membayar,
          bukan sesudah menggulir sampai bawah. */}

      {/* Layar sudah memeriksa sendiri tiap 5 detik; tombol ini untuk yang
          tidak mau menunggu — bukan lagi satu-satunya cara mengetahui. */}
      {pendingOrder && orderStatus !== "paid" && (
        <div className="space-y-2">
          <button type="button" onClick={() => void checkOrder()} disabled={busy !== null}
            className="flex min-h-[48px] w-full items-center justify-center rounded-2xl border-2 border-amber-500 font-bold text-amber-700 active:bg-amber-50 disabled:opacity-60">
            {busy === "cek" ? "Mengecek..." : "Sudah bayar? Cek status"}
          </button>
          <p className="text-center text-xs text-zinc-500">
            Kami juga mengecek sendiri tiap beberapa detik — halaman ini akan berubah begitu pembayaranmu masuk.
          </p>
        </div>
      )}

      {/* Pembayaran MASUK — dan halaman mengatakannya, lalu mengantar kembali
          ke tempat kerjanya. */}
      {orderStatus === "paid" && (
        <div className="rounded-2xl border-2 border-emerald-500 bg-emerald-50 p-4 text-center">
          <p className="font-display text-lg font-bold text-emerald-800">Pembayaran diterima</p>
          <p className="mt-1 text-sm text-emerald-900">Jatahmu sudah masuk. Mengantar kembali ke halaman bikin konten…</p>
        </div>
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
