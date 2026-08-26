import { spawnSync } from "node:child_process";

const run = spawnSync(process.execPath, ["node_modules/tsx/dist/cli.mjs", "--test", "tests/c2-type-mismatch.red.ts"], {
  cwd: process.cwd(),
  encoding: "utf8",
  env: { ...process.env, SCRIPT_LLM: "0" },
});
const transcript = `${run.stdout ?? ""}${run.stderr ?? ""}`;
process.stdout.write(transcript);

const checks = {
  expected_nonzero: run.status === 1,
  intended_failure_present: transcript.includes("C2_MISSING_INVARIANT"),
  exactly_one_failure: /# fail 1(?:\r?\n|$)/.test(transcript),
  discovery_and_controls_pass: /# pass 4(?:\r?\n|$)/.test(transcript),
  no_compile_or_setup_failure: !/(ERR_MODULE_NOT_FOUND|Cannot find module|SyntaxError|TypeError \[ERR_UNKNOWN_FILE_EXTENSION\]|not found)/.test(transcript),
};

process.stdout.write(`\nC2_RED_VERIFIER=${JSON.stringify(checks)}\n`);
if (!Object.values(checks).every(Boolean)) process.exit(1);
