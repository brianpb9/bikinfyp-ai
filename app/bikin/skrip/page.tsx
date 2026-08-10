"use client";

import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { apiFetch, ApiFail } from "../../_components/api";
import { FlowHeader, PrimaryButton, ErrorText, SecondaryButton } from "../../_components/ui";
import { HOOK_FAMILY_NAMES, TIER_LABELS, loadFlow, saveFlow, type FlowScript, type FlowSegment } from "../../_components/flow";
import { validateScript, type RuleIssue } from "../../../lib/script-engine/validator";
import { scoreScriptPlan, type ScriptPlanScore, type FypQualityTier, type FypVideoFormat } from "../../../lib/fyp-score";
import { track } from "../../_components/track";
import type { HookCode } from "../../../lib/config/hooks";
import type { SegmentDraft } from "../../../lib/script-engine/templates";

const ROLE_LABEL: Record<string, string> = {
  hook: "HOOK (0–3 dtk)",
  demo: "DEMO (4–10 dtk)",
  cta: "CTA (11–15 dtk)",
};

/** Skor FYP pre-render (MODEL FYP) untuk satu varian — dihitung client-side
 * dari rencana video, sama seperti validateScript. Bahasa WAJIB korelasional
 * (pola yang cenderung menang di data pembanding), bukan janji FYP. */
function scorePlan(
  segments: FlowSegment[],
  hookFamily: string,
  productInfo: { name: string; priceIdr: number } | null
): ScriptPlanScore | null {
  if (!productInfo) return null;
  const f = loadFlow();
  try {
    return scoreScriptPlan({
      hookFamily: hookFamily as HookCode,
      segments: segments.map((s) => ({ ...s, visual_direction: s.visual_direction ?? "" })) as SegmentDraft[],
      qualityTier: (f.qualityTier ?? "high_quality") as FypQualityTier,
      durationSec: f.durationSec ?? 15,
      format: (f.format ?? "talking_head") as FypVideoFormat,
      productName: productInfo.name,
      priceIdr: productInfo.priceIdr,
    });
  } catch {
    return null; // keluarga hook tak dikenal dsb. — sembunyikan skor, jangan rusak layar
  }
}

function ScoreBadge({ score }: { score: number }) {
  return (
    <span className="ml-2 inline-block rounded-full bg-amber-500/10 px-2 py-0.5 text-xs font-bold text-amber-700">
      Skor FYP {score}
    </span>
  );
}

// S4 — SKRIP + EDITOR (Langkah 3/5) ★ GERBANG HITL
function SkripInner() {
  const router = useRouter();
  const params = useSearchParams();
  const dupScriptId = params.get("script");

  const [scripts, setScripts] = useState<FlowScript[]>([]);
  const [productInfo, setProductInfo] = useState<{ name: string; priceIdr: number } | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [segments, setSegments] = useState<FlowSegment[]>([]);
  const [issues, setIssues] = useState<RuleIssue[]>([]);
  const [editorSeen, setEditorSeen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [noCredits, setNoCredits] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);

  // Muat varian: dari flow (hasil generate) atau dari ?script= (duplikat)
  useEffect(() => {
    if (dupScriptId) {
      apiFetch<{ script: FlowScript & { product_name: string; price_idr: number } }>(`/api/scripts/${dupScriptId}`)
        .then((d) => {
          setScripts([d.script]);
          setProductInfo({ name: d.script.product_name, priceIdr: d.script.price_idr });
        })
        .catch((e) => setError(e instanceof Error ? e.message : "Gagal memuat skrip."));
      return;
    }
    const f = loadFlow();
    if (!f.scripts || f.scripts.length === 0) {
      router.replace("/bikin/gaya");
      return;
    }
    setScripts(f.scripts);
    if (f.product) setProductInfo({ name: f.product.name, priceIdr: f.product.priceIdr });
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

  // Skor FYP per varian + skor live untuk varian terpilih (ikut hasil edit).
  const variantScores = useMemo(
    () => new Map(scripts.map((s) => [s.id, scorePlan(s.segments, s.hook_family, productInfo)])),
    [scripts, productInfo]
  );
  const liveScore = useMemo(() => {
    const s = scripts.find((x) => x.id === selectedId);
    return s && segments.length > 0 ? scorePlan(segments, s.hook_family, productInfo) : null;
  }, [segments, selectedId, scripts, productInfo]);

  // Validasi ringan realtime per edit (L-10/L-11 keras, sisanya warning).
  // Catatan fix 2026-08-06: dulu fungsi ini memakai submitLock sebagai guard dan
  // men-set-nya true tanpa pernah reset — validasi realtime cuma jalan di edit
  // PERTAMA, edit berikutnya tidak tervalidasi sampai approve gagal. Lock dihapus
  // dari jalur edit (validateScript sinkron, tidak butuh lock).
  function editSegment(i: number, text: string) {
    const next = segments.map((s, j) => (j === i ? { ...s, text } : s));
    setSegments(next);
    setEditorSeen(true);
    const script = scripts.find((s) => s.id === selectedId);
    const product = loadFlow().product;
    if (!script) return;
    const res = validateScript(
      {
        hook_family: script.hook_family,
        register: script.register,
        segments: next,
        productName: product?.name ?? "produk",
        priceIdr: product?.priceIdr ?? 1,
        promoPriceBeforeIdr: product?.promoPriceBeforeIdr ?? null,
      },
      "light"
    );
    setIssues([...res.errors, ...res.warnings]);
  }

  const hardErrors = issues.filter((i) => i.rule === "L-10" || i.rule === "L-11");
  const canApprove = selectedId !== null && editorSeen && hardErrors.length === 0 && !loading;
  const approveHint = loading
    ? "Skrip sedang dikirim ke studio AI."
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
    track("approve_click", { hook_family: script.hook_family });
    setLoading(true);
    setError(null);
    setNoCredits(false);
    try {
      const edited = segments.some((s, i) => s.text !== script.segments[i]?.text);
      await apiFetch(`/api/scripts/${script.id}/approve`, { json: { segments, edited } });
      const job = await apiFetch<{ job_id: string }>("/api/jobs", {
        json: {
          script_id: script.id,
          format: loadFlow().format ?? "talking_head",
          duration_s: loadFlow().durationSec ?? 15,
          quality_tier: loadFlow().qualityTier ?? "high_quality",
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
    }
  }

  return (
    <main className="min-h-dvh bg-gradient-to-b from-amber-50/70 via-white to-white pb-10">
      <FlowHeader title="Skrip" step={3} />
      <div className="space-y-6 px-4">
        <p className="rounded-2xl border border-amber-100 bg-amber-50 p-3 text-sm font-semibold text-amber-800 shadow-sm">
          Tier: {TIER_LABELS[loadFlow().qualityTier ?? "silent_caption"]} · {loadFlow().durationSec ?? 15} dtk
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
                {(() => {
                  const sc = variantScores.get(s.id);
                  return sc ? <ScoreBadge score={sc.score} /> : null;
                })()}
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

        {selectedId && liveScore && (
          <section className="rounded-2xl border border-amber-100 bg-white p-4 shadow-sm">
            <div className="flex items-baseline justify-between">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-amber-700">Skor FYP</p>
              <p className="font-display text-2xl font-bold text-amber-700">{liveScore.score}<span className="text-sm font-semibold text-zinc-400">/100</span></p>
            </div>
            <p className="mt-1 text-sm leading-6 text-zinc-600">
              Pola video seperti ini <b>cenderung menang</b> di data video jualan yang kami pelajari.
              Ini korelasi dari data, bukan jaminan masuk FYP.
            </p>
            {liveScore.topFixes.length > 0 && (
              <ul className="mt-2 space-y-1">
                {liveScore.topFixes.map((f) => (
                  <li key={f.feature} className="text-sm leading-6 text-zinc-700">💡 {f.fix}</li>
                ))}
              </ul>
            )}
            <p className="mt-2 text-right text-[10px] text-zinc-400">model {liveScore.modelVersion}</p>
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
          {loading ? "Mengirim ke studio AI..." : "Setuju & Lanjut"}
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
