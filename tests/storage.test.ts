import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import { type MediaStorage, setMediaStorageForTests, mediaStorage } from "../lib/storage";

class MemoryObjectStorage implements MediaStorage {
  values = new Map<string, Buffer>();
  async put(key: string, body: Buffer) { this.values.set(key, Buffer.from(body)); }
  async delete(key: string) { this.values.delete(key); }
  async get(key: string, range?: { start: number; end: number }) {
    const body = this.values.get(key);
    if (!body) return null;
    return { body: range ? body.subarray(range.start, range.end + 1) : body, size: body.length };
  }
  async stat(key: string) { const body = this.values.get(key); return body ? { size: body.length } : null; }
  async materialize(_key: string) { return null; }
}

test("storage contract supports private object writes and byte ranges without R2 network", async () => {
  const fake = new MemoryObjectStorage();
  setMediaStorageForTests(fake);
  await mediaStorage().put("uploads/user/photo.webp", Buffer.from("abcdef"), "image/webp");
  assert.deepEqual(await mediaStorage().stat("uploads/user/photo.webp"), { size: 6 });
  assert.equal((await mediaStorage().get("uploads/user/photo.webp", { start: 2, end: 4 }))?.body.toString(), "cde");
  assert.equal(await mediaStorage().get("uploads/user/missing.webp"), null);
  setMediaStorageForTests();
});

test("filesystem materialize: hanya ENOENT menjadi null; kegagalan stat I/O dipropagasikan", async () => {
  setMediaStorageForTests();
  const key = `jobs/storage-stat-${process.pid}/approved-references/ref.webp`;
  await mediaStorage().put(key, Buffer.from("snapshot"));
  assert.equal(await mediaStorage().materialize(`${key}.missing`), null, "ENOENT bukan missing/null");

  const originalStat = fs.promises.stat;
  const io = Object.assign(new Error("disk read failure"), { code: "EIO" });
  fs.promises.stat = (async (target: fs.PathLike) => {
    if (String(target).endsWith(key)) throw io;
    return originalStat(target);
  }) as typeof fs.promises.stat;
  try {
    await assert.rejects(
      () => mediaStorage().materialize(key),
      (error) => error === io && (error as NodeJS.ErrnoException).code === "EIO"
    );
  } finally {
    fs.promises.stat = originalStat;
    await mediaStorage().delete(key);
    setMediaStorageForTests();
  }
});
