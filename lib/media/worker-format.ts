/** Normalisasi format persisten untuk kedua worker.
 * `ads` adalah format produksi, bukan alias hands_only: framing, batas orang,
 * dan negative prompt-nya berbeda. */
export type WorkerFormat = "hands_only" | "talking_head" | "vo_broll" | "tvc" | "ads";

export function normalisasiFormatWorker(format: string): WorkerFormat {
  return format === "talking_head" || format === "vo_broll" || format === "tvc" || format === "ads"
    ? format
    : "hands_only";
}
