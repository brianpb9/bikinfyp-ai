"use client";

import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Loader2, Plus, Shield, Trash2, Users } from "lucide-react";
import { apiFetch, ApiFail } from "../../../_components/api";

interface Member {
  user_id: string; role: "owner" | "member";
  contact: string; name: string | null; joined_at: string;
}
interface TeamResponse { can_manage: boolean; me: string; members: Member[] }

// Tim (referensi tab Team Brandfy yang Brian kirim).
//
// Semua anggota melihat dan memakai hal yang sama — belum ada izin per-fitur.
// Itu dinyatakan terang-terangan di layar, bukan disembunyikan: anggota
// berbagi satu dompet kredit, dan brand berhak tahu itu SEBELUM mengundang
// orang, bukan setelah saldonya berkurang.
export default function TeamPage() {
  const [data, setData] = useState<TeamResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setData(await apiFetch<TeamResponse>("/api/dashboard/team"));
      setError(null);
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal memuat anggota tim.");
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function invite() {
    setBusy("invite"); setError(null); setNotice(null);
    try {
      const res = await apiFetch<{ message: string }>("/api/dashboard/team", { json: { email } });
      setNotice(res.message);
      setEmail("");
      await load();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal menambah anggota.");
    } finally {
      setBusy(null);
    }
  }

  async function remove(userId: string) {
    setBusy(userId); setError(null); setNotice(null);
    try {
      await apiFetch("/api/dashboard/team", { method: "DELETE", json: { user_id: userId } });
      await load();
    } catch (err) {
      setError(err instanceof ApiFail ? err.message : "Gagal mengeluarkan anggota.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <div>
        <p className="text-xs font-bold uppercase tracking-[0.14em] text-amber-600">Organisasi</p>
        <h1 className="font-display text-2xl font-bold text-zinc-900">Tim</h1>
        <p className="mt-1 text-sm text-zinc-500">Semua anggota bisa membuat video dan memakai saldo organisasi yang sama.</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <AlertCircle size={16} className="mt-0.5 shrink-0" />{error}
        </div>
      )}
      {notice && (
        <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-800">{notice}</div>
      )}

      {data?.can_manage && (
        <div className="rounded-2xl border border-zinc-200 bg-white p-5 shadow-sm">
          <p className="text-sm font-bold text-zinc-900">Tambah anggota</p>
          <p className="mt-0.5 text-xs text-zinc-500">
            Masukkan emailnya. Dia langsung jadi anggota begitu login pakai email tersebut.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && email) void invite(); }}
              placeholder="rekan@perusahaan.com"
              className="min-w-64 flex-1 rounded-xl border border-zinc-300 px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-zinc-400 focus:border-amber-400"
            />
            <button
              onClick={invite}
              disabled={!email || busy === "invite"}
              className="inline-flex items-center gap-2 rounded-xl bg-amber-500 px-5 py-2.5 text-sm font-bold text-zinc-950 transition-colors hover:bg-amber-400 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy === "invite" ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}
              Tambah
            </button>
          </div>
        </div>
      )}

      {!data ? (
        <div className="h-32 animate-pulse rounded-2xl bg-zinc-100" />
      ) : (
        <ul className="overflow-hidden rounded-2xl border border-zinc-200 bg-white shadow-sm">
          {data.members.map((m, i) => (
            <li key={m.user_id} className={`flex items-center gap-4 px-5 py-4 ${i > 0 ? "border-t border-zinc-100" : ""}`}>
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-zinc-100 font-display text-sm font-bold text-zinc-600">
                {(m.name ?? m.contact).slice(0, 1).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-semibold text-zinc-900">{m.name ?? m.contact}</span>
                {m.name && <span className="block truncate text-xs text-zinc-500">{m.contact}</span>}
              </span>
              {m.role === "owner" ? (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2.5 py-1 text-[10px] font-bold text-amber-700">
                  <Shield size={10} /> Pemilik
                </span>
              ) : (
                <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-[10px] font-semibold text-zinc-500">Anggota</span>
              )}
              {data.can_manage && m.role !== "owner" && m.user_id !== data.me && (
                <button
                  onClick={() => remove(m.user_id)}
                  disabled={busy === m.user_id}
                  className="rounded-lg p-2 text-zinc-400 transition-colors hover:bg-red-50 hover:text-red-600 disabled:opacity-40"
                  title="Keluarkan dari organisasi"
                >
                  {busy === m.user_id ? <Loader2 size={15} className="animate-spin" /> : <Trash2 size={15} />}
                </button>
              )}
            </li>
          ))}
        </ul>
      )}

      <div className="flex items-start gap-3 rounded-2xl border border-zinc-200 bg-zinc-50 p-5">
        <Users size={18} className="mt-0.5 shrink-0 text-zinc-400" />
        <p className="text-xs leading-5 text-zinc-600">
          Semua anggota punya akses yang sama: bisa membuat video, meninjau scene, dan memakai saldo organisasi.
          Belum ada pembatasan per-fitur. Yang khusus milik pemilik hanya menambah dan mengeluarkan anggota.
        </p>
      </div>
    </div>
  );
}
