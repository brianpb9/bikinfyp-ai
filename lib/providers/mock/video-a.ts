// Provider video mock A — zoom-in halus. "Gagal" bila MOCK_A_FAIL=1 (untuk uji failover).

import path from "node:path";
import { config } from "../../config";
import { renderZoompanShot } from "./shared";
import type { VideoProvider, VideoAsset, VisualSpec } from "../types";

export const mockVideoA: VideoProvider = {
  name: "mock-video-a",

  estimateCost(spec: VisualSpec): number {
    return spec.shots.length * 1200; // Rp2.400 per 2 shot (setara 480p API langsung, BRD 5.3)
  },

  async healthCheck(): Promise<boolean> {
    return true; // mock lokal selalu up; kegagalan disimulasikan di generate()
  },

  async generate(spec: VisualSpec, outDir: string): Promise<VideoAsset[]> {
    if (config.mockAFail) {
      throw new Error("mock-video-a: kegagalan disimulasikan (MOCK_A_FAIL=1)");
    }
    console.log(`[provider] mock-video-a: render ${spec.shots.length} shot (zoom-in) untuk job ${spec.jobId}`);
    const assets: VideoAsset[] = [];
    for (const shot of spec.shots) {
      assets.push(
        await renderZoompanShot({
          shot,
          outPath: path.join(outDir, `shot${shot.index}.mp4`),
          width: spec.width,
          height: spec.height,
          direction: "in",
          costIdr: 1200,
        })
      );
    }
    return assets;
  },
};
