// The maintenance gate is checked before auth or persistence.  This makes a
// closed intake safe even when a web instance is otherwise under stress.
import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.JOB_INTAKE_MODE = "closed";
process.env.RACUN_WORKER_DISABLED = "1";
process.env.DB_PATH = `/tmp/racun-test-intake-${process.pid}.db`;

const { assertJobIntakeOpen, jobIntakeMode } = await import("../lib/job-intake");
const { POST: createJob } = await import("../app/api/jobs/route");

test("job intake only accepts explicit open/closed values", () => {
  assert.equal(jobIntakeMode("open"), "open");
  assert.equal(jobIntakeMode("closed"), "closed");
  assert.throws(() => jobIntakeMode("drain"), /JOB_INTAKE_MODE/);
});

test("closed intake rejects a new job before auth, DB, hold, or enqueue", async () => {
  assert.throws(() => assertJobIntakeOpen(), (error: unknown) => {
    const e = error as { status?: number; body?: { code?: string } };
    return e.status === 503 && e.body?.code === "JOB_INTAKE_PAUSED";
  });
  const res = await createJob(new Request("http://localhost/api/jobs", {
    method: "POST", headers: { "content-type": "application/json" }, body: "{}",
  }));
  assert.equal(res.status, 503);
  assert.equal((await res.json()).code, "JOB_INTAKE_PAUSED");
});
