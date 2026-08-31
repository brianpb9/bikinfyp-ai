import assert from "node:assert/strict";
import test from "node:test";
import {
  PRODUCTION_BLUEPRINT_BASELINE_SHA256,
  readWebContainerInputs,
  verifyWebContainerContract,
  type WebContainerInputs,
} from "../scripts/web-container-contract";

const source = readWebContainerInputs();

function mutate(key: keyof WebContainerInputs, before: string, after = ""): WebContainerInputs {
  assert.ok(source[key].includes(before), `fixture mutation source missing: ${before}`);
  return { ...source, [key]: source[key].replace(before, after) };
}

function rejectsCode(inputs: WebContainerInputs, code: string) {
  const findings = verifyWebContainerContract(inputs);
  assert.ok(findings.some((finding) => finding.code === code), `${code} not rejected: ${JSON.stringify(findings)}`);
}

test("current staging web container contract passes", () => {
  assert.deepEqual(verifyWebContainerContract(source), []);
  assert.match(PRODUCTION_BLUEPRINT_BASELINE_SHA256, /^[a-f0-9]{64}$/);
});

const dockerMutations: Array<[string, string]> = [
  ["ffmpeg tesseract-ocr tesseract-ocr-eng", "WEB_DOCKER_CLASSIFIER_PACKAGES"],
  ["FFMPEG_PATH=/usr/bin/ffmpeg", "WEB_DOCKER_FFMPEG_PATH"],
  ["FFPROBE_PATH=/usr/bin/ffprobe", "WEB_DOCKER_FFPROBE_PATH"],
  ["/srv/app/assets ./assets", "WEB_DOCKER_ASSETS"],
  ["test -f /srv/app/assets/probe/probe-teks.png", "WEB_DOCKER_PROBE_ASSET"],
  ["tesseract --list-langs | grep -qx eng", "WEB_DOCKER_OCR_LANGUAGE_CHECK"],
  ["/srv/app/migrations ./migrations", "WEB_DOCKER_MIGRATIONS"],
  ["/srv/app/scripts/migrate-postgres-runtime.mjs ./scripts/migrate-postgres-runtime.mjs", "WEB_DOCKER_PREDEPLOY_SCRIPT"],
  ["COPY scripts/staging-jj-glow-candidate4-runtime-authorize.ts", "WEB_DOCKER_RUNTIME_AUTHORIZER_SOURCE"],
  ["esbuild scripts/staging-jj-glow-candidate4-runtime-authorize.ts", "WEB_DOCKER_RUNTIME_AUTHORIZER_BUNDLE"],
  ["/srv/app/scripts/staging-jj-glow-candidate4-runtime-authorize.cjs ./scripts/staging-jj-glow-candidate4-runtime-authorize.cjs", "WEB_DOCKER_RUNTIME_AUTHORIZER_COPY"],
  ["test -f /srv/app/scripts/staging-jj-glow-candidate4-runtime-authorize.cjs", "WEB_DOCKER_RUNTIME_AUTHORIZER_ASSERT"],
  ["node --check /srv/app/scripts/staging-jj-glow-candidate4-runtime-authorize.cjs", "WEB_DOCKER_RUNTIME_AUTHORIZER_SYNTAX"],
  ["COPY scripts/staging-jj-glow-candidate4-runtime-successor-authorize.ts", "WEB_DOCKER_RUNTIME_SUCCESSOR_AUTHORIZER_SOURCE"],
  ["esbuild scripts/staging-jj-glow-candidate4-runtime-successor-authorize.ts", "WEB_DOCKER_RUNTIME_SUCCESSOR_AUTHORIZER_BUNDLE"],
  ["/srv/app/scripts/staging-jj-glow-candidate4-runtime-successor-authorize.cjs ./scripts/staging-jj-glow-candidate4-runtime-successor-authorize.cjs", "WEB_DOCKER_RUNTIME_SUCCESSOR_AUTHORIZER_COPY"],
  ["test -f /srv/app/scripts/staging-jj-glow-candidate4-runtime-successor-authorize.cjs", "WEB_DOCKER_RUNTIME_SUCCESSOR_AUTHORIZER_ASSERT"],
  ["node --check /srv/app/scripts/staging-jj-glow-candidate4-runtime-successor-authorize.cjs", "WEB_DOCKER_RUNTIME_SUCCESSOR_AUTHORIZER_SYNTAX"],
  ["/srv/app/.next ./.next", "WEB_DOCKER_NEXT_RUNTIME"],
  ["/srv/app/node_modules ./node_modules", "WEB_DOCKER_NODE_MODULES"],
  ["/srv/app/public ./public", "WEB_DOCKER_PUBLIC"],
  ["/srv/app/.next/cache /srv/app/storage/jobs /srv/app/storage/uploads", "WEB_DOCKER_WRITABLE_PATHS"],
  ["chown -R racun:racun /srv/app/.next /srv/app/storage", "WEB_DOCKER_WRITABLE_OWNERSHIP"],
  ["USER racun", "WEB_DOCKER_NON_ROOT"],
  ['CMD ["npm", "start"]', "WEB_DOCKER_START"],
  ["COPY instrumentation.ts middleware.ts", "WEB_DOCKER_INSTRUMENTATION"],
];

for (const [text, code] of dockerMutations) {
  test(`counterexample ${code} fails closed`, () => rejectsCode(mutate("dockerfile", text), code));
}

test("whole-context COPY is rejected", () => {
  rejectsCode({ ...source, dockerfile: `${source.dockerfile}\nCOPY . .\n` }, "WEB_DOCKER_COPY_ALL");
});

for (const secretDirective of [
  "ARG AUTH_SECRET",
  "ENV AUTH_SECRET=build-placeholder",
  "ARG DATABASE_URL",
  "ENV PROVIDER_API_KEY=placeholder",
]) {
  test(`build secret directive is rejected: ${secretDirective.split(" ")[0]}`, () => {
    rejectsCode({ ...source, dockerfile: `${source.dockerfile}\n${secretDirective}\n` }, "WEB_DOCKER_BUILD_SECRET");
  });
}

for (const [key, text, code] of [
  ["instrumentation", 'process.env.NEXT_RUNTIME !== "nodejs"', "WEB_RUNTIME_NODE_BOUNDARY"],
  ["instrumentation", 'await import("./lib/runtime/assert-runtime-auth-secret")', "WEB_RUNTIME_LAZY_ASSERTION"],
  ["instrumentation", "assertRuntimeAuthSecretSafe();", "WEB_RUNTIME_ASSERTION_CALL"],
  ["runtimeSecretAssertion", "assertAuthSecretSafe(process.env)", "WEB_RUNTIME_FAIL_CLOSED"],
] as Array<[keyof WebContainerInputs, string, string]>) {
  test(`runtime boundary counterexample ${code} fails closed`, () => rejectsCode(mutate(key, text), code));
}

for (const [text, code] of [
  ["runtime: docker", "STAGING_WEB_RUNTIME"],
  ["dockerfilePath: Dockerfile.web", "STAGING_WEB_DOCKERFILE"],
  ["dockerContext: .", "STAGING_WEB_CONTEXT"],
  ["healthCheckPath: /api/health", "STAGING_WEB_HEALTH"],
  ["preDeployCommand: node scripts/migrate-postgres-runtime.mjs", "STAGING_WEB_PREDEPLOY"],
  ["autoDeployTrigger: off", "STAGING_WEB_AUTODEPLOY"],
] as Array<[string, string]>) {
  test(`staging web counterexample ${code} fails closed`, () => rejectsCode(mutate("stagingBlueprint", text), code));
}

test("worker remains bound to Dockerfile.worker", () => {
  rejectsCode(mutate("stagingBlueprint", "dockerfilePath: Dockerfile.worker"), "STAGING_WORKER_DOCKERFILE");
});

test("production Blueprint byte drift fails closed", () => {
  rejectsCode({ ...source, productionBlueprint: `${source.productionBlueprint}\n# drift\n` }, "PRODUCTION_BLUEPRINT_CHANGED");
});

test("secret/bootstrap Docker context exclusions are guarded", () => {
  rejectsCode(mutate("dockerignore", ".hdrv"), "DOCKER_CONTEXT_EXCLUSION");
});

test("secret-bearing env files cannot be re-included", () => {
  rejectsCode({ ...source, dockerignore: `${source.dockerignore}\n!.env.local\n` }, "DOCKER_CONTEXT_ENV_REINCLUDED");
});
