// Reviewer ronde 3, temuan #5: provenance "baru sebatas tipe".
//
//   - approve menimpa seluruh validation_result, jadi script_source hilang
//     persis di langkah yang membuat naskah boleh dirender;
//   - GET /api/scripts/:id tidak mengembalikannya sama sekali;
//   - field terstruktur penulis LLM (framing/camera/action/expression/mode)
//     dibuang di keSegmentDraft, jadi FlowSegment punya tipenya tapi tidak
//     pernah punya datanya.
//
// Diuji lewat HANDLER NYATA dengan SQLite sementara — bukan lewat fungsi
// pembantu, karena yang gagal dulu adalah jalurnya, bukan fungsinya.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.DB_PATH = `/tmp/racun-test-prov-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-prov-storage-${process.pid}`;
process.env.RACUN_WORKER_DISABLED = "1";
process.env.SCRIPT_LLM = "0";

const { getDb, now, uuid } = await import("../lib/db");
const { findOrCreateUserByPhone, issueToken } = await import("../lib/auth");
const { POST: approveScript } = await import("../app/api/scripts/[id]/approve/route");
const { GET: getScript } = await import("../app/api/scripts/[id]/route");
const { keSegmentDraft } = await import("../lib/script-engine/llm");
const { amplopValidasi } = await import("../lib/script-engine/admisi");

const db = getDb();
const user = findOrCreateUserByPhone("087777000222");
const token = await issueToken(user.id, user.phone ?? "");

const productId = uuid();
db.prepare(
  "INSERT INTO products (id, user_id, source_url, name, price_idr, category, images, raw_meta, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
).run(productId, user.id, "https://www.tiktok.com/@x/video/1", "Serum Glow Bright", 85000, "beauty", JSON.stringify([]), null, now());

const segments = [
  { role: "hook", start: 0, end: 3, text: "Say, masa 85 ribu segini sih?", visual_direction: "x" },
  { role: "demo", start: 3, end: 10, text: "nah, teksturnya niat banget deh", visual_direction: "x" },
  { role: "cta", start: 10, end: 15, text: "linknya di keranjang kuning ya", visual_direction: "x" },
];

/** Baris seperti yang DITULIS rute generate: vonis + jejak dalam satu amplop. */
const scriptId = uuid();
const validationTersimpan = amplopValidasi(
  { passed: true, errors: [], warnings: [], checked_at: now() },
  { script_source: "llm", admisi: { contentType: "affiliate", durationSec: 15, cartLabel: "keranjang kuning", templateId: null } }
);
db.prepare(
  `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, approved_by_user_at, edited_by_user, created_at)
   VALUES (?, NULL, ?, 'H1', 'senang', 'bestie', ?, 'caption', '[]', ?, 'high_quality', NULL, 0, ?)`
).run(scriptId, productId, JSON.stringify(segments), JSON.stringify(validationTersimpan), now());

const ctxOf = (id: string) => ({ params: Promise.resolve({ id }) });
const post = (url: string, body: unknown) =>
  new Request(`http://localhost${url}`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: `racun_token=${encodeURIComponent(token)}` },
    body: JSON.stringify(body),
  });
const get = (url: string) =>
  new Request(`http://localhost${url}`, { headers: { cookie: `racun_token=${encodeURIComponent(token)}` } });

test("approve TIDAK menghapus script_source maupun snapshot", async () => {
  const res = await approveScript(post(`/api/scripts/${scriptId}/approve`, {}), ctxOf(scriptId));
  assert.equal(res.status, 200, JSON.stringify(await res.clone().json()));

  const baris = db.prepare("SELECT validation_result FROM scripts WHERE id = ?").get(scriptId) as { validation_result: string };
  const tersimpan = JSON.parse(baris.validation_result);
  assert.equal(tersimpan.script_source, "llm", "provenance hilang saat approve — cacat lama");
  assert.equal(tersimpan.admisi?.cartLabel, "keranjang kuning", "snapshot hilang saat approve");
  assert.equal(tersimpan.passed, true);
});

test("GET /api/scripts/:id mengembalikan provenance", async () => {
  const res = await getScript(get(`/api/scripts/${scriptId}`), ctxOf(scriptId));
  assert.equal(res.status, 200);
  const body = await res.json();
  assert.equal(body.script.script_source, "llm", "UI tidak punya cara tahu naskah ini dari mana");
  assert.equal(body.script.admisi?.durationSec, 15);
});

test("field terstruktur penulis LLM TIDAK dibuang", () => {
  const draft = keSegmentDraft([
    {
      block: "HOOK", label: "x", start: 0, end: 4, text: "Kok begini?",
      start_state: "Bottle is on table", framing: "tight macro", angle: "top down",
      camera: "slow push in", action: "hand reaches for the bottle",
      expression: "curious", mode: "product", product_state: "hidden",
    } as never,
  ]);
  const s = draft[0] as Record<string, unknown>;
  for (const kunci of ["framing", "angle", "camera", "action", "expression", "mode", "product_state", "start_state"]) {
    assert.ok(s[kunci], `${kunci} dibuang — FlowSegment punya tipenya tapi tidak pernah punya datanya`);
  }
  // Gabungannya TETAP ada: sisa pipeline membacanya.
  assert.match(String(s.visual_direction), /tight macro, top down\. slow push in\. hand reaches/);
});
