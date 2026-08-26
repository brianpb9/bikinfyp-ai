import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { AI_RENDER_BLOCKED_TEMPLATE_IDS } from "../lib/template-render-safety";
import {
  ONBOARDING_AI_SHOWCASE_CLIPS,
  PROVENANCE_OWNED,
  isOnboardingShowcaseClipApproved,
  type OnboardingShowcaseClip,
} from "../lib/onboarding-showcase";

test("showcase onboarding hanya memakai render owned yang provenance-approved", () => {
  assert.ok(ONBOARDING_AI_SHOWCASE_CLIPS.length > 0);
  for (const clip of ONBOARDING_AI_SHOWCASE_CLIPS) {
    assert.ok(PROVENANCE_OWNED.has(clip.provenance), `${clip.src}: provenance ${clip.provenance} bukan milik kami`);
    assert.match(clip.src, /^\/showcase\//);
    assert.doesNotMatch(clip.src, /^\/previews\//);
    assert.ok(existsSync(`public${clip.src}`), `${clip.src} tidak ada`);
  }
  // owned_model_render SAH — kami yang menghasilkan, hanya bukan lewat
  // pipeline produksi. Yang tidak pernah sah adalah footage pihak lain.
  assert.equal(isOnboardingShowcaseClipApproved({
    src: "/showcase/persona/ootd.mp4",
    label: "OOTD",
    templateId: null,
    provenance: "owned_model_render",
  }), true);
  assert.equal(isOnboardingShowcaseClipApproved({
    src: "/showcase/persona/apa-pun.mp4",
    label: "Pihak lain menyamar",
    templateId: null,
    provenance: "third_party_portfolio",
  }), false, "footage pihak lain lolos hanya karena berada di /showcase/");
  assert.equal(isOnboardingShowcaseClipApproved({
    src: "/previews/t01-tempat-susah.mp4",
    label: "Portfolio pihak lain",
    templateId: "t01-tempat-susah",
    provenance: "third_party_portfolio",
  }), false, "footage portfolio /previews tidak boleh lolos ke halaman komersial");
});

test("shared real-footage blocklist tidak pernah tampil di bawah klaim AI", () => {
  const selectedTemplateIds = ONBOARDING_AI_SHOWCASE_CLIPS
    .map((clip) => clip.templateId)
    .filter((id): id is string => id !== null);
  for (const blockedId of AI_RENDER_BLOCKED_TEMPLATE_IDS) {
    assert.ok(!selectedTemplateIds.includes(blockedId), `${blockedId} lolos ke showcase AI`);
    const fixture: OnboardingShowcaseClip = {
      src: `/showcase/${blockedId}.mp4`,
      label: blockedId,
      templateId: blockedId,
      provenance: "owned_pipeline_render",
    };
    assert.equal(isOnboardingShowcaseClipApproved(fixture), false, `${blockedId} tidak difilter shared blocklist`);
  }
});

test("halaman onboarding tidak mengambil katalog /previews dan disclosure tetap jelas", () => {
  const source = readFileSync(new URL("../app/onboarding/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CAMPAIGN_TEMPLATES|KLIP_TEMPLATE|src:\s*["']\/previews\//);
  assert.match(source, /ONBOARDING_AI_SHOWCASE_CLIPS\.map/);
  assert.match(source, /mt-3 text-center text-sm leading-relaxed text-zinc-700/);
  assert.match(source, /bukan mitra resmi dan tidak mengendorse layanan ini/);
  assert.doesNotMatch(source, /shellasaukia-dress-novella|Produk asli, label terbaca/);

  const linear = (hex: string) => {
    const rgb = [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);
    return rgb.map((channel) => channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
      .reduce((sum, channel, index) => sum + channel * [0.2126, 0.7152, 0.0722][index], 0);
  };
  const text = linear("#3f3f46"); // Tailwind zinc-700
  for (const background of ["#ffffff", "#fffbeb"]) { // white dan amber-50
    const bg = linear(background);
    const contrast = (Math.max(text, bg) + 0.05) / (Math.min(text, bg) + 0.05);
    assert.ok(contrast >= 4.5, `disclosure gagal WCAG AA pada ${background}: ${contrast.toFixed(2)}:1`);
  }
});

test("SATU KARAKTER SATU KLIP — tidak ada label atau berkas yang terulang", () => {
  // Dinding bukti yang menampilkan orang yang sama dua kali membuktikan LEBIH
  // SEDIKIT, bukan lebih banyak. Dari tujuh klip Grok yang diberikan Brian,
  // dua dibuang karena mengulang karakter (baju denim yang sama, baju coral
  // yang sama).
  const label = ONBOARDING_AI_SHOWCASE_CLIPS.map((c) => c.label);
  const src = ONBOARDING_AI_SHOWCASE_CLIPS.map((c) => c.src);
  assert.equal(new Set(label).size, label.length, `label berulang: ${label.join(", ")}`);
  assert.equal(new Set(src).size, src.length, `berkas berulang: ${src.join(", ")}`);
});

test("klip persona memenuhi konvensi teknis showcase", async () => {
  // Sama seperti klip lama: 360x640, TANPA audio. Autoplay bersuara di
  // onboarding akan diblokir browser DAN mengagetkan orang.
  const { execFileSync } = await import("node:child_process");
  const persona = ONBOARDING_AI_SHOWCASE_CLIPS.filter((c) => c.src.startsWith("/showcase/persona/"));
  assert.ok(persona.length >= 5, "klip persona hilang dari allowlist");
  for (const clip of persona) {
    const out = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "v:0",
      "-show_entries", "stream=width,height", "-of", "csv=p=0", `public${clip.src}`,
    ]).toString().trim();
    assert.equal(out, "360,640", `${clip.src}: ukuran ${out}, bukan 360x640`);
    const audio = execFileSync("ffprobe", [
      "-v", "error", "-select_streams", "a",
      "-show_entries", "stream=index", "-of", "csv=p=0", `public${clip.src}`,
    ]).toString().trim();
    assert.equal(audio, "", `${clip.src} masih membawa audio`);
  }
});
