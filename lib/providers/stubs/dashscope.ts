// STUB — Alibaba DashScope (Wan image-to-video). Struktur lengkap; integrasi nyata untuk produksi.
// Membaca DASHSCOPE_API_KEY dari env; throw ProviderNotConfigured bila kosong.

import { config } from "../../config";
import { ProviderNotConfigured, type VideoProvider, type VideoAsset, type VisualSpec } from "../types";

export const dashscopeVideo: VideoProvider = {
  name: "alibaba-dashscope-wan",

  estimateCost(spec: VisualSpec): number {
    return spec.shots.length * 1300;
  },

  async healthCheck(): Promise<boolean> {
    return config.dashscopeApiKey !== "";
  },

  async generate(spec: VisualSpec): Promise<VideoAsset[]> {
    if (!config.dashscopeApiKey) throw new ProviderNotConfigured("alibaba-dashscope-wan", "DASHSCOPE_API_KEY");
    // TODO produksi: POST /api/v1/services/aigc/video-generation/video-synthesis
    // (model wan2.2-i2v-fast, img_url = foto produk asli, prompt + negative prompt dari spec).
    throw new Error("alibaba-dashscope-wan: integrasi API belum diaktifkan di MVP");
  },
};
