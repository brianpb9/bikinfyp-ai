#!/usr/bin/env node

// Run one Codex review in its own process group. The reviewer supervisor uses
// this tiny launcher so a timed-out or terminated review cannot strand MCP or
// helper processes and block every later bus message.

import fs from "node:fs";
import process from "node:process";
import { spawn } from "node:child_process";

const [
  codexBin,
  reviewRoot,
  schemaPath,
  resultPath,
  promptPath,
  logPath,
  timeoutRaw,
] = process.argv.slice(2);

const timeoutSeconds = Number(timeoutRaw);
if (
  !codexBin ||
  !reviewRoot ||
  !schemaPath ||
  !resultPath ||
  !promptPath ||
  !logPath ||
  !Number.isInteger(timeoutSeconds) ||
  timeoutSeconds < 1
) {
  process.stderr.write(
    "usage: codex-review-exec.mjs <codex> <root> <schema> <result> <prompt> <log> <timeout-seconds>\n",
  );
  process.exit(2);
}

const logFd = fs.openSync(logPath, "a");
const child = spawn(
  codexBin,
  [
    "exec",
    "--ignore-user-config",
    "--ephemeral",
    "--sandbox",
    "read-only",
    "--cd",
    reviewRoot,
    "--output-schema",
    schemaPath,
    "-o",
    resultPath,
    "-",
  ],
  {
    cwd: reviewRoot,
    detached: true,
    env: process.env,
    stdio: ["pipe", logFd, logFd],
  },
);

let finished = false;
let timedOut = false;
let hardKillTimer;

function killGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function beginTermination() {
  killGroup("SIGTERM");
  hardKillTimer = setTimeout(() => killGroup("SIGKILL"), 5_000);
  hardKillTimer.unref();
}

const timeout = setTimeout(() => {
  timedOut = true;
  fs.writeSync(logFd, `codex-review-exec: timeout after ${timeoutSeconds}s\n`);
  beginTermination();
}, timeoutSeconds * 1_000);

for (const signal of ["SIGTERM", "SIGINT", "SIGHUP"]) {
  process.on(signal, () => {
    if (!finished) beginTermination();
  });
}

child.on("error", (error) => {
  fs.writeSync(logFd, `codex-review-exec: spawn failed: ${error.message}\n`);
});

fs.createReadStream(promptPath).pipe(child.stdin);

child.on("close", (code, signal) => {
  finished = true;
  clearTimeout(timeout);
  if (hardKillTimer) clearTimeout(hardKillTimer);
  fs.closeSync(logFd);
  if (timedOut) process.exit(124);
  if (signal) process.exit(128);
  process.exit(code ?? 1);
});
