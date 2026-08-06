// Rencana fixture untuk golden test fyp-score — dipakai oleh tests/fyp-score.test.ts
// DAN generator golden Python (scratchpad) supaya keduanya menskor baris fitur yang
// persis sama. Deterministik penuh: segmen dirender langsung via renderSegmentsForTier
// (tanpa DB/deprioritisasi hook) dengan TemplateCtx tetap.

import { REGISTERS } from "../../lib/script-engine/registers";
import { renderSegmentsForTier, formatHargaNatural, type TemplateCtx } from "../../lib/script-engine/templates";
import type { ScriptPlanInput } from "../../lib/fyp-score";

function ctx(register: keyof typeof REGISTERS, priceIdr: number, produk: string): TemplateCtx {
  return {
    reg: REGISTERS[register],
    harga: formatHargaNatural(priceIdr),
    produk,
    noun: "skincare",
    pain: "kusamnya",
    proof: "teksturnya",
    space: "Meja skincare",
    aktivitas: "skincare-an malem",
    identitas: "tim glowing",
  };
}

export interface FixturePlan {
  name: string;
  input: ScriptPlanInput;
}

export function buildFixturePlans(): FixturePlan[] {
  const mk = (
    name: string,
    family: ScriptPlanInput["hookFamily"],
    register: keyof typeof REGISTERS,
    tier: ScriptPlanInput["qualityTier"],
    durationSec: number,
    format: ScriptPlanInput["format"],
    productName: string,
    priceIdr: number
  ): FixturePlan => ({
    name,
    input: {
      hookFamily: family,
      segments: renderSegmentsForTier(family, ctx(register, priceIdr, productName), tier, durationSec),
      qualityTier: tier,
      durationSec,
      format,
      productName,
      priceIdr,
    },
  });

  return [
    mk("silent-15s-hands-H2-question", "H2", "bestie", "silent_caption", 15, "hands_only", "Serum Glow", 85000),
    mk("voiced-hq-15s-face-H1-shock", "H1", "genz", "high_quality", 15, "talking_head", "TWS Pro X", 1500000),
    mk("silent-30s-hands-H16-storytime", "H16", "bunda", "silent_caption", 30, "hands_only", "Panci Multi", 45000),
    mk("voiced-shq-45s-broll-H11-beforeafter", "H11", "netral", "super_hq", 45, "vo_broll", "Rak Lipat", 250000),
  ];
}
