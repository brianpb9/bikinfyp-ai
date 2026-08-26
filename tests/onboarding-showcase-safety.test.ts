import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { AI_RENDER_BLOCKED_TEMPLATE_IDS } from "../lib/template-render-safety";
import approvalLedger from "../lib/onboarding-showcase-approvals.json";
import {
  ONBOARDING_AI_SHOWCASE_CLIPS,
  ONBOARDING_BRAND_SHOWCASE_CLIPS,
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
    approvalId: "persona-ootd-2ecdc5a",
    provenance: "owned_model_render",
  }), true);
  assert.equal(isOnboardingShowcaseClipApproved({
    src: "/showcase/persona/apa-pun.mp4",
    label: "Pihak lain menyamar",
    templateId: null,
    approvalId: "persona-ootd-2ecdc5a",
    provenance: "third_party_portfolio",
  }), false, "footage pihak lain lolos hanya karena berada di /showcase/");
  assert.equal(isOnboardingShowcaseClipApproved({
    src: "/previews/t01-tempat-susah.mp4",
    label: "Portfolio pihak lain",
    templateId: "t01-tempat-susah",
    approvalId: "persona-ootd-2ecdc5a",
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
      approvalId: "tangan-a089584",
      provenance: "owned_pipeline_render",
    };
    assert.equal(isOnboardingShowcaseClipApproved(fixture), false, `${blockedId} tidak difilter shared blocklist`);
  }
});

test("halaman onboarding tidak mengambil katalog /previews dan disclosure tetap jelas", () => {
  const source = readFileSync(new URL("../app/onboarding/page.tsx", import.meta.url), "utf8");
  const dashboardSource = readFileSync(new URL("../app/dashboard/onboarding/page.tsx", import.meta.url), "utf8");
  assert.doesNotMatch(source, /CAMPAIGN_TEMPLATES|KLIP_TEMPLATE|src:\s*["']\/previews\//);
  assert.match(source, /ONBOARDING_AI_SHOWCASE_CLIPS\.map/);
  assert.match(source, /ONBOARDING_BRAND_SHOWCASE_CLIPS\.map/);
  assert.doesNotMatch(source, /const\s+KLIP_MEREK|src:\s*["']\/showcase\/brand\//,
    "strip merek bypass registry approval dengan path hard-coded");
  assert.match(source, /mt-3 text-center text-sm leading-relaxed text-zinc-700/);
  assert.match(source, /bukan mitra resmi dan tidak mengendorse layanan ini/);
  assert.doesNotMatch(source, /shellasaukia-dress-novella|Produk asli, label terbaca/);
  assert.match(dashboardSource, /ONBOARDING_AI_SHOWCASE_CLIPS/);
  assert.doesNotMatch(dashboardSource, /CAMPAIGN_TEMPLATES|buildBrandApproach|\/previews\/|\.preview\b/,
    "dashboard onboarding tidak boleh melewati approval registry lewat preview template");
  const approvedAiSrc = new Set(ONBOARDING_AI_SHOWCASE_CLIPS.map((clip) => clip.src));
  for (const src of dashboardSource.match(/\/showcase\/[a-z0-9/.-]+\.mp4/g) ?? []) {
    assert.ok(approvedAiSrc.has(src), `${src}: dashboard memilih klip di luar approval gate`);
  }
  assert.doesNotMatch(dashboardSource, /\/showcase\/(?:genz|hijaber|ibu)\.mp4/);

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
  // SEDIKIT, bukan lebih banyak. Duplikat karakter dibuang; satu klip lain
  // ditahan karena belum punya source-product identity record yang reviewable.
  const label = ONBOARDING_AI_SHOWCASE_CLIPS.map((c) => c.label);
  const src = ONBOARDING_AI_SHOWCASE_CLIPS.map((c) => c.src);
  assert.equal(new Set(label).size, label.length, `label berulang: ${label.join(", ")}`);
  assert.equal(new Set(src).size, src.length, `berkas berulang: ${src.join(", ")}`);
});

test("approval showcase terikat ke SHA asset, provenance commit, dan frame evidence", () => {
  const sha256 = (path: string) => createHash("sha256").update(readFileSync(path)).digest("hex");
  const displayedClips = [...ONBOARDING_AI_SHOWCASE_CLIPS, ...ONBOARDING_BRAND_SHOWCASE_CLIPS];
  assert.equal(approvalLedger.version, 1);
  assert.equal(approvalLedger.approvals.length, displayedClips.length);
  for (const clip of displayedClips) {
    const approval = approvalLedger.approvals.find((item) => item.id === clip.approvalId);
    assert.ok(approval, `${clip.src}: approval ledger hilang`);
    assert.equal(approval.src, clip.src);
    assert.equal(approval.provenance, clip.provenance);
    assert.equal(approval.qcResult, "pass");
    assert.equal(sha256(`public${clip.src}`), approval.assetSha256, `${clip.src}: bytes berubah tanpa review ulang`);
    assert.ok(existsSync(approval.evidencePath), `${clip.src}: frame evidence hilang`);
    assert.equal(sha256(approval.evidencePath), approval.evidenceSha256, `${clip.src}: frame evidence berubah`);
    assert.equal(execFileSync("git", ["log", "-1", "--format=%H", "--", `public${clip.src}`], { encoding: "utf8" }).trim(),
      approval.sourceCommit, `${clip.src}: source commit provenance tidak cocok`);
  }
  const selected = new Set(displayedClips.map((clip) => clip.src));
  for (const rejected of approvalLedger.rejected) {
    assert.ok(!selected.has(rejected.src), `${rejected.src}: artifact rejected kembali masuk public proof`);
  }
  assert.ok(approvalLedger.rejected.some((item) => item.src === "/showcase/hijaber.mp4" && /SKNTELLA/.test(item.reason)));
  assert.ok(approvalLedger.rejected.some((item) => item.src === "/showcase/genz.mp4" && /Rp65\.574/.test(item.reason)));
});

test("klip persona memenuhi konvensi teknis showcase", async () => {
  // Sama seperti klip lama: 360x640, TANPA audio. Autoplay bersuara di
  // onboarding akan diblokir browser DAN mengagetkan orang.
  const persona = ONBOARDING_AI_SHOWCASE_CLIPS.filter((c) => c.src.startsWith("/showcase/persona/"));
  assert.ok(persona.length >= 4, "klip persona hilang dari allowlist");
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
