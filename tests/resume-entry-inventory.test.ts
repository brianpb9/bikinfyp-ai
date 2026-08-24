import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  assertA6ResumeSafety,
  assertDirectRenderWakePayloads,
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
    fs.writeFileSync(path.join(root, "lib/reordered.ts"), `
      export const bypass = (queue, jobId, traceId) => queue.add("render", { traceId, jobId });
    `);
    fs.writeFileSync(path.join(root, "scripts/variable.mjs"), `
      export const bypass = (queue, payload) => queue.add("render", payload);
    `);
    fs.writeFileSync(path.join(root, "scripts/worker.mjs"), "export {};\n");
    const fixture = deriveCallInventory(root);
    assert.equal((fixture.enqueueJobResume as Record<string, number>)["app/api/unaccounted/route.tsx"], 1,
      "scanner melewatkan alias call nyata di TSX");
    assert.equal((fixture.directRedisRenderWake as Record<string, number>)["lib/direct.jsx"], 1,
      "scanner melewatkan direct queue wake nyata di JSX");
    assert.equal((fixture.directRedisRenderWake as Record<string, number>)["lib/reordered.ts"], 1,
      "scanner melewatkan direct wake dengan property sebelum jobId");
    assert.equal((fixture.directRedisRenderWake as Record<string, number>)["scripts/variable.mjs"], 1,
      "scanner melewatkan direct wake dengan variable payload");
    assert.doesNotThrow(() => assertDirectRenderWakePayloads(
      fs.readFileSync(path.join(root, "lib/direct.jsx"), "utf8")
    ));
    for (const rel of ["lib/reordered.ts", "scripts/variable.mjs"]) {
      assert.throws(() => assertDirectRenderWakePayloads(fs.readFileSync(path.join(root, rel), "utf8")),
        /exact \{ jobId \} payload/, `${rel}: payload bypass tidak ditolak`);
    }
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

  const shortCircuited = route
    .replace(productGuard, "false && " + productGuard)
    .replace("await deps.materializeJobReferenceManifest", "false && await deps.materializeJobReferenceManifest");
  assert.throws(() => assertA6ResumeSafety(shortCircuited), /direct unconditional statement/);

  const wrapProductStatement = (wrapper: (expression: string) => string) => {
    const position = route.indexOf(productGuard);
    const start = route.lastIndexOf(";", position) + 1;
    const end = route.indexOf(";", position) + 1;
    const expression = route.slice(start, end).trim().replace(/;$/, "");
    return route.slice(0, start) + "\n        " + wrapper(expression) + ";" + route.slice(end);
  };
  for (const [name, mutated] of [
    ["true-or", route.replace(productGuard, "true || " + productGuard)],
    ["ternary", wrapProductStatement((expression) => `flag ? (${expression}) : undefined`)],
    ["comma", wrapProductStatement((expression) => `(${expression}, noop())`)],
    ["wrapper", wrapProductStatement((expression) => `(${expression})`)],
    ["nested-if", wrapProductStatement((expression) => `if (flag) { ${expression}; }`)],
    ["nested-loop", wrapProductStatement((expression) => `while (flag) { ${expression}; }`)],
    ["nested-function", wrapProductStatement((expression) => `(() => { ${expression}; })()`)],
  ] as const) {
    assert.throws(() => assertA6ResumeSafety(mutated), /direct unconditional statement|top-level statement/,
      `${name}: validator bersyarat lolos`);
  }

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
