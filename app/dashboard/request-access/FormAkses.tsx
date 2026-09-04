"use client";

import { useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { pesanUntukPengguna } from "../../_components/api";

/**
 * Form permintaan akses brand.
 *
 * Menggantikan kalimat buntu "hubungi tim BikinFYP" yang tidak menyertakan
 * satu pun cara menghubungi. Brand yang sudah login sudah menyerahkan email
 * dan berniat membayar — membiarkannya berhenti di situ berarti kehilangan
 * calon pelanggan yang paling siap, DAN tidak pernah tahu ia pernah datang.
 *
 * WhatsApp tetap ditampilkan sebagai jalur cepat: sebagian brand Indonesia
 * memang lebih percaya nomor daripada formulir.
 */
export function FormAkses({ email, whatsapp }: { email: string | null; whatsapp: string | null }) {
  const [kirim, setKirim] = useState(false);
  const [selesai, setSelesai] = useState(false);
  const [notified, setNotified] = useState(false);
  const [galat, setGalat] = useState<string | null>(null);
  const [form, setForm] = useState({ nama: "", brand: "", situs: "", whatsapp: "", volume: "" });

  const ubah = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm({ ...form, [k]: e.target.value });

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setKirim(true);
    setGalat(null);
    try {
      const res = await fetch("/api/brands/request-access", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(form),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message_id ?? "Gagal mengirim permintaan.");
      // Janji waktu HANYA kalau jalur notifikasinya benar-benar jalan.
      // Menjanjikan 1x24 jam saat email ke tim gagal berarti menaruh
      // kekecewaan di kalender pengguna.
      setNotified(body.notified === true);
      setSelesai(true);
    } catch (err) {
      setGalat(pesanUntukPengguna(err, "Gagal mengirim permintaan."));
    } finally {
      setKirim(false);
    }
  }

  const waLink = whatsapp
    ? `https://wa.me/${whatsapp.replace(/[^0-9]/g, "")}?text=${encodeURIComponent("Halo AIUGC.ID, saya mau minta akses dashboard Brands.")}`
    : null;

  if (selesai) {
    return (
      <div className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-5 text-left">
        <p className="font-bold text-emerald-300">Permintaanmu sudah masuk.</p>
        <p className="text-sm text-zinc-300">
          {notified
            ? <>Tim kami menghubungi lewat email{email ? ` (${email})` : ""} — biasanya dalam 1×24 jam kerja.</>
            : <>Permintaanmu tersimpan, tapi notifikasi ke tim kami sedang bermasalah. Supaya cepat ditangani, chat WhatsApp kami ya.</>}
        </p>
        {waLink && (
          <a href={waLink} target="_blank" rel="noreferrer"
            className="inline-flex items-center gap-1.5 rounded-xl bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/15">
            <MessageCircle size={15} /> Chat WhatsApp
          </a>
        )}
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3 text-left">
      {[
        { k: "nama" as const, label: "Nama kamu", wajib: true, placeholder: "Rani" },
        { k: "brand" as const, label: "Nama brand / agency", wajib: true, placeholder: "Mosseru" },
        { k: "situs" as const, label: "Website / toko", wajib: false, placeholder: "tokopedia.com/mosseru" },
        { k: "whatsapp" as const, label: "WhatsApp", wajib: false, placeholder: "08…" },
        { k: "volume" as const, label: "Perkiraan video per bulan", wajib: false, placeholder: "20" },
      ].map((f) => (
        <label key={f.k} className="block">
          <span className="text-xs font-semibold text-zinc-400">
            {f.label}{f.wajib ? " *" : ""}
          </span>
          <input
            value={form[f.k]}
            onChange={ubah(f.k)}
            required={f.wajib}
            placeholder={f.placeholder}
            className="mt-1 w-full rounded-xl border border-white/10 bg-white/5 px-3 py-2 text-sm text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-amber-400"
          />
        </label>
      ))}

      {galat && <p className="rounded-xl bg-red-500/10 px-3 py-2 text-sm text-red-300">{galat}</p>}

      <button
        type="submit"
        disabled={kirim}
        className="flex w-full items-center justify-center gap-2 rounded-xl bg-amber-500 px-4 py-3 text-sm font-extrabold text-zinc-950 disabled:opacity-60"
      >
        {kirim ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
        {kirim ? "Mengirim…" : "Minta akses"}
      </button>

      {waLink && (
        <a href={waLink} target="_blank" rel="noreferrer"
          className="flex items-center justify-center gap-1.5 text-sm font-semibold text-zinc-400 hover:text-zinc-200">
          <MessageCircle size={15} /> atau chat WhatsApp
        </a>
      )}
    </form>
  );
}
