/**
 * Generate GAMBAR lewat kie.ai (seedream/5-pro-image-to-image).
 *
 * ---------------------------------------------------------------------------
 * KENAPA JALUR KEDUA, BUKAN MENGGANTI YANG ADA
 * ---------------------------------------------------------------------------
 * Gambar storyboard hari ini dibuat lewat BytePlus Ark langsung
 * (lib/media/seedream.ts), dan jalur itu SUDAH TERBUKTI: ia yang menghasilkan
 * kartu-kartu yang dipakai sebagai frame pertama render.
 *
 * Model kie.ai ditambahkan sebagai OPSI, bukan pengganti. Menukar jalur yang
 * bekerja dengan yang belum pernah dipakai — pada langkah yang setiap
 * kegagalannya terlihat langsung oleh pengguna — adalah risiko yang tidak
 * sepadan sebelum ada satu render nyata yang membuktikannya.
 *
 * ---------------------------------------------------------------------------
 * PERBEDAAN YANG MENENTUKAN: URL, BUKAN BASE64
 * ---------------------------------------------------------------------------
 * BytePlus menerima data URI; kie.ai menuntut URL yang BISA IA AMBIL SENDIRI.
 * Jadi foto acuan harus diterbitkan lebih dulu lewat terbitkanGambarProvider(),
 * mekanisme yang sama yang dipakai jalur video kie.ai.
 */
import { config } from "./config";
import { badanKieGambar } from "./kie-payload";
import { catatProvider } from "./provider-log";

export class KieGambarError extends Error {}

export interface HasilGambarKie {
  bytes: Buffer;
  contentType: string;
}

/** Jeda polling. Sama dengan jalur video kie.ai — API-nya satu, ritmenya satu. */
const JEDA_MS = 3_000;

async function ambilJson(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  const res = await fetch(url, {
    ...init,
    headers: {
      authorization: `Bearer ${config.kieApiKey}`,
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
    signal: AbortSignal.timeout(30_000),
  });
  const teks = await res.text();
  if (!res.ok) throw new KieGambarError(`[kie-gambar] HTTP ${res.status}: ${teks.slice(0, 300)}`);
  try {
    return JSON.parse(teks) as Record<string, unknown>;
  } catch {
    throw new KieGambarError(`[kie-gambar] jawaban bukan JSON: ${teks.slice(0, 200)}`);
  }
}

function taskIdDari(data: Record<string, unknown>): string {
  const id =
    (data.taskId as string) ??
    ((data.data as Record<string, unknown> | undefined)?.taskId as string);
  if (!id) throw new KieGambarError(`[kie-gambar] jawaban createTask tanpa taskId: ${JSON.stringify(data).slice(0, 300)}`);
  return id;
}

/**
 * Buat satu gambar. Melempar KieGambarError bila gagal — pemanggil yang
 * memutuskan artinya (scene gagal, atau storyboard gagal seluruhnya).
 */
export async function generateGambarKie(input: {
  prompt: string;
  /** URL acuan yang SUDAH publik. kie.ai mengambilnya sendiri. */
  imageUrls: string[];
  aspectRatio?: string;
  quality?: string;
  model?: string;
  jobId?: string | null;
  shotIndex?: number | null;
  batasMs?: number;
}): Promise<HasilGambarKie> {
  if (!config.kieApiKey) throw new KieGambarError("KIE_API_KEY belum diisi.");
  const model = input.model ?? "seedream/5-pro-image-to-image";
  const mulai = Date.now();
  const batas = input.batasMs ?? 5 * 60_000;

  const badan = {
    model,
    input: badanKieGambar(model, {
      prompt: input.prompt,
      imageUrls: input.imageUrls,
      aspectRatio: input.aspectRatio ?? "9:16",
      quality: input.quality,
    }),
  };

  let taskId: string;
  try {
    taskId = taskIdDari(await ambilJson(`${config.kieBaseUrl}${config.kiePathCreate}`, {
      method: "POST",
      body: JSON.stringify(badan),
    }));
  } catch (err) {
    void catatProvider({
      jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
      provider: "kie-gambar", model, fase: "gagal",
      error: err instanceof Error ? err.message : String(err),
      durasiMs: Date.now() - mulai,
    });
    throw err;
  }

  void catatProvider({
    jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
    provider: "kie-gambar", model, taskId, fase: "submit",
    requestRingkas: `acuan=${input.imageUrls.length} rasio=${input.aspectRatio ?? "9:16"}`,
  });

  // Polling sampai ada resultUrls atau batas waktu habis.
  for (;;) {
    if (Date.now() - mulai > batas) {
      const pesan = `[kie-gambar] task ${taskId} melewati batas ${Math.round(batas / 1000)} detik`;
      void catatProvider({
        jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
        provider: "kie-gambar", model, taskId, fase: "gagal",
        error: pesan, durasiMs: Date.now() - mulai,
      });
      throw new KieGambarError(pesan);
    }
    await new Promise((r) => setTimeout(r, JEDA_MS));

    const isi = await ambilJson(
      `${config.kieBaseUrl}${config.kiePathRecord}?taskId=${encodeURIComponent(taskId)}`,
    );
    const data = (isi.data as Record<string, unknown> | undefined) ?? isi;
    const { ambilResultUrls } = await import("./providers/stubs/kie-grok");
    const urls = ambilResultUrls(data);

    if (urls?.length) {
      // URL kie.ai BERUMUR PENDEK. Gambarnya ditarik sekarang juga; menyimpan
      // alamatnya saja berarti kartu storyboard jadi kotak rusak beberapa jam
      // kemudian — pelajaran yang sama dari jalur Seedream BytePlus.
      const unduh = await fetch(urls[0]!, { signal: AbortSignal.timeout(60_000) });
      if (!unduh.ok) throw new KieGambarError(`[kie-gambar] unduh hasil HTTP ${unduh.status}`);
      const bytes = Buffer.from(await unduh.arrayBuffer());
      if (bytes.length < 1024) throw new KieGambarError("[kie-gambar] hasil terlalu kecil — kemungkinan bukan gambar.");

      void catatProvider({
        jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
        provider: "kie-gambar", model, taskId, fase: "selesai",
        durasiMs: Date.now() - mulai,
        response: { bytes: bytes.length, kredit: Number(data.creditsConsumed ?? 0) },
      });
      return { bytes, contentType: unduh.headers.get("content-type") ?? "image/png" };
    }

    const gagal = String(data.state ?? data.status ?? "").toLowerCase();
    if (gagal === "fail" || gagal === "failed" || gagal === "error") {
      const pesan = `[kie-gambar] task ${taskId} gagal: ${JSON.stringify(data).slice(0, 300)}`;
      void catatProvider({
        jobId: input.jobId ?? null, shotIndex: input.shotIndex ?? null,
        provider: "kie-gambar", model, taskId, fase: "gagal",
        error: pesan, durasiMs: Date.now() - mulai,
      });
      throw new KieGambarError(pesan);
    }
  }
}
