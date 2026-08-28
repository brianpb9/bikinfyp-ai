#!/usr/bin/env node
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [rootArg, commit, tree, outputArg] = process.argv.slice(2);
if (!rootArg || !/^[0-9a-f]{40}$/.test(commit ?? "") || !/^[0-9a-f]{40}$/.test(tree ?? "") || !outputArg) {
  throw new Error("usage: create-mobile-evidence-attestation.mjs ROOT COMMIT TREE OUTPUT");
}
const root = path.resolve(rootArg);
const walk = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const absolute = path.join(dir, entry.name);
  if (entry.isDirectory()) return walk(absolute);
  if (!entry.isFile()) throw new Error(`unsupported source entry: ${absolute}`);
  return [path.relative(root, absolute).split(path.sep).join("/")];
});
const files = walk(root).sort().map((relative) => {
  const bytes = fs.readFileSync(path.join(root, relative));
  return { path: relative, bytes: bytes.length, sha256: crypto.createHash("sha256").update(bytes).digest("hex") };
});
fs.writeFileSync(outputArg, `${JSON.stringify({ schema: "mobile-evidence-source/v1", commit, tree, files }, null, 2)}\n`, { mode: 0o444 });
