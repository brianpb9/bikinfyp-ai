import assert from "node:assert/strict";
import test from "node:test";
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
