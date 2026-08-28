import { spawnSync } from "node:child_process";

const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "tests/c2-type-mismatch.red.ts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, SCRIPT_LLM: "0" },
});
const transcript = `${run.stdout ?? ""}${run.stderr ?? ""}`;
process.stdout.write(transcript);
const checks = {
  exit_zero: run.status === 0,
  all_five_pass: /# pass 5(?:\r?\n|$)/.test(transcript),
  zero_fail: /# fail 0(?:\r?\n|$)/.test(transcript),
  no_contract_violation: !transcript.includes("C2_IMPLEMENTATION_VIOLATION"),
};
process.stdout.write(`\nC2_GREEN_VERIFIER=${JSON.stringify(checks)}\n`);
if (!Object.values(checks).every(Boolean)) process.exit(1);
