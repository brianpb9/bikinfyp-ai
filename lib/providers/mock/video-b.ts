// Provider video mock B — zoom-out halus (treatment beda dari A agar failover terlihat di log).

import path from "node:path";
import { renderZoompanShot } from "./shared";
import type { VideoProvider, VideoAsset, VisualSpec } from "../types";

export const mockVideoB: VideoProvider = {
  name: "mock-video-b",

  estimateCost(spec: VisualSpec): number {
    return spec.shots.length * 1250;
  },

  async healthCheck(): Promise<boolean> {
    return true;
  },

  async generate(spec: VisualSpec, outDir: string): Promise<VideoAsset[]> {
    console.log(`[provider] mock-video-b: render ${spec.shots.length} shot (zoom-out) untuk job ${spec.jobId}`);
    const assets: VideoAsset[] = [];
    for (const shot of spec.shots) {
      assets.push(
        await renderZoompanShot({
          shot,
          outPath: path.join(outDir, `shot${shot.index}.mp4`),
          width: spec.width,
          height: spec.height,
          direction: "out",
          costIdr: 1250,
        })
      );
    }
    return assets;
  },
};
