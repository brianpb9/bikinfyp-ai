import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "racun-pg-dirs-"));
const sqliteParent = path.join(root, "sqlite-must-not-exist");
const storage = path.join(root, "storage");

process.env.RACUN_NO_DOTENV = "1";
process.env.RACUN_DB_RUNTIME = "postgres";
process.env.DB_PATH = path.join(sqliteParent, "racun.db");
process.env.STORAGE_DIR = storage;

const { ensureDirs } = await import("../lib/config");

test("ensureDirs PostgreSQL menyiapkan storage tanpa menyentuh direktori rollback SQLite", (t) => {
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));

  ensureDirs();

  assert.equal(fs.existsSync(sqliteParent), false, "runtime PostgreSQL masih membuat ./data SQLite");
  assert.equal(fs.statSync(storage).isDirectory(), true);
  assert.equal(fs.statSync(path.join(storage, "uploads")).isDirectory(), true);
  assert.equal(fs.statSync(path.join(storage, "jobs")).isDirectory(), true);
});
