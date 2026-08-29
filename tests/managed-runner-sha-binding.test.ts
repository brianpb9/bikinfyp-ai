import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

test("control launcher rejects an unreviewed runner image before container creation", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "managed-runner-binding-"));
  try {
    const bin = path.join(root, "bin");
    fs.mkdirSync(bin);
    const log = path.join(root, "docker.log");
    fs.writeFileSync(path.join(bin, "docker"), `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$*" >> "$FAKE_DOCKER_LOG"
case "$4" in
  '{{.Id}}') printf 'sha256:%064d\n' 0 | tr 0 a ;;
  *org.opencontainers.image.revision*) printf '%040d\n' 0 | tr 0 b ;;
  *ai.hdrv.source.tree*) printf '%040d\n' 0 | tr 0 c ;;
esac
`, { mode: 0o755 });
    const envFile = path.join(root, "evidence.env");
    fs.writeFileSync(envFile, "");
    assert.throws(() => execFileSync(new URL("../scripts/run-mobile-evidence-image.sh", import.meta.url).pathname, [], {
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        FAKE_DOCKER_LOG: log,
        EVIDENCE_IMAGE: "fixture:latest",
        EXPECTED_APP_SHA: "d".repeat(40),
        EXPECTED_EVIDENCE_RUNNER_SHA: "e".repeat(40),
        EVIDENCE_ENV_FILE: envFile,
        EVIDENCE_RECEIPT_EXPORT_DIR: path.join(root, "receipts"),
      },
      stdio: "pipe",
    }));
    const commands = fs.readFileSync(log, "utf8");
    assert.match(commands, /image inspect/);
    assert.doesNotMatch(commands, /^create /m);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
