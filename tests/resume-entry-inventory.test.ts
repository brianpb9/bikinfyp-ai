import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "c9-resume-inventory-"));
  try {
    fs.mkdirSync(path.join(root, "app/api/unaccounted"), { recursive: true });
    fs.mkdirSync(path.join(root, "lib"), { recursive: true });
    fs.mkdirSync(path.join(root, "scripts"), { recursive: true });
    fs.writeFileSync(path.join(root, "app/api/unaccounted/route.tsx"), `
      import { enqueueJobResume as wakeAgain } from "@/lib/job-queue";
      export const Button = () => <button onClick={() => wakeAgain("job", "tsx-alias")}>wake</button>;
    `);
    fs.writeFileSync(path.join(root, "lib/direct.jsx"), `
      export function bypass(queue, jobId) { return queue.add("render", { jobId }); }
    `);
    fs.writeFileSync(path.join(root, "scripts/worker.mjs"), "export {};\n");
    const fixture = deriveCallInventory(root);
    assert.equal((fixture.enqueueJobResume as Record<string, number>)["app/api/unaccounted/route.tsx"], 1,
      "scanner melewatkan alias call nyata di TSX");
    assert.equal((fixture.directRedisRenderWake as Record<string, number>)["lib/direct.jsx"], 1,
      "scanner melewatkan direct queue wake nyata di JSX");
    assert.throws(() => assertExactCallInventory(fixture), /call-site inventory changed/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("guard C9 menolak enqueue sebelum dua validasi atau rebuild snapshot", () => {
  const route = fs.readFileSync(
    path.join(process.cwd(), "app/api/dashboard/campaign/job/[jobId]/route.ts"),
    "utf8"
  );
  const productGuard = "parseJobProductSnapshot(job.job_product_snapshot";
  const early = route.replace(productGuard, "enqueueJobResume(jobId, action);\n" + productGuard)
    .replace("await deps.enqueueJobResume(jobId, `regen${idx}`);", "void 0;");
  assert.throws(() => assertA6ResumeSafety(early), /after both durable snapshot validations|exactly approve/);

  const unreachable = route
    .replace("try {\n        if (!job.approved_reference_manifest)", "try {\n        if (false) {\n        if (!job.approved_reference_manifest)")
    .replace(
      "await deps.materializeJobReferenceManifest(manifest, path.join(config.storageDir, \"jobs\", jobId));",
      "await deps.materializeJobReferenceManifest(manifest, path.join(config.storageDir, \"jobs\", jobId));\n        }"
    );
  assert.throws(() => assertA6ResumeSafety(unreachable), /unconditional in the same try block/);

  const rebuilt = route.replace(
    "await deps.enqueueJobResume(jobId, \"approve\");",
    "createJobProductSnapshotRaw(job);\n        await deps.enqueueJobResume(jobId, \"approve\");"
  );
  assert.throws(() => assertA6ResumeSafety(rebuilt), /must not rebuild/);

  const overwritten = route.replace(
    "await deps.enqueueJobResume(jobId, \"approve\");",
    "await pool.query(`UPDATE jobs SET job_product_snapshot=$1 WHERE id=$2`, [\"{}\", jobId]);\n        await deps.enqueueJobResume(jobId, \"approve\");"
  );
  assert.throws(() => assertA6ResumeSafety(overwritten), /must not overwrite/);
});
