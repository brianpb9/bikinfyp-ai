// Seam ingatan task provider (lib/providers/task-memo.ts).
//
// Yang dijaga di sini adalah KABELNYA, bukan implementasi Postgres-nya:
// provider harus tetap berjalan normal saat tidak ada yang memasang memo
// (unit test, jalur dev SQLite), dan harus memakai yang dipasang saat ada.
import { test } from "node:test";
import assert from "node:assert/strict";

const { taskMemo, setTaskMemo } = await import("../lib/providers/task-memo");

test("bawaan no-op: get selalu null, put/clear tidak melempar", async () => {
  const m = taskMemo();
  const digest = "a".repeat(64);
  assert.equal(await m.get("j", 0, "byteplus", digest), null);
  await m.put("j", 0, "byteplus", "t1", digest);
  await m.clear("j");
  // Tetap null: tanpa implementasi terpasang, perilakunya persis seperti
  // sebelum fitur ini ada — provider selalu mengirim task baru.
  assert.equal(await m.get("j", 0, "byteplus", digest), null);
});

test("implementasi yang dipasang benar-benar dipakai", async () => {
  const store = new Map<string, string>();
  const calls: string[] = [];
  setTaskMemo({
    async get(j, i, p) { calls.push("get"); return store.get(`${j}:${i}:${p}`) ?? null; },
    async put(j, i, p, t) { calls.push("put"); store.set(`${j}:${i}:${p}`, t); },
    async clear(j) { calls.push("clear"); for (const k of [...store.keys()]) if (k.startsWith(`${j}:`)) store.delete(k); },
  });
  const m = taskMemo();
  const digest = "a".repeat(64);
  assert.equal(await m.get("j1", 0, "byteplus", digest), null);
  await m.put("j1", 0, "byteplus", "task-abc", digest);
  assert.equal(await m.get("j1", 0, "byteplus", digest), "task-abc");
  await m.clear("j1");
  assert.equal(await m.get("j1", 0, "byteplus", digest), null);
  assert.deepEqual(calls, ["get", "put", "get", "clear", "get"]);
});
