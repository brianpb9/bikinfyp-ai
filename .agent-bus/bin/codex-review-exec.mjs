#!/usr/bin/env node

// Run one Codex review in its own process group. The reviewer supervisor uses
// this tiny launcher so a timed-out or terminated review cannot strand MCP or
// helper processes and block every later bus message.

import fs from "node:fs";
import process from "node:process";
import { spawn } from "node:child_process";

if (process.argv[2] === "--terminate-group") {
  const pid = Number(process.argv[3]);
  if (!Number.isInteger(pid) || pid < 2) process.exit(2);

  const groupExists = () => {
    try { process.kill(-pid, 0); return true; }
    catch (error) {
      if (error?.code === "ESRCH") return false;
      throw error;
    }
  };
  const signalGroup = (signal) => {
    try { process.kill(-pid, signal); }
    catch (error) { if (error?.code !== "ESRCH") throw error; }
  };

  signalGroup("SIGTERM");
  const deadline = Date.now() + 5_000;
  while (groupExists() && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  if (groupExists()) {
    signalGroup("SIGKILL");
    const killDeadline = Date.now() + 1_000;
    while (groupExists() && Date.now() < killDeadline) {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  process.exit(groupExists() ? 1 : 0);
}

const [
  codexBin,
  reviewRoot,
  schemaPath,
  resultPath,
  promptPath,
  logPath,
  runnerPidPath,
  childPidPath,
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
  !runnerPidPath ||
  !childPidPath ||
  !Number.isInteger(timeoutSeconds) ||
  timeoutSeconds < 1
) {
  process.stderr.write(
    "usage: codex-review-exec.mjs <codex> <root> <schema> <result> <prompt> <log> <runner-pid-file> <child-pid-file> <timeout-seconds>\n",
  );
  process.exit(2);
}

const logFd = fs.openSync(logPath, "a");
fs.writeFileSync(runnerPidPath, `${process.pid}\n`);
const childEnv = {
  ...process.env,
  NPM_CONFIG_OFFLINE: "true",
  npm_config_offline: "true",
};
delete childEnv.NODE_PATH;
const child = spawn(
  codexBin,
  [
    "exec",
    "--ignore-user-config",
    "-c",
    'model_reasoning_effort="high"',
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
    env: childEnv,
    stdio: ["pipe", logFd, logFd],
  },
);

if (child.pid) fs.writeFileSync(childPidPath, `${child.pid}\n`);

let finished = false;
let timedOut = false;
let hardKillTimer;
let terminating = false;

function killGroup(signal) {
  if (!child.pid) return;
  try {
    process.kill(-child.pid, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function beginTermination() {
  if (terminating) return;
  terminating = true;
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

child.stdin.on("error", (error) => {
  if (error?.code !== "EPIPE") {
    fs.writeSync(logFd, `codex-review-exec: stdin failed: ${error.message}\n`);
  }
});

fs.createReadStream(promptPath).pipe(child.stdin);

child.on("close", (code, signal) => {
  finished = true;
  clearTimeout(timeout);
  if (hardKillTimer) clearTimeout(hardKillTimer);
  try {
    if (fs.readFileSync(childPidPath, "utf8").trim() === String(child.pid)) {
      fs.unlinkSync(childPidPath);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  try {
    if (fs.readFileSync(runnerPidPath, "utf8").trim() === String(process.pid)) {
      fs.unlinkSync(runnerPidPath);
    }
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }
  fs.closeSync(logFd);
  if (timedOut) process.exit(124);
  if (signal) process.exit(128);
  process.exit(code ?? 1);
});
