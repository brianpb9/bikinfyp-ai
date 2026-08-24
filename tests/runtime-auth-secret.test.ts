import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import test from "node:test";

const root = process.cwd();
const tsx = path.join(root, "node_modules", "tsx", "dist", "loader.mjs");

function child(code: string, authSecret?: string) {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RACUN_NO_DOTENV: "1",
    NODE_ENV: "production",
    NEXT_RUNTIME: "nodejs",
  };
  delete env.AUTH_SECRET;
  if (authSecret !== undefined) env.AUTH_SECRET = authSecret;
  return spawnSync(process.execPath, ["--import", tsx, "--eval", code], {
    cwd: root,
    env,
    encoding: "utf8",
  });
}

function output(result: ReturnType<typeof child>) {
  return `${result.stdout}\n${result.stderr}`;
}

function workerChild(authSecret: string | undefined, queueMode = "redis") {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    RACUN_NO_DOTENV: "1",
    NODE_ENV: "production",
    RACUN_QUEUE_MODE: queueMode,
    REDIS_URL: "redis://127.0.0.1:1",
  };
  delete env.AUTH_SECRET;
  if (authSecret !== undefined) env.AUTH_SECRET = authSecret;
  return spawnSync(process.execPath, ["--import", tsx, "scripts/worker.ts"], {
    cwd: root,
    env,
    encoding: "utf8",
    timeout: 10_000,
  });
}

test("secretless production module imports are build-safe", () => {
  for (const modulePath of ["./lib/config.ts", "./instrumentation.ts", "./app/api/promo/jobs/route.ts"]) {
    const result = child(`await import(${JSON.stringify(modulePath)});`);
    assert.equal(result.status, 0, `${modulePath}: ${output(result)}`);
  }
});

for (const [name, secret, message] of [
  ["missing", undefined, "AUTH_SECRET wajib diisi"],
  ["development default", "dev-secret-racun-ai-jangan-dipakai-produksi", "nilai bawaan pengembangan"],
  ["too short", "pendek123", "terlalu pendek"],
] as const) {
  test(`Node server registration rejects ${name} AUTH_SECRET`, () => {
    const result = child('const { register } = await import("./instrumentation.ts"); await register();', secret);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), new RegExp(message));
  });
}

test("Node server registration accepts a valid runtime secret", () => {
  const result = child('const { register } = await import("./instrumentation.ts"); await register();', "x".repeat(32));
  assert.equal(result.status, 0, output(result));
});

for (const [name, secret, message] of [
  ["missing", undefined, "AUTH_SECRET wajib diisi"],
  ["development default", "dev-secret-racun-ai-jangan-dipakai-produksi", "nilai bawaan pengembangan"],
  ["too short", "pendek123", "terlalu pendek"],
] as const) {
  test(`dedicated production worker rejects ${name} AUTH_SECRET before BullMQ startup`, () => {
    const result = workerChild(secret);
    assert.notEqual(result.status, 0, output(result));
    assert.match(output(result), new RegExp(message));
    assert.doesNotMatch(output(result), /ECONNREFUSED|Worker terpisah membutuhkan/);
  });
}

test("dedicated production worker accepts a valid AUTH_SECRET and preserves queue validation", () => {
  const result = workerChild("w".repeat(32), "inline");
  assert.notEqual(result.status, 0, output(result));
  assert.match(output(result), /Production wajib RACUN_QUEUE_MODE=redis; worker inline ditolak/);
  assert.doesNotMatch(output(result), /AUTH_SECRET/);
});

test("JWT consumers read the current runtime secret instead of an import snapshot", () => {
  const result = child(`
    process.env.AUTH_SECRET = "a".repeat(32);
    const { issueToken, verifyToken } = await import("./lib/auth.ts");
    const first = await issueToken("user-a", "user@example.test");
    if (!(await verifyToken(first))) throw new Error("first token did not verify");
    process.env.AUTH_SECRET = "b".repeat(32);
    if ((await verifyToken(first)) !== null) throw new Error("old token verified after runtime secret change");
    const second = await issueToken("user-a", "user@example.test");
    if (!(await verifyToken(second))) throw new Error("second token did not use changed runtime secret");
  `, "a".repeat(32));
  assert.equal(result.status, 0, output(result));
});

test("auth consumers fail closed if the runtime secret becomes missing or short after import", () => {
  const result = child(`
    process.env.AUTH_SECRET = "a".repeat(32);
    const { issueToken } = await import("./lib/auth.ts");
    await issueToken("user-a", "user@example.test");
    delete process.env.AUTH_SECRET;
    await issueToken("user-a", "user@example.test").then(
      () => { throw new Error("missing runtime secret was accepted"); },
      (error) => { if (!String(error).includes("AUTH_SECRET wajib diisi")) throw error; }
    );
    process.env.AUTH_SECRET = "pendek123";
    await issueToken("user-a", "user@example.test").then(
      () => { throw new Error("short runtime secret was accepted"); },
      (error) => { if (!String(error).includes("terlalu pendek")) throw error; }
    );
    process.env.AUTH_SECRET = "c".repeat(32);
    await issueToken("user-a", "user@example.test");
  `, "a".repeat(32));
  assert.equal(result.status, 0, output(result));
});

test("derived signing keys refresh when the runtime secret changes", () => {
  const result = child(`
    process.env.AUTH_SECRET = "a".repeat(32);
    const { mediaUrlKey } = await import("./lib/secrets.ts");
    const first = mediaUrlKey().toString("hex");
    process.env.AUTH_SECRET = "b".repeat(32);
    const second = mediaUrlKey().toString("hex");
    if (first === second) throw new Error("derived key remained frozen");
  `, "a".repeat(32));
  assert.equal(result.status, 0, output(result));
});

test("actual SQLite OTP hashing rotates and fails closed on later invalid secrets", () => {
  const result = child(`
    process.env.AUTH_SECRET = "a".repeat(32);
    const { hashCode } = await import("./lib/otp.ts");
    const first = hashCode("user@example.test", "123456");
    process.env.AUTH_SECRET = "b".repeat(32);
    const second = hashCode("user@example.test", "123456");
    if (first === second) throw new Error("OTP hash remained frozen after rotation");
    delete process.env.AUTH_SECRET;
    try { hashCode("user@example.test", "123456"); throw new Error("missing secret accepted"); }
    catch (error) { if (!String(error).includes("AUTH_SECRET wajib diisi")) throw error; }
    process.env.AUTH_SECRET = "pendek123";
    try { hashCode("user@example.test", "123456"); throw new Error("short secret accepted"); }
    catch (error) { if (!String(error).includes("terlalu pendek")) throw error; }
  `, "a".repeat(32));
  assert.equal(result.status, 0, output(result));
});

for (const [name, invalidSecret] of [
  ["short", "pendek123"],
  ["development default", "dev-secret-racun-ai-jangan-dipakai-produksi"],
] as const) {
  test(`Edge middleware cannot accept a JWT signed with a ${name} runtime secret`, () => {
    const result = child(`
      const { SignJWT } = await import("jose");
      const token = await new SignJWT({ phone: "user@example.test" })
        .setProtectedHeader({ alg: "HS256" })
        .setSubject("user-a")
        .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
      const { NextRequest } = await import("next/server");
      const { middleware } = await import("./middleware.ts");
      const request = new NextRequest("http://localhost/dashboard", {
        headers: { cookie: "racun_token=" + encodeURIComponent(token) },
      });
      const response = await middleware(request);
      if (response.status !== 307 || !response.headers.get("location")?.includes("/brands")) {
        throw new Error("middleware accepted invalid runtime secret");
      }
    `, invalidSecret);
    assert.equal(result.status, 0, output(result));
  });
}

test("Edge middleware accepts a JWT signed with the valid current runtime secret", () => {
  const result = child(`
    const { SignJWT } = await import("jose");
    const token = await new SignJWT({ phone: "user@example.test" })
      .setProtectedHeader({ alg: "HS256" })
      .setSubject("user-a")
      .sign(new TextEncoder().encode(process.env.AUTH_SECRET));
    const { NextRequest } = await import("next/server");
    const { middleware } = await import("./middleware.ts");
    const response = await middleware(new NextRequest("http://localhost/dashboard", {
      headers: { cookie: "racun_token=" + encodeURIComponent(token) },
    }));
    if (response.status !== 200 || response.headers.get("x-middleware-next") !== "1") {
      throw new Error("middleware rejected valid current runtime secret");
    }
  `, "v".repeat(32));
  assert.equal(result.status, 0, output(result));
});
