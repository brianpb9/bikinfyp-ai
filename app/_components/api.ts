"use client";

// Helper fetch API: menampilkan pesan error API apa adanya (sudah Bahasa Indonesia).

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
