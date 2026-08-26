#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

const [mode, inbox, role, task = "", owner = ""] = process.argv.slice(2);
const fail = (code, message) => {
  if (message) process.stderr.write(`bus-select: ${message}\n`);
  process.exit(code);
};

if (!["read", "wait"].includes(mode) || !inbox || !["builder", "reviewer"].includes(role)) {
  fail(2, "usage: bus-select.mjs <read|wait> <inbox> <builder|reviewer> [task owner]");
}
if (Boolean(task) !== Boolean(owner)) fail(2, "task and owner selectors must be supplied together");

const names = fs.existsSync(inbox)
  ? fs.readdirSync(inbox).filter((name) => name.endsWith(".json")).sort()
  : [];
const routedFields = [
  "task_id", "owner_id", "worker_id", "origin_branch", "origin_worktree",
  "origin_repo_id", "origin_repo_path",
];
let sawRouted = false;
let sawWrongOwner = false;

for (const name of names) {
  const file = path.join(inbox, name);
  let message;
  try {
    message = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    // The canonical Reviewer must be able to dequeue poison for its existing
    // validation/recovery path. Builders fail closed and leave it untouched.
    if (role === "reviewer" && !task) {
      process.stdout.write(`${file}\n`);
      process.exit(0);
    }
    fail(8, `invalid JSON is not claimable by builder: ${name}`);
  }

  const present = routedFields.filter((field) => Object.hasOwn(message, field));
  const legacy = present.length === 0;
  const complete = present.length === routedFields.length &&
    routedFields.every((field) => typeof message[field] === "string" && message[field].length > 0) &&
    message.task_id === message.task && message.owner_id === message.worker_id;

  if (!legacy && !complete) {
    if (role === "reviewer" && !task) {
      process.stdout.write(`${file}\n`);
      process.exit(0);
    }
    fail(8, `partial or inconsistent routing metadata is not claimable: ${name}`);
  }

  if (role === "reviewer" && !task) {
    process.stdout.write(`${file}\n`);
    process.exit(0);
  }

  if (task) {
    if (complete && message.task_id === task && message.owner_id === owner) {
      process.stdout.write(`${file}\n`);
      process.exit(0);
    }
    if (complete && message.task_id === task && message.owner_id !== owner) sawWrongOwner = true;
    continue;
  }

  // Explicit migration behavior: an unscoped Builder may consume only a
  // truly legacy message. It never silently claims a routed message.
  if (legacy) {
    process.stdout.write(`${file}\n`);
    process.exit(0);
  }
  sawRouted = true;
}

if (role === "builder" && !task && sawRouted) fail(8, "routed messages require --task and --owner");
if (sawWrongOwner) fail(8, `owner '${owner}' does not own task '${task}'`);
process.exit(5);
