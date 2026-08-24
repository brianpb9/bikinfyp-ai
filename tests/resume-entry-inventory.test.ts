import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  assertA6ResumeSafety,
  assertExactCallInventory,
  auditResumeEntryInventory,
  deriveCallInventory,
} from "../scripts/guard-resume-entry-inventory.mjs";

test("C9 inventaris production resume/wake entry lengkap dan snapshot-safe", () => {
  const derived = deriveCallInventory(process.cwd());
  assertExactCallInventory(derived);
  assert.deepEqual(auditResumeEntryInventory(process.cwd()), derived);
});

test("guard C9 menolak call-site resume production baru yang belum diinventaris", () => {
  const derived = deriveCallInventory(process.cwd());
  (derived.enqueueJobResume as Record<string, number>)["app/api/unaccounted/route.ts"] = 1;
  assert.throws(() => assertExactCallInventory(derived), /call-site inventory changed/);
});

test("guard C9 menolak enqueue sebelum dua validasi atau rebuild snapshot", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "app/api/dashboard/campaign/job/[jobId]/route.ts"),
    "utf8"
  );
  const productGuard = "parseJobProductSnapshot(job.job_product_snapshot";
  const early = route.replace(productGuard, "enqueueJobResume(jobId, action);\n" + productGuard)
    .replace("await enqueueJobResume(jobId, `regen${idx}`);", "void 0;");
  assert.throws(() => assertA6ResumeSafety(early), /after both durable snapshot validations/);

  const rebuilt = route.replace(
    "await enqueueJobResume(jobId, \"approve\");",
    "createJobProductSnapshotRaw(job);\n        await enqueueJobResume(jobId, \"approve\");"
  );
  assert.throws(() => assertA6ResumeSafety(rebuilt), /must not rebuild/);
});
