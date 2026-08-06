"use client";

// Telemetry funnel fire-and-forget — tidak pernah melempar, tidak pernah
// menunggu, tidak memblokir navigasi (sendBeacon). Nama event harus ada di
// whitelist app/api/events/route.ts.
export function track(name: string, meta?: Record<string, unknown>): void {
  try {
    const payload = JSON.stringify({ name, meta });
    if (navigator.sendBeacon) {
      navigator.sendBeacon("/api/events", new Blob([payload], { type: "application/json" }));
    } else {
      void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: payload, keepalive: true });
    }
  } catch {
    /* telemetry tidak boleh mengganggu apa pun */
  }
}
