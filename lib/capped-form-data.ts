import Busboy from "busboy";
import { once } from "node:events";
import { ERR } from "./errors";

export type MultipartPhoto = { mime: string; data: Buffer };

type Waiter = { resolve: () => void; reject: (error: Error) => void; signal?: AbortSignal; timer: ReturnType<typeof setTimeout>; onAbort?: () => void };
const semaphoreState = globalThis as unknown as { __photoUploadSemaphore?: { active: number; waiters: Waiter[] } };
function semaphore() {
  return semaphoreState.__photoUploadSemaphore ??= { active: 0, waiters: [] };
}

/** Bound peak decode/OCR memory per web process. The HTTP stream remains
 * backpressured while waiting; it is not read into application buffers. */
export async function acquirePhotoUploadSlot(maxConcurrent = 2, signal?: AbortSignal, waitMs = 30_000): Promise<() => void> {
  const state = semaphore();
  if (state.active < maxConcurrent) state.active += 1;
  else await new Promise<void>((resolve, reject) => {
    const waiter: Waiter = { resolve, reject, signal, timer: setTimeout(() => remove(new Error("Upload queue timeout.")), waitMs) };
    const remove = (error: Error) => {
      const index = state.waiters.indexOf(waiter);
      if (index >= 0) state.waiters.splice(index, 1);
      if (waiter.onAbort && signal) signal.removeEventListener("abort", waiter.onAbort);
      clearTimeout(waiter.timer);
      reject(error);
    };
    waiter.onAbort = () => remove(new Error("Upload request aborted."));
    if (signal?.aborted) return waiter.onAbort();
    if (signal) signal.addEventListener("abort", waiter.onAbort, { once: true });
    state.waiters.push(waiter);
  });
  let released = false;
  return () => {
    if (released) return;
    released = true;
    const waiter = state.waiters.shift();
    if (waiter) {
      clearTimeout(waiter.timer);
      if (waiter.onAbort && waiter.signal) waiter.signal.removeEventListener("abort", waiter.onAbort);
      // Transfer the existing permit; do not decrement then let a new request
      // barge ahead of the queued waiter.
      waiter.resolve();
    } else state.active -= 1;
  };
}

async function withDeadline<T>(promise: Promise<T>, signal?: AbortSignal, timeoutMs = 15_000): Promise<T> {
  if (signal?.aborted) throw new Error("Upload request aborted.");
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Upload stream idle timeout.")), timeoutMs);
    const abort = () => reject(new Error("Upload request aborted."));
    signal?.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", abort);
    });
  });
}

/** Streaming multipart reader for organization product photos. It never
 * materializes the full request and accepts exactly one bounded file, allowing
 * the client to queue a multi-file drop without multiplying server memory. */
export async function readSinglePhotoMultipart(
  req: Request,
  options: { maxRequestBytes: number; maxFileBytes: number; signal?: AbortSignal; idleTimeoutMs?: number; totalTimeoutMs?: number }
): Promise<MultipartPhoto> {
  if (options.signal?.aborted) throw ERR.BAD_REQUEST("Upload dibatalkan. Coba lagi ya.", "Upload request aborted.");
  const announced = Number(req.headers.get("content-length"));
  if (Number.isFinite(announced) && announced > options.maxRequestBytes) {
    throw ERR.PAYLOAD_TOO_LARGE("Fotonya terlalu besar. Maksimal 10 MB per foto.");
  }
  if (!req.body) throw ERR.BAD_REQUEST("Tidak ada foto yang dikirim.");

  let parser: ReturnType<typeof Busboy>;
  try {
    parser = Busboy({
      headers: Object.fromEntries(req.headers.entries()),
      // +1 lets an exact 10 MB file pass; Busboy emits `limit` when the
      // boundary is reached. The explicit length check below enforces >10 MB.
      limits: { files: 1, fileSize: options.maxFileBytes + 1, fields: 0, parts: 2 },
    });
  } catch {
    throw ERR.BAD_REQUEST("Format unggahannya tidak valid. Pilih fotonya lagi.", "Invalid multipart request.");
  }

  let sawPhoto = false;
  let photoMime = "";
  const photoChunks: Buffer[] = [];
  let tooMany = false;
  let tooLarge = false;
  let parserError = "";
  parser.on("file", (field, stream, info) => {
    if (field !== "photos" || sawPhoto) { tooMany = true; stream.resume(); return; }
    sawPhoto = true;
    photoMime = info.mimeType;
    stream.on("limit", () => { tooLarge = true; });
    stream.on("data", (chunk: Buffer) => photoChunks.push(Buffer.from(chunk)));
  });
  parser.on("filesLimit", () => { tooMany = true; });
  parser.on("partsLimit", () => { tooMany = true; });
  parser.on("error", (error: unknown) => { parserError = error instanceof Error ? error.message : "multipart parser error"; });

  let total = 0;
  const startedAt = Date.now();
  const totalTimeoutMs = options.totalTimeoutMs ?? 30_000;
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;
  try {
    reader = req.body.getReader();
    for (;;) {
      const remaining = totalTimeoutMs - (Date.now() - startedAt);
      if (remaining <= 0) throw new Error("Upload total timeout.");
      const waitMs = Math.min(options.idleTimeoutMs ?? 15_000, remaining);
      const { done, value } = await withDeadline(reader.read(), options.signal, waitMs);
      if (done) break;
      total += value.byteLength;
      if (total > options.maxRequestBytes) {
        parser.destroy();
        throw ERR.PAYLOAD_TOO_LARGE("Fotonya terlalu besar. Maksimal 10 MB per foto.");
      }
      if (!parser.write(Buffer.from(value))) {
        const drainRemaining = totalTimeoutMs - (Date.now() - startedAt);
        if (drainRemaining <= 0) throw new Error("Upload total timeout.");
        await withDeadline(once(parser, "drain"), options.signal, Math.min(options.idleTimeoutMs ?? 15_000, drainRemaining));
      }
    }
    parser.end();
    await once(parser, "finish");
    reader.releaseLock();
    reader = null;
  } catch (error) {
    await reader?.cancel().catch(() => undefined);
    reader?.releaseLock();
    reader = null;
    parser.destroy();
    if (error instanceof Error && "status" in error) throw error;
    throw ERR.BAD_REQUEST("Upload fotonya terputus. Coba lagi ya.", "Multipart stream failed.");
  }

  if (parserError) throw ERR.BAD_REQUEST("Format unggahannya tidak valid. Pilih fotonya lagi.", parserError);
  if (tooLarge) throw ERR.PAYLOAD_TOO_LARGE("Fotonya terlalu besar. Maksimal 10 MB per foto.");
  if (tooMany) throw ERR.BAD_REQUEST("Unggah satu foto per permintaan. Beberapa foto tetap bisa ditarik sekaligus dan akan diantrikan.");
  const data = Buffer.concat(photoChunks);
  if (data.length > options.maxFileBytes) throw ERR.PAYLOAD_TOO_LARGE("Fotonya terlalu besar. Maksimal 10 MB per foto.");
  if (!sawPhoto || !data.length) throw ERR.BAD_REQUEST("Tidak ada foto yang dikirim.", "No photo in request.");
  return { mime: photoMime, data };
}
