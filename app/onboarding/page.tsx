"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiFetch, ApiFail, pesanUntukPengguna} from "../_components/api";
import { PrimaryButton, ErrorText } from "../_components/ui";
import { track } from "../_components/track";
import { tujuanAman } from "@/lib/tujuan-login";
import { ajakan, useKesiapan } from "../_components/kesiapan";
import { JANJI_WAKTU } from "@/lib/janji-waktu";
import { SiteFooter } from "../_components/SiteFooter";

/** Harga tier di landing. SATU sumber untuk kalkulator dan section "Harga
 *  transparan" — kalau keduanya menyimpan angkanya sendiri, halaman yang
 *  menjanjikan transparansi justru bisa menyebut dua harga berbeda. */
const TIER_LANDING = [
  { label: "AI Bersuara", price: 12_000, jelas: "AI memperagakan produkmu, dengan suara yang menjelaskan" },
  { label: "Bersuara Pro", price: 80_000, jelas: "Presenter AI bicara langsung ke kamera, lip-sync sungguhan" },
] as const;

const GOOGLE_ERROR_MESSAGES: Record<string, string> = {
  cancelled: "Login Google dibatalkan.",
  state_mismatch: "Sesi login-nya kedaluwarsa, coba lagi ya.",
  email_not_verified: "Email Google kamu belum terverifikasi. Pakai email lain atau login pakai OTP.",
  not_configured: "Login Google belum aktif. Untuk sekarang pakai OTP email ya.",
};

/** Klip showcase yang baru diunduh setelah tergulir ke layar.
 *
 *  Contoh videonya sengaja dinaikkan mutunya (270px -> 360px, bitrate 2-3x),
 *  dan itu menambah ~1,9 MB. Strip ini ada DI BAWAH lipatan: memuatnya di awal
 *  berarti menagih kuota pengunjung untuk sesuatu yang mungkin tidak pernah
 *  mereka lihat — mahal di jaringan seluler Indonesia. Dengan menunda src,
 *  yang terunduh saat halaman dibuka hanya hero. */
function LazyClip({ src }: { src: string }) {
  const ref = useRef<HTMLVideoElement>(null);
  const [show, setShow] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    // Browser tanpa IntersectionObserver (mis. WebView lawas) langsung dimuat —
    // lebih baik boros kuota daripada kotak hitam permanen.
    if (typeof IntersectionObserver === "undefined") return setShow(true);
    const io = new IntersectionObserver(
      ([e]) => { if (e.isIntersecting) { setShow(true); io.disconnect(); } },
      { rootMargin: "200px" }, // mulai unduh sedikit sebelum masuk layar
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <video
      ref={ref}
      src={show ? src : undefined}
      autoPlay
      muted
      loop
      playsInline
      className="h-40 w-[90px] bg-zinc-200 object-cover"
    />
  );
}

// S0 — ONBOARDING: nilai produk -> nomor HP -> kode OTP WhatsApp -> beranda.
export default function OnboardingPage() {
  const router = useRouter();
  // HARGA DIBACA DARI SERVER, bukan diketik di layar promosi.
  //
  // Halaman ini dibuka orang yang belum punya akun, jadi ia dulu menuliskan
  // angkanya sendiri — dan angka di layar promosi adalah angka yang paling
  // lama tidak ada yang memperbaiki. "Rp12.000 per video" masih terpampang
  // setelah harganya berubah. null = belum terjawab; kalimat harganya
  // disembunyikan sampai angkanya benar-benar diketahui.
  const [mulaiIdr, setMulaiIdr] = useState<number | null>(null);
  useEffect(() => {
    fetch("/api/harga-publik")
      .then((r) => r.json())
      .then((d: { mulai_idr: number | null }) => setMulaiIdr(d.mulai_idr ?? null))
      .catch(() => setMulaiIdr(null));
  }, []);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  // KESIAPAN dibaca SEKALI untuk seluruh halaman — lihat useKesiapan().
  // Versi sebelumnya cuma menjaga hero atas dengan boolean yang gagal-terbuka;
  // CTA bawah tetap mengajak daftar saat intake ditutup, jadi satu halaman
  // memberi dua jawaban untuk status sistem yang sama.
  const kesiapan = useKesiapan();
  const cta = ajakan(kesiapan);
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [devHint, setDevHint] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [monthlyVideos, setMonthlyVideos] = useState(10);
  // Nilai awal DITURUNKAN dari TIER_LANDING, bukan diketik ulang.
  const [tierPrice, setTierPrice] = useState<number>(TIER_LANDING[0].price);
  const [openFaq, setOpenFaq] = useState<number | null>(0);
  // r13 (review produk 2026-08-07): landing publik sempat mengklaim "Checkout
  // aman lewat GoPay/OVO/DANA..." tanpa syarat walau Duitku belum aktif.
  const [paymentsLive, setPaymentsLive] = useState<boolean | null>(null);
  // null = belum dijawab server. Tombol Google disembunyikan sampai server
  // BILANG kredensialnya ada — bukan sebaliknya. Menawarkan tombol yang pasti
  // gagal lebih buruk daripada tidak menawarkannya sama sekali.
  const [googleLogin, setGoogleLogin] = useState<boolean | null>(null);

  useEffect(() => {
    track("landing_view");
    fetch("/api/health")
      .then((r) => r.json())
      .then((d) => {
        setPaymentsLive(Boolean(d.payments_live));
        setGoogleLogin(Boolean(d.google_login));
      })
      .catch(() => { setPaymentsLive(false); setGoogleLogin(false); });
  }, []);

  // MASUK LANGSUNG KE FORM kalau diminta.
  //
  // Dari /coba, tombol "Render jadi video" dulu melempar ke /onboarding polos
  // — dan itu mendarat di halaman marketing LAGI, bukan di form daftar. Orang
  // yang baru saja melihat skripnya sendiri dan sudah mau lanjut malah disuruh
  // membaca ulang hero. Sekarang jalurnya menembus.
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    if (p.get("daftar") === "1" || window.location.hash === "#daftar") setStep(2);
  }, []);

  useEffect(() => {
    const reason = new URLSearchParams(window.location.search).get("google_error");
    if (!reason) return;
    setStep(2);
    setError(GOOGLE_ERROR_MESSAGES[reason] ?? "Login Google gagal. Coba lagi atau pakai OTP email.");
    // google_error dibuang dari URL, tapi `next` DIPERTAHANKAN: menghapus
    // seluruh query berarti percobaan login berikutnya kehilangan tujuannya.
    const params = new URLSearchParams(window.location.search);
    params.delete("google_error");
    const sisa = params.toString();
    window.history.replaceState(null, "", window.location.pathname + (sisa ? `?${sisa}` : ""));
  }, []);

  const humanCost = monthlyVideos * 125_000;
  const aiCost = monthlyVideos * tierPrice;
  const saving = humanCost - aiCost;
  const savingPercent = Math.round((saving / humanCost) * 100);

  async function requestOtp(e?: React.FormEvent) {
    e?.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{ dev_hint?: string; message?: string }>("/api/auth/request-otp", {
        json: { email: email.trim() },
      });
      setDevHint(res.dev_hint ?? null);
      setStep(3);
    } catch (err) {
      setError(pesanUntukPengguna(err, "Gagal kirim kode. Coba lagi ya."));
    } finally {
      setLoading(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      await apiFetch("/api/auth/verify-otp", { json: { email: email.trim(), code: code.trim() } });
      track("signup_success");
      // Datang dari /coba? Langsung ke form produk (data percobaan prefill di S2).
      // Tujuan yang tadi diminta MENANG (audit ulang FLOW-02): brand yang
      // datang dari /brands harus kembali ke /dashboard, bukan ke beranda
      // retail. Nilainya dibersihkan tujuanAman() — ia datang dari URL.
      const diminta = tujuanAman(new URLSearchParams(window.location.search).get("next"));
      router.replace(diminta ?? (sessionStorage.getItem("racun.try") ? "/bikin/produk" : "/"));
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Kode salah. Coba lagi ya.");
      setLoading(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-md flex-col bg-gradient-to-b from-amber-50 via-white to-amber-50/40 px-6 pb-8 pt-10">
      {step === 1 && (
        <>
          <div className="flex-1 space-y-9">
            <div className="flex items-center justify-between text-xs font-semibold text-zinc-500">
              {/* Nama produk TIDAK ditulis ulang di sini — dibaca dari
                  lib/identitas-platform.ts, sama dengan SiteChrome dan
                  <title>. Halaman ini pernah dua kali tertinggal saat namanya
                  berubah; satu sumber menutup itu untuk seterusnya. */}
              {/* Pil "● Harga transparan" DICABUT 1 Sep 2026.
                  Lencana kecil bertitik di pojok adalah bahasa visual yang
                  sudah terlalu sering dipakai halaman buatan AI, dan ia juga
                  tidak membuktikan apa pun — klaim transparansi yang tidak
                  disertai angka cuma stiker. Janjinya sekarang ditepati di
                  section "Harga transparan" di bawah, lengkap dengan harga
                  sebenarnya. */}
              <span className="font-display text-base font-extrabold text-zinc-900">AIUGC.ID <span className="text-amber-500">AI</span></span>
            </div>
            <div className="mx-auto w-48 overflow-hidden rounded-[28px] bg-zinc-900 shadow-2xl shadow-amber-900/10 ring-1 ring-black/5">
              <video src="/demo/contoh-hero.mp4" autoPlay muted loop playsInline className="aspect-[9/16] w-full" />
            </div>
            {/* JUDUL: yang dijual bukan "tanpa syuting" — itu caranya, bukan
                masalahnya. Masalah penjual TikTok Shop adalah konten harus
                jalan TIAP HARI dan mereka tidak sanggup mengejarnya. Judulnya
                menyebut beban itu, bukan fitur kita.

                ANGKANYA NYATA, bukan bumbu — dan sejak harga bisa diubah admin
                tanpa deploy, ia DIBACA dari /api/harga-publik alih-alih diketik
                di sini. Rp125.000 = titik tengah riset Fastwork yang sama
                dipakai kalkulator di bawah. "Video pertama gratis" tetap persis
                benar karena paket gratis pendaftar berupa satu video. */}
            <div className="space-y-3">
              <h1 className="text-center font-display text-[2.3rem] font-extrabold leading-[1.08] tracking-tight text-zinc-900">
                Konten jualan tiap hari
                <br />
                <span className="text-amber-500">tanpa syuting.</span>
              </h1>
              <p className="text-center text-lg leading-snug text-zinc-600">
                Upload foto produk, biasanya {JANJI_WAKTU.kisaran} kemudian videonya siap ditinjau.
                <br />
                {mulaiIdr ? (
                  <>
                    Mulai <b className="text-zinc-900">Rp{mulaiIdr.toLocaleString("id-ID")}</b> per video — jasa UGC biasanya sekitar Rp100–150 ribu.
                  </>
                ) : (
                  <>Bayar per video — jasa UGC biasanya sekitar Rp100–150 ribu.</>
                )}
              </p>
              <a
                href={cta.href}
                onClick={(e) => {
                  if (!cta.mulaiDaftar) { track("hero_cta_click", { kesiapan }); return; }
                  e.preventDefault(); track("hero_cta_click"); setStep(2);
                }}
                aria-disabled={kesiapan === "memuat"}
                className="mx-auto flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-amber-500 px-6 text-lg font-extrabold text-white shadow-lg shadow-amber-500/25 active:bg-amber-600"
              >
                {cta.label}
              </a>
              {cta.catatan && (
                <p className="text-center text-sm text-zinc-500">{cta.catatan}</p>
              )}
              {/* Magic moment tanpa daftar (2026-08-06): rasakan hasil dulu,
                  daftar belakangan. Turun jadi tautan kecil — dulu ini satu-
                  satunya tombol di hero, jadi pengunjung yang sudah yakin pun
                  digiring ke jalur "lihat skrip" yang tidak menghasilkan akun. */}
              <a
                href="/coba"
                onClick={() => track("try_signup_click", { from: "hero" })}
                className="mx-auto flex min-h-[44px] w-fit items-center justify-center text-sm font-semibold text-zinc-500 underline decoration-zinc-300 underline-offset-4"
              >
                Belum yakin? Lihat contoh skripnya dulu — tanpa daftar
              </a>
              {/* MASUK — sebelumnya TIDAK ADA di halaman ini sama sekali.
                  Pengguna lama yang membuka aiugc.id tidak punya satu pun
                  jalan kembali ke akunnya selain menebak alamat. Formnya sama
                  dengan daftar (OTP email), jadi tombolnya membuka langkah
                  yang sama — yang berbeda cuma kalimatnya, dan itu memang
                  yang dicari orang dengan matanya. */}
              <button
                type="button"
                onClick={() => { track("signin_click", { from: "hero" }); setStep(2); }}
                className="mx-auto flex min-h-[44px] w-fit items-center justify-center text-sm text-zinc-500"
              >
                Sudah punya akun? <span className="ml-1 font-semibold text-amber-700 underline underline-offset-4">Masuk</span>
              </button>
            </div>
            <div>
              <p className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-zinc-400">
                Semua ini AI — tidak ada yang disyuting
              </p>
              <div className="-mx-6 flex gap-3 overflow-x-auto px-6 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
                {/* Render asli dari pipeline kita sendiri, di-encode ulang dari
                    sumber 720p (2026-08-12). Yang lama 270x480 @120 kbps dan
                    terlihat pecah — kami menjual kualitas video, jadi contoh
                    yang buram adalah argumen yang melawan diri sendiri. */}
                {[
                  { src: "/showcase/hijaber.mp4", label: "Hijaber" },
                  { src: "/showcase/genz.mp4", label: "Gen-Z" },
                  { src: "/showcase/ibu.mp4", label: "Ibu" },
                  { src: "/showcase/tangan.mp4", label: "Tanpa wajah" },
                ].map((s, i) => (
                  <div key={i} className="relative shrink-0 overflow-hidden rounded-2xl shadow-md ring-1 ring-black/5">
                    <LazyClip src={s.src} />
                    <span className="absolute bottom-1.5 left-1.5 rounded-full bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white backdrop-blur-sm">
                      {s.label}
                    </span>
                  </div>
                ))}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-2">
              {[
                // Angka-angka ini dihitung ulang dari kode 2026-08-12, bukan
                // disalin: "11 kreator" = CREATORS di app/bikin/gaya yang
                // active:true (yang ke-12, "daerah", masih dimatikan), dan
                // Harga TIDAK lagi diketik di sini: ia dibaca dari
                // /api/harga-publik. Sebelumnya tertulis "5 gaya" —
                // MENGECILKAN produk sendiri.
                { value: "15–30 detik", label: "video siap ditinjau" },
                { value: JANJI_WAKTU.singkat, label: "rata-rata selesai render" },
                { value: "11 kreator", label: "wajah AI siap pakai" },
                { value: mulaiIdr ? `Rp${mulaiIdr.toLocaleString("id-ID")}` : "—", label: "mulai per video" },
              ].map((f) => (
                <div
                  key={f.label}
                  className="rounded-2xl border border-amber-100 bg-white px-3 py-3 shadow-sm"
                >
                  <p className="font-display text-lg font-extrabold text-zinc-900">{f.value}</p>
                  <p className="text-[11px] leading-tight text-zinc-500">{f.label}</p>
                </div>
              ))}
            </div>

            <section className="rounded-[28px] bg-zinc-900 p-5 text-white shadow-xl shadow-zinc-900/15">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-300">Kalkulator hemat biaya</p>
              <h2 className="mt-2 font-display text-2xl font-extrabold leading-tight">Berapa video yang kamu butuh tiap bulan?</h2>
              <div className="mt-5 flex items-end justify-between"><span className="text-4xl font-extrabold text-amber-300">{monthlyVideos}</span><span className="mb-1 text-sm text-zinc-300">video / bulan</span></div>
              <input aria-label="Jumlah video per bulan" type="range" min="1" max="100" value={monthlyVideos} onChange={(e) => setMonthlyVideos(Number(e.target.value))} className="mt-3 w-full accent-amber-400" />
              <div className="mt-5 grid grid-cols-3 gap-2">
                {TIER_LANDING.map((tier) => <button type="button" key={tier.price} onClick={() => setTierPrice(tier.price)} className={`rounded-xl border px-2 py-2 text-left text-[11px] font-bold ${tierPrice === tier.price ? "border-amber-300 bg-amber-400 text-zinc-950" : "border-zinc-700 text-zinc-200"}`}><span className="block leading-tight">{tier.label}</span><span className="mt-1 block text-xs">Rp{tier.price.toLocaleString("id-ID")}</span></button>)}
              </div>
              <div className="mt-5 rounded-2xl bg-white p-4 text-zinc-900"><div className="flex justify-between text-xs text-zinc-500"><span>Jasa UGC manusia*</span><span className="line-through">Rp{humanCost.toLocaleString("id-ID")}</span></div><div className="mt-1 flex justify-between text-xs text-zinc-500"><span>AIUGC.ID</span><span>Rp{aiCost.toLocaleString("id-ID")}</span></div><p className="mt-3 font-display text-2xl font-extrabold text-emerald-600">Hemat Rp{saving.toLocaleString("id-ID")}</p><p className="text-sm font-bold text-emerald-600">{savingPercent}% lebih hemat</p></div>
              <p className="mt-3 text-[10px] leading-relaxed text-zinc-400">*Estimasi Rp100–150 ribu/video dari riset pasar Fastwork; kalkulator memakai titik tengah Rp125 ribu.</p>
            </section>

            {/* r13 (review produk 2026-08-07): badge metode bayar dulu tampil TANPA
                SYARAT ke semua pengunjung — janji "checkout aman" yang tidak benar
                selama Duitku belum aktif. Sekarang jujur sesuai /api/health. */}
            {/* "=== true", bukan "!== false". paymentsLive punya tiga keadaan,
                dan selama null (menunggu /api/meta) versi lama menampilkan
                klaim checkout yang belum tentu benar. Halaman /kredit sudah
                diperbaiki 16 Agu; halaman ini terlewat. */}
            {paymentsLive === true && (
            <section className="rounded-[26px] border border-zinc-100 bg-white p-5 shadow-sm">
              <p className="text-center text-xs font-semibold uppercase tracking-wide text-zinc-400">Checkout aman lewat</p>
              <div className="mt-3 flex flex-wrap items-center justify-center gap-2 text-xs font-extrabold text-zinc-600"><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">GoPay</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">OVO</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">DANA</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">QRIS</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">Virtual Account</span><span className="rounded-lg bg-zinc-100 px-2.5 py-1.5">Kartu Kredit</span></div>
              <p className="mt-3 text-center text-[11px] text-zinc-400">Metode ditampilkan oleh halaman pembayaran Duitku sesuai kanal merchant yang aktif.</p>
            </section>
            )}

            {/* HARGA TRANSPARAN — dulu cuma lencana di pojok atas.
                Section ini menggantikannya karena transparansi diukur dari
                angka yang benar-benar disebut, bukan dari kata "transparan". */}
            <section>
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-600">Harga transparan</p>
              <h2 className="mt-1 font-display text-2xl font-extrabold text-zinc-900">Bayar per video, bukan langganan</h2>
              <div className="mt-4 space-y-2">
                {TIER_LANDING.map((tier) => (
                  <div key={tier.price} className="flex items-start justify-between gap-3 rounded-2xl border border-zinc-200 bg-white p-4">
                    <span className="min-w-0">
                      <span className="block font-bold text-zinc-900">{tier.label}</span>
                      <span className="mt-0.5 block text-xs leading-5 text-zinc-500">{tier.jelas}</span>
                    </span>
                    <span className="shrink-0 text-right">
                      <span className="block font-display text-lg font-extrabold text-zinc-900">Rp{tier.price.toLocaleString("id-ID")}</span>
                      <span className="block text-[11px] text-zinc-400">per video</span>
                    </span>
                  </div>
                ))}
              </div>
              <ul className="mt-3 space-y-1.5 text-sm leading-6 text-zinc-600">
                <li>Tidak ada biaya bulanan. Isi saldo seperlunya, pakai kapan saja.</li>
                <li>Kalau video gagal dibuat, kreditnya kembali ke saldomu.</li>
                <li>Harga di atas sudah termasuk suara. Tidak ada biaya tambahan di akhir.</li>
              </ul>
            </section>

            <section><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-600">Jawaban jujur sebelum mulai</p><h2 className="mt-1 font-display text-2xl font-extrabold text-zinc-900">Yang perlu kamu tahu</h2><div className="mt-4 space-y-2">{[
              ["Videonya kelihatan AI? Aman dari TikTok Shop?", "Video diberi label AIGC dan kamu tetap perlu menyalakan label konten AI saat upload. Kami tidak menyembunyikan asal konten—ini membantu kamu mengikuti aturan platform."],
              ["Kalau hasilnya jelek gimana?", "Sistem QC memeriksa wajah yang tidak diinginkan dan konsistensi produk. Jika job gagal QC atau gagal render, kredit di-release otomatis lewat ledger."],
              ["Foto produk aku dipakai bagaimana?", "Foto asli dipakai sebagai referensi visual produk. Pipeline menjaga produk tetap konsisten; bukan meminta AI mengarang ulang detail produkmu."],
              ["Bisa pakai link Tokopedia langsung?", "Tokopedia dapat dibaca best-effort. TikTok Shop dan Shopee yang memblokir pembacaan otomatis akan meminta kamu isi detail produk secara manual."],
              ["Berapa lama sampai jadi?", `Biasanya ${JANJI_WAKTU.kisaran} per video — kalau antrean AI padat bisa sampai ${JANJI_WAKTU.ekor}. Halaman hasil memperbarui sendiri.`],
              ["Ada garansi kalau render gagal?", "Ya. Hold kredit dilepas otomatis ketika job gagal, jadi saldo bisa dipakai lagi untuk mencoba render berikutnya."],
            ].map(([q,a],i)=><div key={q} className="rounded-2xl border border-zinc-200 bg-white"><button type="button" onClick={()=>setOpenFaq(openFaq===i?null:i)} className="flex w-full items-center justify-between gap-3 px-4 py-4 text-left text-sm font-bold text-zinc-800"><span>{q}</span><span className="text-amber-500">{openFaq===i?"−":"+"}</span></button>{openFaq===i&&<p className="border-t border-zinc-100 px-4 py-3 text-sm leading-relaxed text-zinc-600">{a}</p>}</div>)}</div></section>

            {/* Identitas & kontak merchant di halaman depan publik — syarat
                onboarding gateway pembayaran (telepon, email, alamat terlihat
                tanpa login), sekaligus jalan masuk ke /harga dan /kontak. */}
            <SiteFooter />
          </div>
          {/* "Coba Gratis" tidak menjelaskan apa yang gratis. Paket gratis
              pendaftar memang berupa SATU VIDEO, jadi janjinya bisa dibuat
              spesifik tanpa melebih-lebihkan — dan tetap benar walau harganya
              diubah admin. */}
          {cta.mulaiDaftar ? (
            <PrimaryButton big onClick={() => { track("bottom_cta_click"); setStep(2); }}>
              {cta.label}
            </PrimaryButton>
          ) : (
            <a href={cta.href} onClick={() => track("bottom_cta_click", { kesiapan })}
              className="flex min-h-[56px] w-full items-center justify-center rounded-2xl bg-amber-500 px-6 text-lg font-extrabold text-white shadow-lg shadow-amber-500/25 active:bg-amber-600">
              {cta.label}
            </a>
          )}
          <p className="mt-2 text-center text-xs text-zinc-500">
            {cta.mulaiDaftar
              ? "Daftar dapat 1 video gratis. Tanpa kartu kredit."
              : cta.catatan}
          </p>
          <button type="button" onClick={() => setStep(2)} className="mt-3 min-h-[44px] w-full text-center text-sm text-zinc-500">
            Sudah punya akun? Masuk
          </button>
        </>
      )}

      {step === 2 && (
        <>
          <div className="flex-1 space-y-6 pt-8">
            <h1 className="text-2xl font-bold text-zinc-900">Masuk pakai email</h1>
            <p className="text-zinc-600">
              Tanpa password. Kami kirim kode 6 digit ke email kamu. User baru langsung dapat 1 video gratis.
            </p>
            {/* PERSETUJUAN DI TITIK DAFTAR, bukan cuma tautan di kaki halaman.
                Audit kedalaman: tombol daftar (email maupun Google) tidak
                menampilkan persetujuan Syarat & Privasi di dekatnya. Untuk
                produk yang mengirim foto pengguna ke penyedia luar negeri,
                persetujuan yang tidak pernah terlihat bukan persetujuan. */}
            <p className="text-xs leading-5 text-zinc-500">
              Dengan lanjut, kamu setuju pada{" "}
              <a href="/legal/terms" className="font-semibold text-zinc-700 underline underline-offset-2">Syarat &amp; Ketentuan</a>{" "}
              dan{" "}
              <a href="/legal/privacy" className="font-semibold text-zinc-700 underline underline-offset-2">Kebijakan Privasi</a>.
              Foto yang kamu unggah diproses oleh penyedia AI di luar negeri untuk membuat videomu.
            </p>
            {googleLogin === true && (
            <a
              href={`/api/auth/google${
                typeof window !== "undefined" && tujuanAman(new URLSearchParams(window.location.search).get("next"))
                  ? `?next=${encodeURIComponent(tujuanAman(new URLSearchParams(window.location.search).get("next"))!)}`
                  : ""
              }`}
              className="flex min-h-[56px] w-full items-center justify-center gap-3 rounded-2xl border-2 border-zinc-200 bg-white text-base font-semibold text-zinc-700 active:bg-zinc-50"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" aria-hidden="true">
                <path fill="#4285F4" d="M19.6 10.23c0-.68-.06-1.36-.18-2H10v3.79h5.4a4.63 4.63 0 0 1-2 3.04v2.5h3.24c1.9-1.75 3-4.32 3-7.33Z" />
                <path fill="#34A853" d="M10 20c2.7 0 4.96-.9 6.62-2.44l-3.24-2.5c-.9.6-2.05.96-3.38.96-2.6 0-4.8-1.75-5.59-4.11H1.06v2.58A10 10 0 0 0 10 20Z" />
                <path fill="#FBBC05" d="M4.41 11.9a6 6 0 0 1 0-3.8V5.52H1.06a10 10 0 0 0 0 8.96l3.35-2.58Z" />
                <path fill="#EA4335" d="M10 3.98c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.6 9.6 0 0 0 10 0 10 10 0 0 0 1.06 5.52L4.41 8.1C5.2 5.73 7.4 3.98 10 3.98Z" />
              </svg>
              Masuk pakai Google
            </a>
            )}
            {googleLogin === true && (
              <div className="flex items-center gap-3 text-sm text-zinc-400">
                <div className="h-px flex-1 bg-zinc-200" /> atau <div className="h-px flex-1 bg-zinc-200" />
              </div>
            )}
            <form onSubmit={requestOtp} className="space-y-4">
              <input
                type="email"
                inputMode="email"
                placeholder="nama@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value.trim())}
                className="min-h-[56px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-lg outline-none focus:border-amber-500"
              />
              <ErrorText message={error} />
              <PrimaryButton type="submit" disabled={loading || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())}>
                {loading ? "Mengirim kode..." : "Kirim Kode OTP"}
              </PrimaryButton>
            </form>
          </div>
          <button type="button" onClick={() => setStep(1)} className="min-h-[44px] w-full text-center text-sm text-zinc-500">
            ← Kembali
          </button>
        </>
      )}

      {step === 3 && (
        <>
          <div className="flex-1 space-y-6 pt-8">
            <h1 className="text-2xl font-bold text-zinc-900">Masukkan kode OTP</h1>
            <p className="text-zinc-600">
              Kode 6 digit sudah dikirim ke email <b>{email}</b>. Berlaku 5 menit.
              Cek folder spam kalau belum masuk.
            </p>
            {devHint && (
              <p className="rounded-2xl bg-zinc-100 p-3 text-sm text-zinc-600">🛠 {devHint}</p>
            )}
            <form onSubmit={verify} className="space-y-4">
              <input
                type="text"
                inputMode="numeric"
                placeholder="••••••"
                maxLength={6}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
                className="min-h-[64px] w-full rounded-2xl border-2 border-zinc-200 bg-white px-4 text-center text-3xl font-bold tracking-[0.5em] outline-none focus:border-amber-500"
                autoFocus
              />
              <ErrorText message={error} />
              <PrimaryButton type="submit" disabled={loading || code.length !== 6}>
                {loading ? "Memeriksa..." : "Masuk & Mulai"}
              </PrimaryButton>
            </form>
            <button
              type="button"
              onClick={() => requestOtp()}
              disabled={loading}
              className="min-h-[48px] w-full text-center font-semibold text-amber-600 disabled:text-zinc-400"
            >
              Kirim ulang kode
            </button>
          </div>
          <button type="button" onClick={() => setStep(2)} className="min-h-[44px] w-full text-center text-sm text-zinc-500">
            ← Ganti email
          </button>
        </>
      )}
    </div>
  );
}
