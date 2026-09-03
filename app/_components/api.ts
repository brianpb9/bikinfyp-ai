"use client";

// Helper fetch API: menampilkan pesan error API apa adanya (sudah Bahasa Indonesia).

/**
 * Pesan yang BOLEH dibaca pengguna.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA err.message TIDAK BOLEH LANGSUNG DITAMPILKAN
 * ────────────────────────────────────────────────────────────────────────────
 * ApiFail membawa kalimat yang memang ditulis untuk pengguna (message_id dari
 * server). Tapi blok catch yang sama juga menangkap galat LAIN — jaringan
 * putus ("Failed to fetch"), permintaan dibatalkan ("The operation was
 * aborted"), atau bug JavaScript. Menampilkan pesannya apa adanya berarti
 * memajang kalimat teknis berbahasa Inggris kepada penjual yang sedang
 * mencoba membuat video.
 *
 * Permintaan Brian 3 Sep 2026: pesan galat tidak boleh membocorkan detail
 * teknis — galat LLM, galat API pihak ketiga, dan sejenisnya. Ini pagarnya di
 * sisi klien; pagar di sisi server ada di lib/errors.ts dan
 * TemplateTidakDisajikan.
 */
export function pesanUntukPengguna(err: unknown, cadangan: string): string {
  // Hanya ApiFail yang kalimatnya memang disusun untuk dibaca pengguna.
  if (err instanceof ApiFail) return err.message;
  if (err instanceof DOMException && err.name === "AbortError") {
    return "Kelamaan menunggu jawaban. Coba lagi ya.";
  }
  if (err instanceof TypeError) {
    // Bentuk khas kegagalan jaringan di browser.
    return "Koneksinya terputus. Cek internetmu lalu coba lagi ya.";
  }
  return cadangan;
}

export class ApiFail extends Error {
  code: string;
  retryable: boolean;
  constructor(code: string, messageId: string, retryable: boolean) {
    super(messageId);
    this.code = code;
    this.retryable = retryable;
  }
}

export async function apiFetch<T = unknown>(
  url: string,
  opts?: { method?: string; json?: unknown; formData?: FormData; signal?: AbortSignal }
): Promise<T> {
  const res = await fetch(url, {
    method: opts?.method ?? (opts?.json || opts?.formData ? "POST" : "GET"),
    headers: opts?.json ? { "content-type": "application/json" } : undefined,
    body: opts?.formData ?? (opts?.json ? JSON.stringify(opts.json) : undefined),
    signal: opts?.signal,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiFail(
      data.code ?? "ERROR",
      data.message_id ?? "Ada gangguan. Coba lagi sebentar lagi ya.",
      data.retryable ?? false
    );
  }
  return data as T;
}
