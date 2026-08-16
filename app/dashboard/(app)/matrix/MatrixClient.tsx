"use client";

import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { AlertCircle, Check, Grid3x3, Loader2, Users, Zap } from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";

/**
 * MATRIKS AVATAR x SKENARIO — satu produk, banyak kombinasi.
 *
 * Permintaan Brian, dua kalimat: "1 avatar jelasin produk saya dengan berbagai
 * scenario" DAN "1 produk di promoin sama puluhan avatar beda2". Halaman ini
 * tidak memisahkan keduanya jadi dua mode, karena keduanya adalah perkalian
 * yang sama dengan salah satu daftar berisi satu item. Dua mode berarti dua
 * jalur kode yang akan menyimpang; satu grid berarti brand bisa berada di
 * antara keduanya (3 avatar x 2 skenario) tanpa kami harus memikirkannya.
 *
 * Yang paling penting di layar ini BUKAN pemilihnya, tapi angkanya: berapa
 * video dan berapa rupiah. Matriks membuat salah klik jadi mahal secara
 * eksponensial — 4 avatar x 3 skenario terlihat seperti dua pilihan kecil dan
 * ternyata 12 video. Karena itu ringkasannya menempel (sticky) dan biayanya
 * dihitung dari tarif yang dikirim server, bukan disalin ke sini.
 */

interface Produk { product_id: string; name: string; price_idr: number; category: string; image: string | null }
interface Avatar { id: string; name: string; note: string; img: string; gender: "female" | "male" }
interface Skenario { id: string; name: string; when: string; format: string; duration_sec: number; ratio: string | null }
interface Katalog {
  products: Produk[]; avatars: Avatar[]; scenarios: Skenario[];
  limits: { max_cells: number; max_avatars: number; max_scenarios: number };
  /** Tarif per (tier:durasi), dikirim server — lihat catatan di route-nya. */
  prices: Record<string, number>;
}
interface HasilSel { status: "queued" | "failed"; script_id: string; job_id?: string; reason?: string; avatar_id: string; template_id: string }

const TIERS = [
  { id: "high_quality", label: "Quality", note: "720p, suara AI" },
  { id: "super_hq", label: "High Quality", note: "1080p, suara + gerak bibir" },
] as const;

// Sisi terpanjang disamakan (22px) supaya yang membedakan bentuknya, bukan
// ukurannya — sama seperti di wizard kampanye.
const RATIOS = [
  { id: "9:16", label: "9:16", w: 12, h: 22, untuk: "TikTok, Reels, Shorts" },
  { id: "1:1", label: "1:1", w: 18, h: 18, untuk: "Feed Instagram" },
  { id: "16:9", label: "16:9", w: 22, h: 12, untuk: "YouTube, layar lebar" },
];

const LABEL_FORMAT: Record<string, string> = {
  hands_only: "Tangan + VO", talking_head: "Wajah AI", tvc: "TVC", ads: "Iklan Jasa", vo_broll: "VO + B-roll",
};

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

export default function MatrixClient() {
  const [katalog, setKatalog] = useState<Katalog | null>(null);
  const [produkId, setProdukId] = useState("");
  const [avatarIds, setAvatarIds] = useState<string[]>([]);
  const [skenarioIds, setSkenarioIds] = useState<string[]>([]);
  const [gender, setGender] = useState<"female" | "male">("female");
  const [tier, setTier] = useState<string>("high_quality");
  const [ratio, setRatio] = useState("9:16");
  const [sibuk, setSibuk] = useState(false);
  // Konfirmasi belanja. Tombol sticky dulu langsung POST ke render — satu klik
  // yang bisa bernilai jutaan rupiah tanpa satu pun layar yang menyebutkan
  // angkanya secara utuh.
  const [konfirmasi, setKonfirmasi] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasil, setHasil] = useState<{ run_id: string; results: HasilSel[]; queued_count: number; duplicated?: boolean } | null>(null);
  // Kunci idempotensi dibekukan saat susunan matriks berubah, BUKAN saat
  // tombol ditekan: kunci yang dibuat di dalam handler akan berbeda tiap klik
  // dan justru tidak menjaga apa pun.
  const kunciIdem = useMemo(
    () => `${produkId}|${[...avatarIds].sort().join(",")}|${[...skenarioIds].sort().join(",")}|${tier}|${ratio}`,
    [produkId, avatarIds, skenarioIds, tier, ratio]
  );

  useEffect(() => {
    apiFetch<Katalog>("/api/dashboard/matrix")
      .then((k) => { setKatalog(k); setProdukId(k.products[0]?.product_id ?? ""); })
      .catch((err) => setError(err instanceof ApiFail ? err.message : "Gagal memuat katalog."));
  }, []);

  const produk = katalog?.products.find((p) => p.product_id === produkId) ?? null;
  const sel = avatarIds.length * skenarioIds.length;
  const maksSel = katalog?.limits.max_cells ?? 24;
  const kelebihan = sel > maksSel;

  // Tarif DIAMBIL dari server, bukan dihitung ulang di sini. Menyalin angka
  // tarif ke komponen klien sudah pernah dibayar sekali di repo ini: salinan
  // tarif pasti hanyut, dan yang menemukan selisihnya pengguna — setelah
  // menekan tombol yang menjanjikan angka lain.
  // Total dijumlahkan PER SKENARIO karena tiap skenario punya durasinya
  // sendiri — skenario 30 detik memang dua kali lipat yang 15 detik. Rumus
  // "satu harga x jumlah sel" hanya benar kalau semua skenario sama panjang,
  // dan katalognya tidak begitu.
  const totalBiaya = useMemo(() => {
    if (!katalog) return 0;
    return skenarioIds.reduce((n, sid) => {
      const sk = katalog.scenarios.find((x) => x.id === sid);
      return n + (sk ? (katalog.prices[`${tier}:${sk.duration_sec}`] ?? 0) * avatarIds.length : 0);
    }, 0);
  }, [katalog, skenarioIds, avatarIds.length, tier]);

  function toggle(daftar: string[], set: (v: string[]) => void, id: string) {
    set(daftar.includes(id) ? daftar.filter((x) => x !== id) : [...daftar, id]);
  }

  async function jalankan() {
    if (!produk || sel === 0 || kelebihan) return;
    setSibuk(true); setError(null);
    try {
      const res = await apiFetch<{ run_id: string; results: HasilSel[]; queued_count: number }>("/api/dashboard/matrix", {
        json: {
          product_id: produk.product_id, avatar_ids: avatarIds, template_ids: skenarioIds,
          tier, ratio,
          // Total yang BENAR-BENAR tampil di layar. Server menolak kalau
          // hitungannya berbeda — persetujuan hanya sah untuk angka yang
          // disetujui.
          expected_total_idr: totalBiaya,
          // Kunci idempotensi dibuat sekali per susunan matriks (lihat
          // kunciKirim) supaya klik ganda, retry jaringan, atau tombol back
          // tidak pernah menagih matriks yang sama dua kali.
          idempotency_key: kunciIdem,
        },
      });
      setHasil(res);
      setKonfirmasi(false);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menjalankan matriks.");
    } finally { setSibuk(false); }
  }

  if (!katalog) {
    return (
      <div className="flex items-center gap-2 text-sm text-zinc-500">
        <Loader2 size={16} className="animate-spin" /> Memuat katalog…
      </div>
    );
  }

  if (hasil) {
    const antre = hasil.results.filter((r) => r.status === "queued");
    const gagal = hasil.results.filter((r) => r.status === "failed");
    return (
      <div className="space-y-6">
        <div>
          <h1 className="font-display text-2xl font-bold text-zinc-900">
            {antre.length} video masuk antrean
          </h1>
          <p className="mt-1 text-sm text-zinc-500">
            Tiap video berhenti di gerbang review scene dulu — kamu menilai gambarnya sebelum digabung.
          </p>
        </div>
        {gagal.length > 0 && (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4">
            <p className="text-sm font-semibold text-amber-900">{gagal.length} sel tidak jadi dirender:</p>
            <ul className="mt-1.5 space-y-1 text-xs text-amber-800">
              {gagal.map((g, i) => (
                <li key={i}>
                  {katalog.avatars.find((a) => a.id === g.avatar_id)?.name ?? g.avatar_id}
                  {" × "}
                  {katalog.scenarios.find((s) => s.id === g.template_id)?.name ?? g.template_id}
                  {" — "}{g.reason}
                </li>
              ))}
            </ul>
          </div>
        )}
        <div className="flex gap-3">
          <Link href="/dashboard/library" className="rounded-xl bg-zinc-900 px-5 py-3 text-sm font-bold text-white">
            Lihat hasilnya di Library
          </Link>
          <button onClick={() => { setHasil(null); setAvatarIds([]); setSkenarioIds([]); }}
            className="rounded-xl border border-zinc-300 px-5 py-3 text-sm font-semibold text-zinc-700">
            Susun matriks lain
          </button>
        </div>
      </div>
    );
  }

  const avatarTampil = katalog.avatars.filter((a) => a.gender === gender);

  return (
    <div className="space-y-8 pb-32">
      <div>
        <h1 className="flex items-center gap-2 font-display text-2xl font-bold text-zinc-900">
          <Grid3x3 size={22} className="text-amber-600" /> Matriks avatar × skenario
        </h1>
        <p className="mt-1 text-sm text-zinc-500">
          Satu produk, banyak wajah, banyak sudut cerita. Pilih avatarnya, pilih skenarionya — yang dirender semua kombinasinya.
        </p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
        </div>
      )}

      {/* ---------- produk ---------- */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">1. Produk</h2>
        {katalog.products.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center">
            <p className="text-sm text-zinc-600">Belum ada produk tersimpan.</p>
            <Link href="/dashboard/campaign" className="mt-2 inline-block text-sm font-semibold text-amber-700 underline underline-offset-2">
              Bikin satu video dulu lewat wizard →
            </Link>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {katalog.products.map((p) => {
              const dipilih = p.product_id === produkId;
              return (
                <button key={p.product_id} onClick={() => setProdukId(p.product_id)} aria-pressed={dipilih}
                  className={`flex items-center gap-3 rounded-xl border p-3 text-left transition-colors ${dipilih ? "border-amber-500 bg-amber-50" : "border-zinc-200 hover:bg-zinc-50"}`}>
                  {p.image ? (
                    <Image src={`/media/${p.image}`} alt="" width={40} height={40} className="h-10 w-10 shrink-0 rounded-lg object-cover" />
                  ) : (
                    <span className="h-10 w-10 shrink-0 rounded-lg bg-zinc-100" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-zinc-900">{p.name}</span>
                    <span className="block text-xs text-zinc-500">{rupiah(p.price_idr)}</span>
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </section>

      {/* ---------- sumbu avatar ---------- */}
      <section>
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
            2. Avatar <span className="text-amber-600">({avatarIds.length} dipilih)</span>
          </h2>
          <div className="flex gap-1 rounded-lg border border-zinc-200 p-0.5">
            {(["female", "male"] as const).map((g) => (
              <button key={g} onClick={() => setGender(g)} aria-pressed={gender === g}
                className={`rounded-md px-3 py-1 text-xs font-semibold transition-colors ${gender === g ? "bg-zinc-900 text-white" : "text-zinc-600"}`}>
                {g === "female" ? "Perempuan" : "Laki-laki"}
              </button>
            ))}
          </div>
        </div>
        <div className="grid grid-cols-3 gap-3 sm:grid-cols-4 lg:grid-cols-6">
          {avatarTampil.map((a) => {
            const dipilih = avatarIds.includes(a.id);
            return (
              <button key={a.id} onClick={() => toggle(avatarIds, setAvatarIds, a.id)} aria-pressed={dipilih}
                title={a.note}
                className={`relative overflow-hidden rounded-xl border-2 text-left transition-colors ${dipilih ? "border-amber-500" : "border-transparent hover:border-zinc-300"}`}>
                <Image src={a.img} alt={a.name} width={160} height={200} className="aspect-[4/5] w-full object-cover" />
                {dipilih && (
                  <span className="absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-full bg-amber-500 text-white">
                    <Check size={13} strokeWidth={3} />
                  </span>
                )}
                <span className="block truncate px-2 py-1.5 text-xs font-semibold text-zinc-800">{a.name}</span>
              </button>
            );
          })}
        </div>
        <button onClick={() => setAvatarIds(avatarTampil.slice(0, katalog.limits.max_avatars).map((a) => a.id))}
          className="mt-2 text-xs font-semibold text-amber-700 underline underline-offset-2">
          Pilih semua {gender === "female" ? "perempuan" : "laki-laki"} (maks {katalog.limits.max_avatars})
        </button>
      </section>

      {/* ---------- sumbu skenario ---------- */}
      <section>
        <h2 className="mb-3 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">
          3. Skenario <span className="text-amber-600">({skenarioIds.length} dipilih)</span>
        </h2>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
          {katalog.scenarios.map((s) => {
            const dipilih = skenarioIds.includes(s.id);
            return (
              <button key={s.id} onClick={() => toggle(skenarioIds, setSkenarioIds, s.id)} aria-pressed={dipilih}
                className={`flex items-start gap-2.5 rounded-xl border p-3 text-left transition-colors ${dipilih ? "border-amber-500 bg-amber-50" : "border-zinc-200 hover:bg-zinc-50"}`}>
                <span className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border-2 ${dipilih ? "border-amber-500 bg-amber-500 text-white" : "border-zinc-300"}`}>
                  {dipilih && <Check size={11} strokeWidth={3} />}
                </span>
                <span className="min-w-0">
                  <span className="block text-sm font-semibold text-zinc-900">{s.name}</span>
                  <span className="block text-xs leading-4 text-zinc-500">{s.when}</span>
                  {/* Format dan durasi MILIK skenario, bukan pilihan terpisah.
                      Ditampilkan supaya brand tahu apa yang benar-benar akan
                      dirender sebelum membayar — bukan menemukan skenario TVC
                      keluar sebagai hands-only setelah 24 video jadi. */}
                  <span className="mt-1.5 flex flex-wrap gap-1">
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">{LABEL_FORMAT[s.format] ?? s.format}</span>
                    <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">{s.duration_sec} dtk</span>
                    {s.ratio && <span className="rounded bg-zinc-100 px-1.5 py-0.5 text-[11px] font-semibold text-zinc-600">{s.ratio}</span>}
                    <span className="rounded bg-amber-50 px-1.5 py-0.5 text-[11px] font-semibold text-amber-700">{rupiah(katalog.prices[`${tier}:${s.duration_sec}`] ?? 0)}/video</span>
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------- pengaturan ---------- */}
      <section className="grid grid-cols-1 gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Kualitas</p>
          <div className="flex flex-wrap gap-2">
            {TIERS.map((t) => (
              <button key={t.id} onClick={() => setTier(t.id)} aria-pressed={tier === t.id} title={t.note}
                className={`rounded-lg border px-3 py-2 text-sm font-medium transition-colors ${tier === t.id ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-[0.08em] text-zinc-500">Rasio</p>
          <div className="flex gap-2">
            {RATIOS.map((r) => {
              const dipilih = ratio === r.id;
              return (
                <button key={r.id} onClick={() => setRatio(r.id)} aria-pressed={dipilih}
                  aria-label={`Rasio ${r.label} — ${r.untuk}`} title={r.untuk}
                  className={`flex min-w-[76px] flex-col items-center gap-1.5 rounded-lg border px-3 py-2.5 text-sm font-medium transition-colors ${dipilih ? "border-amber-500 bg-amber-50 text-amber-700" : "border-zinc-300 text-zinc-600 hover:bg-zinc-50"}`}>
                  {/* Kotak berbentuk rasionya — angka "9:16" tidak berarti apa-apa
                      buat kebanyakan penjual, bentuknya langsung terbaca. */}
                  <span className="flex h-[22px] items-center justify-center" aria-hidden="true">
                    <span style={{ width: r.w, height: r.h }}
                      className={`block rounded-[3px] border-2 ${dipilih ? "border-amber-500 bg-amber-100" : "border-zinc-400 bg-white"}`} />
                  </span>
                  <span>{r.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      </section>

      {/* ---------- konfirmasi belanja ----------
          Layar terakhir sebelum uang bergerak. Ia menyebut jumlah video, total
          rupiah, dan rincian per skenario — lalu meminta klik kedua yang
          terpisah. Board menandai ketiadaannya sebagai blocker: eksposur satu
          klik mencapai jutaan rupiah tanpa pengguna pernah melihat totalnya
          dinyatakan utuh. */}
      {konfirmasi && (
        <div className="fixed inset-0 z-30 flex items-end justify-center bg-zinc-900/40 p-4 sm:items-center">
          <div className="w-full max-w-md rounded-2xl bg-white p-5 shadow-xl">
            <h2 className="font-display text-lg font-bold text-zinc-900">Konfirmasi pesanan</h2>
            <p className="mt-1 text-sm text-zinc-500">
              Kredit organisasi ditahan begitu kamu menekan tombol di bawah.
            </p>
            <div className="mt-4 space-y-1.5 rounded-xl border border-zinc-200 p-3">
              {skenarioIds.map((sid) => {
                const sk = katalog.scenarios.find((x) => x.id === sid);
                if (!sk) return null;
                const h = (katalog.prices[`${tier}:${sk.duration_sec}`] ?? 0) * avatarIds.length;
                return (
                  <div key={sid} className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0 truncate text-zinc-700">
                      {sk.name} <span className="text-zinc-400">× {avatarIds.length} avatar</span>
                    </span>
                    <span className="shrink-0 font-semibold text-zinc-900">{rupiah(h)}</span>
                  </div>
                );
              })}
              <div className="mt-2 flex items-baseline justify-between border-t border-zinc-200 pt-2">
                <span className="text-sm font-bold text-zinc-900">Total {sel} video</span>
                <span className="font-display text-lg font-bold text-amber-700">{rupiah(totalBiaya)}</span>
              </div>
            </div>
            <div className="mt-4 flex gap-2">
              <button onClick={() => setKonfirmasi(false)} disabled={sibuk}
                className="flex-1 rounded-xl border border-zinc-300 px-4 py-3 text-sm font-semibold text-zinc-700 disabled:opacity-50">
                Batal
              </button>
              <button onClick={jalankan} disabled={sibuk}
                className="flex flex-[2] items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-bold text-white disabled:bg-zinc-300">
                {sibuk ? <Loader2 size={16} className="animate-spin" /> : <Zap size={16} />}
                {sibuk ? "Menyusun…" : `Ya, render ${rupiah(totalBiaya)}`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---------- ringkasan menempel ----------
          Menempel karena matriks membuat biaya tumbuh secara perkalian: dua
          pilihan yang masing-masing terasa kecil bisa jadi 12 video. Angkanya
          harus terlihat SAAT memilih, bukan setelah menggulir ke bawah. */}
      <div className="fixed bottom-0 left-0 right-0 z-20 border-t border-zinc-200 bg-white/95 px-6 py-4 backdrop-blur md:left-64">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
          <div className="text-sm">
            <span className="flex items-center gap-1.5 font-semibold text-zinc-900">
              <Users size={15} className="text-zinc-400" />
              {avatarIds.length} avatar × {skenarioIds.length} skenario = <b className={kelebihan ? "text-red-600" : "text-amber-700"}>{sel} video</b>
            </span>
            <span className="text-xs text-zinc-500">
              {sel > 0 ? `Total ${rupiah(totalBiaya)} — dipotong dari saldo organisasi` : "Pilih minimal 1 avatar dan 1 skenario"}
            </span>
          </div>
          {kelebihan ? (
            <p className="text-xs font-semibold text-red-600">
              Di atas batas {maksSel} video sekali jalan — kurangi salah satu sumbunya.
            </p>
          ) : (
            <button onClick={() => setKonfirmasi(true)} disabled={sibuk || sel === 0 || !produk}
              className="flex items-center gap-2 rounded-xl bg-amber-500 px-6 py-3 text-sm font-bold text-white transition-colors hover:bg-amber-600 disabled:cursor-not-allowed disabled:bg-zinc-300">
              <Zap size={16} />
              {`Lanjut — ${sel} video`}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
