#!/usr/bin/env node
/**
 * Staging-only queue admission load test.
 *
 * It deliberately stops before media processing: the caller must suspend the
 * dedicated worker first, while the web service still enqueues into Redis.
 * Each of 20 isolated dev users receives exactly its signup bonus (Rp5.000),
 * then submits one unique approved script. Four concurrent duplicate submits
 * exercise the active-job/queue dedup path without buying media-provider work.
 *
 * Required guard: CONFIRM_STAGING_LOAD_TEST=1 BASE_URL=https://... node ...
 */
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const base = (process.env.BASE_URL ?? "").replace(/\/$/, "");
if (process.env.CONFIRM_STAGING_LOAD_TEST !== "1") throw new Error("Refusing: set CONFIRM_STAGING_LOAD_TEST=1.");
if (base !== "https://racun-ai-staging-web.onrender.com") throw new Error("Refusing: BASE_URL must be the approved staging URL.");

const OUT = process.env.OUT ?? "test_output/staging-qa/load-test.json";
const photoPath = path.resolve("../test_output/hands_a.png");
const photo = fs.readFileSync(photoPath);
const users = 20;

async function call(url, options = {}, expected = [200, 201]) {
  const res = await fetch(`${base}${url}`, options);
  const body = await res.json().catch(() => ({ raw: "<non-json>" }));
  if (!expected.includes(res.status)) throw new Error(`${options.method ?? "GET"} ${url}: HTTP ${res.status} ${JSON.stringify(body)}`);
  return { res, body };
}
function json(body, cookie) { return { method: "POST", headers: { "content-type": "application/json", cookie }, body: JSON.stringify(body) }; }
function cookieFrom(res) { return String(res.headers.get("set-cookie") ?? "").split(";")[0]; }

const startedAt = new Date().toISOString();
const fixtures = [];
console.log(`Preparing ${users} isolated staging fixtures (worker must remain suspended)...`);
for (let i = 0; i < users; i++) {
  const phone = `0899${String(Date.now() % 1_000_000).padStart(6, "0")}${String(i).padStart(2, "0")}`;
  const login = await call("/api/auth/dev-login", json({ phone }));
  const cookie = cookieFrom(login.res); assert(cookie, "dev-login cookie missing");
  const form = new FormData();
  form.set("name", `Load Test ${i + 1}`);
  form.set("price_idr", "85000");
  form.set("category", "beauty");
  form.append("photos", new Blob([photo], { type: "image/png" }), "hands_a.png");
  const product = await call("/api/products", { method: "POST", headers: { cookie }, body: form });
  const scripts = await call("/api/scripts/generate", json({ product_id: product.body.product_id, register: "bestie", emotion: "senang", format: "hands_only" }, cookie));
  const scriptId = scripts.body.scripts?.[0]?.id; assert(scriptId, "script id missing");
  await call(`/api/scripts/${scriptId}/approve`, json({}, cookie));
  fixtures.push({ phone, cookie, scriptId, userId: login.body.user.id });
  console.log(`fixture ${i + 1}/${users}`);
}

console.log("Submitting 20 unique jobs concurrently...");
const submissions = await Promise.all(fixtures.map(async (f) => {
  const { res, body } = await call("/api/jobs", json({ script_id: f.scriptId, format: "hands_only", duration_s: 15 }, f.cookie));
  return { scriptId: f.scriptId, userId: f.userId, status: res.status, jobId: body.job_id, duplicate: Boolean(body.duplicate), state: body.state };
}));
assert.equal(new Set(submissions.map((x) => x.jobId)).size, users, "unique scripts must create 20 unique jobs");
assert(submissions.every((x) => x.status === 201 && x.state === "QUEUED" && !x.duplicate), "unique admissions must be QUEUED exactly once");

console.log("Submitting 4 duplicate requests concurrently...");
const first = fixtures[0];
const duplicateAttempts = await Promise.all(Array.from({ length: 4 }, async () => {
  const { res, body } = await call("/api/jobs", json({ script_id: first.scriptId, format: "hands_only", duration_s: 15 }, first.cookie));
  return { status: res.status, jobId: body.job_id, duplicate: Boolean(body.duplicate), state: body.state };
}));
assert(duplicateAttempts.every((x) => x.status === 200 && x.duplicate && x.jobId === submissions[0].jobId && x.state === "QUEUED"), "duplicate submits must reuse exactly one queued job");

console.log("Reconciling each job and ledger hold...");
const reconciled = await Promise.all(fixtures.map(async (f, i) => {
  const credits = await call("/api/credits", { headers: { cookie: f.cookie } });
  const jobs = await call("/api/jobs", { headers: { cookie: f.cookie } });
  const own = jobs.body.jobs.filter((j) => j.id === submissions[i].jobId);
  const holds = credits.body.ledger.filter((l) => l.job_id === submissions[i].jobId && l.type === "hold");
  return { userId: f.userId, jobId: submissions[i].jobId, balance: credits.body.balance, matchingJobs: own.length, holds: holds.length, holdDelta: holds[0]?.delta ?? null, state: own[0]?.state ?? null };
}));
assert(reconciled.every((x) => x.balance === 0 && x.matchingJobs === 1 && x.holds === 1 && x.holdDelta === -5000 && x.state === "QUEUED"), "each user must have exactly one -Rp5.000 hold and one queued job");

const report = { startedAt, finishedAt: new Date().toISOString(), base, workerMustBeSuspended: true, uniqueSubmissions: submissions, duplicateAttempts, reconciled, summary: { users, uniqueJobs: submissions.length, duplicateRequests: duplicateAttempts.length, duplicateJobId: submissions[0].jobId, totalHoldsIdr: reconciled.reduce((n, x) => n + -x.holdDelta, 0), allQueued: reconciled.every((x) => x.state === "QUEUED") } };
fs.mkdirSync(path.dirname(OUT), { recursive: true });
fs.writeFileSync(OUT, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify(report.summary));
