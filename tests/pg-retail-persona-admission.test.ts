import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const route = fs.readFileSync("app/api/jobs/route.ts", "utf8");
const runtime = fs.readFileSync("lib/postgres/smoke-runtime.ts", "utf8");

test("retail PostgreSQL passes the already validated persona into admission", () => {
  assert.match(route, /smokeCreateJob\(user\.id,\s*\{[^}]*personaId/);
  assert.match(runtime, /personaId:\s*string\s*\|\s*null/);
  assert.match(runtime, /INSERT INTO jobs[^\n]+persona_id[^\n]+VALUES \(\$1,\$2,\$3,\$4/);
  assert.match(runtime, /\[jobId,userId,input\.productId,input\.personaId,input\.scriptId/);
  assert.doesNotMatch(runtime, /INSERT INTO jobs[^\n]+persona_id[^\n]+VALUES \([^\n]*NULL/);
});

test("missing or foreign selected persona fails before any job or hold write", () => {
  const ownershipCheck = runtime.indexOf("SELECT id FROM personas WHERE id=$1 AND user_id=$2 FOR UPDATE");
  const rejection = runtime.indexOf('throw new Error("PERSONA_NOT_FOUND")');
  const jobInsert = runtime.indexOf('client.query("INSERT INTO jobs');
  const holdInsert = runtime.indexOf('client.query("INSERT INTO credit_ledger');
  assert.ok(ownershipCheck >= 0, "ownership check must exist");
  assert.ok(rejection > ownershipCheck, "missing/foreign persona must reject");
  assert.ok(jobInsert > rejection, "persona rejection must precede job insert");
  assert.ok(holdInsert > jobInsert, "hold remains after the protected job insert");
  assert.doesNotMatch(runtime, /SELECT id FROM personas[^\n]+FOR KEY SHARE/, "KEY SHARE permits a concurrent non-key user_id reassignment");
});

test("admission change has no provider execution or candidate SQL bypass", () => {
  const guarded = runtime.slice(runtime.indexOf("export async function smokeCreateJob"), runtime.indexOf("export async function smokeCompleteJob"));
  assert.doesNotMatch(guarded, /provider_video|provider_voice|fetch\(|BytePlus|DashScope/);
  assert.doesNotMatch(route, /UPDATE jobs SET persona_id|approved_reference_manifest/);
});
