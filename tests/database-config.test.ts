import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import test from "node:test";
import {
  DatabaseConfigurationError,
  assertLegacySqliteRuntimeAllowed,
  isPostgresDatabaseUrl,
} from "../lib/database-config";

test("database guard: PostgreSQL URL dikenali", () => {
  assert.equal(isPostgresDatabaseUrl("postgresql://user:secret@localhost:5432/app"), true);
  assert.equal(isPostgresDatabaseUrl("postgres://user@localhost/app"), true);
  assert.equal(isPostgresDatabaseUrl("sqlite:///tmp/app.db"), false);
});

test("database guard: dev/test tetap mengizinkan SQLite sementara", () => {
  assert.doesNotThrow(() => assertLegacySqliteRuntimeAllowed({ NODE_ENV: "test" }));
  assert.doesNotThrow(() => assertLegacySqliteRuntimeAllowed({ NODE_ENV: "development" }));
});

test("database guard: production tanpa DATABASE_URL gagal tertutup", () => {
  assert.throws(
    () => assertLegacySqliteRuntimeAllowed({ NODE_ENV: "production" }),
    (error: unknown) => error instanceof DatabaseConfigurationError && /DATABASE_URL wajib/.test(error.message)
  );
});

test("database guard: production menolak URL non-PostgreSQL dan adapter SQLite", () => {
  assert.throws(
    () => assertLegacySqliteRuntimeAllowed({ NODE_ENV: "production", DATABASE_URL: "sqlite:///tmp/app.db" }),
    /harus memakai skema postgres/
  );
  assert.throws(
    () => assertLegacySqliteRuntimeAllowed({ NODE_ENV: "production", DATABASE_URL: "postgresql://user:secret@db/app" }),
    /Adapter SQLite dinonaktifkan/
  );
});

test("database guard: getDb tidak pernah membuka SQLite di production", () => {
  const result = spawnSync(
    process.execPath,
    ["--import", "tsx", "--input-type=module", "-e", "import { getDb } from './lib/db.ts'; getDb()"],
    {
      cwd: process.cwd(),
      env: {
        ...process.env,
        NODE_ENV: "production",
        DATABASE_URL: "postgresql://user:secret@localhost/app",
        RACUN_NO_DOTENV: "1",
      },
      encoding: "utf8",
    }
  );
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Adapter SQLite dinonaktifkan di production/);
});
