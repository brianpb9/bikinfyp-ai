"use client";

import { Suspense, useEffect, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiFail } from "../../_components/api";
import { FlowHeader, PrimaryButton, ErrorText, SecondaryButton } from "../../_components/ui";
import { HOOK_FAMILY_NAMES, TIER_LABELS, loadFlow, saveFlow, type FlowScript, type FlowSegment } from "../../_components/flow";
import { validateScript, type RuleIssue } from "../../../lib/script-engine/validator";

const ROLE_LABEL: Record<string, string> = {
  hook: "HOOK (0–3 dtk)",
  demo: "DEMO (4–10 dtk)",
  cta: "CTA (11–15 dtk)",
};

// S4 — SKRIP + EDITOR (Langkah 3/5) ★ GERBANG HITL
function SkripInner() {
  const router = useRouter();
  const params = useSearchParams();
  const dupScriptId = params.get("script");

  const [scripts, setScripts] = useState<FlowScript[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [segments, setSegments] = useState<FlowSegment[]>([]);
  const [issues, setIssues] = useState<RuleIssue[]>([]);
  const [editorSeen, setEditorSeen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const submitLock = useRef(false);

  // Muat varian: dari flow (hasil generate) atau dari ?script= (duplikat)
  useEffect(() => {
    if (dupScriptId) {
      apiFetch<{ script: FlowScript & { product_name: string; price_idr: number } }>(`/api/scripts/${dupScriptId}`)
        .then((d) => setScripts([d.script]))
        .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat skrip."));
      return;
    }
    const f = loadFlow();
    if (!f.scripts || f.scripts.length === 0) {
      router.replace("/bikin/gaya");
      return;
    }
    setScripts(f.scripts);
  }, [dupScriptId, router]);

  // Editor "terlihat" = user menggulir ke editor ATAU menyentuh textarea
  useEffect(() => {
    if (!editorRef.current) return;
    const obs = new IntersectionObserver(
      (entries) => entries[0]?.isIntersecting && setEditorSeen(true),
      { threshold: 0.25 }
    );
    obs.observe(editorRef.current);
    return () => obs.disconnect();
  }, [selectedId]);

  function selectVariant(s: FlowScript) {
    setSelectedId(s.id);
    setSegments(s.segments.map((seg) => ({ ...seg })));
    setIssues([]);
    saveFlow({ selectedScriptId: s.id });
  }

  // Validasi ringan realtime per edit (L-10/L-11 keras, sisanya warning)
  function editSegment(i: number, text: string) {
    const next = segments.map((s, j) => (j === i ? { ...s, text } : s));
    setSegments(next);
    setEditorSeen(true);
    const script = scripts.find((s) => s.id === selectedId);
    const product = loadFlow().product;
    if (!script || submitLock.current) return;
    submitLock.current = true;
    const res = validateScript(
      {
        hook_family: script.hook_family,
        register: script.register,
        segments: next,
        productName: product?.name ?? "produk",
        priceIdr: product?.priceIdr ?? 1,
      },
      "light"
    );
    setIssues([...res.errors, ...res.warnings]);
  }

  const hardErrors = issues.filter((i) => i.rule === "L-10" || i.rule === "L-11");
  const canApprove = selectedId !== null && editorSeen && hardErrors.length === 0 && !loading;
  const approveHint = loading
    ? "Skrip sedang dikirim ke dapur."
    : !selectedId
      ? "Pilih satu versi skrip terlebih dahulu."
      : !editorSeen
        ? "Buka dan tinjau bagian skrip sebelum melanjutkan."
        : hardErrors.length > 0
          ? "Perbaiki bagian yang ditandai merah sebelum melanjutkan."
          : "Skrip siap disetujui dan dibuatkan videonya.";

  async function approve() {
    const script = scripts.find((s) => s.id === selectedId);
    if (!script) return;
    setLoading(true);
    setError(null);
    setNoCredits(false);
    try {
      const edited = segments.some((s, i) => s.text !== script.segments[i]?.text);
      await apiFetch(`/api/scripts/${script.id}/approve`, { json: { segments, edited } });
      const job = await apiFetch<{ job_id: string }>("/api/jobs", {
        json: {
          script_id: script.id,
          format: loadFlow().format ?? "hands_only",
          duration_s: 15,
          quality_tier: loadFlow().qualityTier ?? "silent_caption",
          creator_category: loadFlow().creatorCategory ?? "hijaber",
        },
      });
      saveFlow({ jobId: job.job_id });
      router.push(`/bikin/proses?job=${job.job_id}`);
    } catch (err) {
      if (err instanceof ApiFail && err.code === "INSUFFICIENT_CREDITS") {
        setNoCredits(true);
        // Simpan titik kembali — draft skrip AMAN di sessionStorage (racun.flow)
        saveFlow({ returnTo: `/bikin/skrip${dupScriptId ? `?script=${dupScriptId}` : ""}` });
      }
      setError(err instanceof Error ? err.message : "Gagal melanjutkan. Coba lagi ya.");
      setLoading(false);
      submitLock.current = false;
    }
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white pb-10">
      <FlowHeader title="Skrip" step={3} />
      <div className="space-y-6 px-4">
        <p className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-semibold text-amber-800 shadow-sm">
          Tier: {TIER_LABELS[loadFlow().qualityTier ?? "silent_caption"]}
        </p>
        <section className="space-y-2">
          <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Pilih yang paling cocok</p><h2 className="font-display text-xl font-bold">Versi skrip</h2></div>
          {scripts.map((s, i) => (
            <button
              key={s.id}
              type="button"
              onClick={() => selectVariant(s)}
              className={`w-full rounded-2xl border-2 p-4 text-left ${
                selectedId === s.id ? "border-amber-500 bg-amber-50 shadow-sm" : "border-zinc-200 bg-white shadow-sm"
              }`}
            >
              <p className="text-sm font-bold text-amber-700">
                Versi {i + 1} · {HOOK_FAMILY_NAMES[s.hook_family] ?? s.hook_family}
              </p>
              <p className="mt-1 text-zinc-700">&ldquo;{s.segments[0]?.text}&rdquo;</p>
            </button>
          ))}
        </section>

        {selectedId && (
          <section ref={editorRef} className="space-y-3">
            <div><p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Tinjau sebelum lanjut</p><h2 className="font-display text-xl font-bold">Edit per bagian</h2></div>
            {segments.map((seg, i) => {
              const segIssues = issues.filter((is) => is.segment === seg.role);
              const globalHard = issues.filter((is) => !is.segment && (is.rule === "L-10" || is.rule === "L-11"));
              const segErr = i === 0 ? [...segIssues, ...globalHard] : segIssues;
              return (
                <div key={seg.role}>
                  <p className="mb-1 text-sm font-bold text-zinc-600">{ROLE_LABEL[seg.role]}</p>
                  <textarea
                    value={seg.text}
                    onChange={(e) => editSegment(i, e.target.value)}
                    rows={3}
                    className={`w-full rounded-2xl border-2 bg-white p-3 text-base leading-6 shadow-sm outline-none transition-colors ${
                      segErr.length > 0 ? "border-red-400 bg-red-50" : "border-zinc-200 focus:border-amber-500"
                    }`}
                  />
                  {segErr.map((is, j) => (
                    <p key={j} className="mt-1 text-sm text-red-600">⚠ {is.message_id}</p>
                  ))}
                </div>
              );
            })}
            {issues.filter((is) => !is.segment && is.rule !== "L-10" && is.rule !== "L-11").map((is, j) => (
              <p key={j} className="text-sm text-amber-700">💡 {is.message_id}</p>
            ))}
          </section>
        )}

        <p className="rounded-2xl border border-zinc-100 bg-white p-4 text-sm leading-6 text-zinc-600 shadow-sm">
          ⚠ Cek dulu ya, kamu yang nentuin isi videonya. TikTok juga minta video AI dicek manusia dulu
          sebelum diposting.
        </p>

        <ErrorText message={error} />
        {noCredits && (
          <SecondaryButton href={`/kredit?return_to=${encodeURIComponent(`/bikin/skrip${dupScriptId ? `?script=${dupScriptId}` : ""}`)}`}>
            Top-up dulu di sini →
          </SecondaryButton>
        )}
        <PrimaryButton onClick={approve} disabled={!canApprove}>
          {loading ? "Mengirim ke dapur..." : "Setuju & Lanjut"}
        </PrimaryButton>
        <p
          aria-live="polite"
          className={`rounded-2xl px-4 py-3 text-center text-sm ${canApprove ? "bg-emerald-50 text-emerald-800" : "bg-zinc-100 text-zinc-600"}`}
        >
          {canApprove ? "✓ " : ""}{approveHint}
        </p>
      </div>
    </main>
  );
}

export default function SkripPage() {
  return (
    <Suspense>
      <SkripInner />
    </Suspense>
  );
}
