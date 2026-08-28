#!/usr/bin/env node
import { verifyPromptArchiveTrace } from "../lib/prompt-archive-trace.mjs";

function fail(message) {
  process.stderr.write(`${JSON.stringify({ status: "FAIL", reason: message })}\n`);
  process.exitCode = 1;
}

const jobId = process.argv[2];
if (!jobId) {
  fail("usage: node scripts/prompt-archive-trace.mjs <job-id>");
} else if (!process.env.DATABASE_URL) {
  fail("DATABASE_URL_MISSING");
} else {
  let client;
  try {
    const { Client } = await import("pg");
    client = new Client({ connectionString: process.env.DATABASE_URL });
    await client.connect();
    await client.query("BEGIN TRANSACTION READ ONLY");
    const jobResult = await client.query(
      "SELECT id,state,provider_video,output_url,qc_result,completed_at FROM jobs WHERE id=$1",
      [jobId],
    );
    const archiveResult = await client.query(
      "SELECT job_id,spec_json,negative_prompt,model_params,created_at FROM job_prompts WHERE job_id=$1",
      [jobId],
    );
    await client.query("ROLLBACK");
    if (jobResult.rowCount !== 1) throw new Error("JOB_NOT_FOUND");
    if (archiveResult.rowCount !== 1) throw new Error("PROMPT_ARCHIVE_NOT_FOUND");
    const modelParams = JSON.parse(archiveResult.rows[0].model_params);
    const result = verifyPromptArchiveTrace({
      job: jobResult.rows[0],
      archive: archiveResult.rows[0],
      requests: modelParams.provider_requests,
    });
    process.stdout.write(`${JSON.stringify(result)}\n`);
  } catch (error) {
    try { await client?.query("ROLLBACK"); } catch {}
    fail(error instanceof Error ? error.message : String(error));
  } finally {
    await client?.end().catch(() => {});
  }
}
