import test from "node:test";
import assert from "node:assert/strict";
import sharp from "sharp";
import { ApiError } from "../lib/errors";
import { acquirePhotoUploadSlot, readSinglePhotoMultipart } from "../lib/capped-form-data";
import { saveUniqueProductImages } from "../lib/product-images";
import { type MediaStorage, setMediaStorageForTests } from "../lib/storage";
import { runSequentially } from "../lib/sequential-queue";

class MemoryStorage implements MediaStorage {
  values = new Map<string, Buffer>();
  async put(key: string, body: Buffer) { this.values.set(key, Buffer.from(body)); }
  async delete(key: string) { this.values.delete(key); }
  async get(key: string) { const body = this.values.get(key); return body ? { body, size: body.length } : null; }
  async stat(key: string) { const body = this.values.get(key); return body ? { size: body.length } : null; }
  async materialize() { return null; }
}

test("multipart chunked dihentikan sebelum melewati cap, tanpa mempercayai Content-Length", async () => {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array(20));
      controller.enqueue(new Uint8Array(20));
      controller.close();
    },
  });
  const req = new Request("http://local/upload", {
    method: "POST",
    headers: { "content-type": "multipart/form-data; boundary=proof" },
    body,
    duplex: "half",
  } as RequestInit & { duplex: "half" });
  await assert.rejects(
    () => readSinglePhotoMultipart(req, { maxRequestBytes: 32, maxFileBytes: 24 }),
    (error: unknown) => error instanceof ApiError && error.status === 413
  );
});

test("multipart normal tetap diparse di bawah cap", async () => {
  const form = new FormData();
  form.set("photos", new File(["small"], "small.png", { type: "image/png" }));
  const parsed = await readSinglePhotoMultipart(
    new Request("http://local/upload", { method: "POST", body: form }),
    { maxRequestBytes: 4096, maxFileBytes: 1024 }
  );
  assert.equal(parsed.data.toString(), "small");
  assert.equal(parsed.mime, "image/png");
});

test("batas file inklusif: tepat batas lolos, satu byte lebih ditolak", async () => {
  const requestFor = (size: number) => {
    const form = new FormData();
    form.set("photos", new File([new Uint8Array(size)], "boundary.png", { type: "image/png" }));
    return new Request("http://local/upload", { method: "POST", body: form });
  };
  assert.equal((await readSinglePhotoMultipart(requestFor(1024), { maxRequestBytes: 2048, maxFileBytes: 1024 })).data.length, 1024);
  await assert.rejects(
    () => readSinglePhotoMultipart(requestFor(1025), { maxRequestBytes: 2048, maxFileBytes: 1024 }),
    (error: unknown) => error instanceof ApiError && error.status === 413
  );
});

test("server menolak dua file dalam satu multipart", async () => {
  const form = new FormData();
  form.append("photos", new File(["a"], "a.png", { type: "image/png" }));
  form.append("photos", new File(["b"], "b.png", { type: "image/png" }));
  await assert.rejects(
    () => readSinglePhotoMultipart(new Request("http://local/upload", { method: "POST", body: form }), { maxRequestBytes: 4096, maxFileBytes: 1024 }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
});

test("abort sebelum baca ditolak segera", async () => {
  const controller = new AbortController(); controller.abort();
  const started = Date.now();
  await assert.rejects(
    () => readSinglePhotoMultipart(new Request("http://local/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body: new Uint8Array() }), { maxRequestBytes: 1024, maxFileBytes: 512, signal: controller.signal, idleTimeoutMs: 500 }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
  assert.ok(Date.now() - started < 100);
});

test("hard deadline membatalkan dan membuka stream yang menggantung", async () => {
  let cancelled = false;
  const body = new ReadableStream<Uint8Array>({ pull() { return new Promise(() => {}); }, cancel() { cancelled = true; } });
  await assert.rejects(
    () => readSinglePhotoMultipart(new Request("http://local/upload", { method: "POST", headers: { "content-type": "multipart/form-data; boundary=x" }, body, duplex: "half" } as RequestInit & { duplex: "half" }), { maxRequestBytes: 1024, maxFileBytes: 512, idleTimeoutMs: 500, totalTimeoutMs: 20 }),
    (error: unknown) => error instanceof ApiError && error.status === 400
  );
  assert.equal(cancelled, true);
  assert.equal(body.locked, false);
});

test("semaphore membatasi dua upload/decode aktif per proses", async () => {
  const releaseA = await acquirePhotoUploadSlot(2);
  const releaseB = await acquirePhotoUploadSlot(2);
  let thirdEntered = false;
  const third = acquirePhotoUploadSlot(2).then((release) => { thirdEntered = true; return release; });
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.equal(thirdEntered, false);
  releaseA();
  const releaseC = await third;
  assert.equal(thirdEntered, true);
  releaseB(); releaseC();
});

test("queue mempublikasikan sukses parsial sebelum file berikutnya gagal", async () => {
  const seen: number[] = [];
  await assert.rejects(() => runSequentially(0, [1, 2, 3], async (state, item) => {
    if (item === 2) throw new Error("second failed");
    return state + item;
  }, (state) => seen.push(state)), /second failed/);
  assert.deepEqual(seen, [1]);
});

test("permit semaphore ditransfer ke waiter tanpa barging melewati cap", async () => {
  const releaseA = await acquirePhotoUploadSlot(2);
  const releaseB = await acquirePhotoUploadSlot(2);
  let active = 2; let peak = active;
  const queued = acquirePhotoUploadSlot(2).then((release) => { active += 1; peak = Math.max(peak, active); return release; });
  releaseA(); active -= 1;
  const newcomer = acquirePhotoUploadSlot(2).then((release) => { active += 1; peak = Math.max(peak, active); return release; });
  const releaseQueued = await queued;
  releaseB(); active -= 1;
  const releaseNew = await newcomer;
  assert.equal(peak, 2);
  releaseQueued(); active -= 1; releaseNew(); active -= 1;
});

test("upload paralel memakai object key UUID yang berbeda dan hasil wajib WebP", async () => {
  const fake = new MemoryStorage();
  setMediaStorageForTests(fake);
  try {
    const png = await sharp({ create: { width: 400, height: 400, channels: 3, background: "#eab308" } }).png().toBuffer();
    const [a, b] = await Promise.all([
      saveUniqueProductImages("product-proof", [{ mime: "image/png", data: png }, { mime: "image/png", data: png }]),
      saveUniqueProductImages("product-proof", [{ mime: "image/png", data: png }, { mime: "image/png", data: png }]),
    ]);
    const keys = [...a, ...b];
    assert.equal(new Set(keys).size, 4);
    assert.ok(keys.every((key) => /^uploads\/product-proof\/[0-9a-f-]+\.webp$/.test(key)));

    // SETIAP FOTO PLUS SIDECAR-nya (P0-B1, 21 Agu).
    //
    // Asersi lama di sini `fake.values.size === 4` — "storage berisi tepat
    // empat objek". Itu benar selama jalur org tidak menerbitkan bukti sama
    // sekali, dan justru ketiadaan bukti itulah cacat yang ditutup P0-B1:
    // produk enterprise tidak punya satu pun sidecar, jadi begitu resolver
    // ketat menyala mereka terbrick seluruhnya.
    //
    // Diperkuat, bukan dilonggarkan: yang dituntut sekarang delapan objek YANG
    // BERPASANGAN — setiap kunci foto wajib punya `<kunci>.meta.json`. Asersi
    // ini karena itu menjaga invariant baru di call-site yang sama, bukan
    // sekadar menaikkan angka supaya hijau.
    assert.equal(fake.values.size, 8, "empat foto wajib disertai empat sidecar");
    for (const key of keys) {
      assert.ok(
        fake.values.has(`${key}.meta.json`),
        `foto ${key} tersimpan tanpa bukti kelayakan — produk dari jalur ini akan terbrick`
      );
    }
  } finally {
    setMediaStorageForTests();
  }
});
