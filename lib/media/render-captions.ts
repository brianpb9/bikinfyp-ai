// Wrapper TS untuk renderer caption PIL (lib/media/render_caption.py).

import fs from "node:fs";
import path from "node:path";
import { runFf } from "./ffmpeg";
import type { CaptionCard } from "./captions";

export interface RenderedCaption extends CaptionCard {
  pngPath: string;
}

/** Render badge CTA (pill) via renderer PIL yang sama. */
export async function renderCtaBadge(text: string, workDir: string): Promise<string> {
  const out = path.join(workDir, "cta_badge.png");
  const specPath = path.join(workDir, "cta-badge-spec.json");
  fs.writeFileSync(
    specPath,
    JSON.stringify([
      {
        type: "badge",
        out,
        text,
        size: 46,
        fill: [255, 255, 255],
        bg: [255, 122, 0, 235], // oranye keranjang kuning
        stroke_width: 0,
        radius: 44,
      },
    ])
  );
  const py = path.join(process.cwd(), "lib", "media", "render_caption.py");
  await runFf("python3", [py, specPath]);
  return out;
}

/** Render semua card caption jadi PNG transparan dalam satu proses Python. */
export async function renderCaptionPngs(cards: CaptionCard[], workDir: string): Promise<RenderedCaption[]> {
  if (cards.length === 0) return [];
  const specPath = path.join(workDir, "caption-spec.json");
  const items = cards.map((c) => ({
    out: path.join(workDir, `caption_${c.index}.png`),
    text: c.text,
    highlight_words: c.highlightWords,
    size: 58,
    max_width: 640,
  }));
  fs.writeFileSync(specPath, JSON.stringify(items, null, 2));
  const py = path.join(process.cwd(), "lib", "media", "render_caption.py");
  await runFf("python3", [py, specPath]);
  return cards.map((c) => ({
    ...c,
    pngPath: path.join(workDir, `caption_${c.index}.png`),
  }));
}
