import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

export interface WebContainerInputs {
  dockerfile: string;
  stagingBlueprint: string;
  productionBlueprint: string;
  dockerignore: string;
}

export interface ContractFinding {
  code: string;
  message: string;
}

export const PRODUCTION_BLUEPRINT_BASELINE_SHA256 =
  "3b1a33a4e4556717481d10e2dbe7a6ff9982bd7ce41b3ec0b92013f19b3710f7";

function requireText(
  findings: ContractFinding[],
  text: string,
  expected: string,
  code: string,
  message: string
) {
  if (!text.includes(expected)) findings.push({ code, message });
}

function serviceBlock(blueprint: string, name: string): string {
  const nameOffset = blueprint.indexOf(`name: ${name}`);
  if (nameOffset < 0) return "";
  const prefix = blueprint.slice(0, nameOffset);
  const start = prefix.lastIndexOf("  - type:");
  if (start < 0) return "";
  const rest = blueprint.slice(nameOffset);
  const nextService = rest.indexOf("\n  - type:");
  const databases = rest.indexOf("\ndatabases:");
  const candidates = [nextService, databases].filter((offset) => offset >= 0);
  const end = candidates.length > 0 ? nameOffset + Math.min(...candidates) : blueprint.length;
  return blueprint.slice(start, end);
}

export function verifyWebContainerContract(inputs: WebContainerInputs): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const dockerfileRequirements: Array<[string, string, string]> = [
    ["FROM node:22-bookworm-slim AS dependencies", "WEB_DOCKER_DEPS_STAGE", "dependency stage missing"],
    ["FROM dependencies AS build", "WEB_DOCKER_BUILD_STAGE", "build stage missing"],
    ["FROM node:22-bookworm-slim AS runtime", "WEB_DOCKER_RUNTIME_STAGE", "runtime stage missing"],
    ["RUN npm ci", "WEB_DOCKER_REPRODUCIBLE_INSTALL", "npm ci missing"],
    ["RUN npm run build", "WEB_DOCKER_NEXT_BUILD", "Next build missing"],
    ["npm prune --omit=dev", "WEB_DOCKER_PRODUCTION_DEPS", "production dependency prune missing"],
    ["ffmpeg tesseract-ocr tesseract-ocr-eng", "WEB_DOCKER_CLASSIFIER_PACKAGES", "classifier packages or OCR language missing"],
    ["FFMPEG_PATH=/usr/bin/ffmpeg", "WEB_DOCKER_FFMPEG_PATH", "FFmpeg path missing"],
    ["FFPROBE_PATH=/usr/bin/ffprobe", "WEB_DOCKER_FFPROBE_PATH", "FFprobe path missing"],
    ["/srv/app/assets ./assets", "WEB_DOCKER_ASSETS", "runtime assets missing"],
    ["test -f /srv/app/assets/probe/probe-teks.png", "WEB_DOCKER_PROBE_ASSET", "classifier probe build assertion missing"],
    ["tesseract --list-langs | grep -qx eng", "WEB_DOCKER_OCR_LANGUAGE_CHECK", "OCR language build assertion missing"],
    ["/srv/app/migrations ./migrations", "WEB_DOCKER_MIGRATIONS", "runtime migrations missing"],
    ["/srv/app/scripts/migrate-postgres-runtime.mjs ./scripts/migrate-postgres-runtime.mjs", "WEB_DOCKER_PREDEPLOY_SCRIPT", "pre-deploy script missing"],
    ["/srv/app/.next ./.next", "WEB_DOCKER_NEXT_RUNTIME", "Next runtime build missing"],
    ["/srv/app/node_modules ./node_modules", "WEB_DOCKER_NODE_MODULES", "runtime node_modules missing"],
    ["/srv/app/public ./public", "WEB_DOCKER_PUBLIC", "public runtime files missing"],
    ["/srv/app/knowledge ./knowledge", "WEB_DOCKER_KNOWLEDGE", "runtime knowledge files missing"],
    ["/srv/app/.next/cache /srv/app/storage/jobs /srv/app/storage/uploads", "WEB_DOCKER_WRITABLE_PATHS", "writable runtime paths missing"],
    ["chown -R racun:racun /srv/app/.next /srv/app/storage", "WEB_DOCKER_WRITABLE_OWNERSHIP", "writable paths are not owned by runtime user"],
    ["USER racun", "WEB_DOCKER_NON_ROOT", "non-root user missing"],
    ['CMD ["npm", "start"]', "WEB_DOCKER_START", "web start command missing"],
  ];
  for (const [expected, code, message] of dockerfileRequirements) {
    requireText(findings, inputs.dockerfile, expected, code, message);
  }
  if (/^COPY\s+\.\s+\./m.test(inputs.dockerfile)) {
    findings.push({ code: "WEB_DOCKER_COPY_ALL", message: "Dockerfile must not copy the whole local context" });
  }

  const web = serviceBlock(inputs.stagingBlueprint, "racun-ai-staging-web");
  for (const [expected, code, message] of [
    ["type: web", "STAGING_WEB_TYPE", "staging web service missing"],
    ["runtime: docker", "STAGING_WEB_RUNTIME", "staging web is not Docker"],
    ["dockerfilePath: Dockerfile.web", "STAGING_WEB_DOCKERFILE", "staging web Dockerfile path incorrect"],
    ["dockerContext: .", "STAGING_WEB_CONTEXT", "staging web Docker context incorrect"],
    ["healthCheckPath: /api/health", "STAGING_WEB_HEALTH", "staging web health path changed"],
    ["preDeployCommand: node scripts/migrate-postgres-runtime.mjs", "STAGING_WEB_PREDEPLOY", "staging migration hook missing"],
    ["autoDeployTrigger: off", "STAGING_WEB_AUTODEPLOY", "staging web auto-deploy is not off"],
  ] as Array<[string, string, string]>) {
    requireText(findings, web, expected, code, message);
  }
  if (web.includes("buildCommand:") || web.includes("startCommand:")) {
    findings.push({ code: "STAGING_WEB_NATIVE_COMMANDS", message: "native Node commands remain on Docker staging web" });
  }

  const worker = serviceBlock(inputs.stagingBlueprint, "racun-ai-staging-worker");
  requireText(findings, worker, "runtime: docker", "STAGING_WORKER_RUNTIME", "staging worker is not Docker");
  requireText(findings, worker, "dockerfilePath: Dockerfile.worker", "STAGING_WORKER_DOCKERFILE", "worker Dockerfile changed");
  requireText(findings, worker, "dockerContext: .", "STAGING_WORKER_CONTEXT", "worker Docker context changed");
  requireText(findings, worker, "autoDeployTrigger: off", "STAGING_WORKER_AUTODEPLOY", "worker auto-deploy changed");

  const productionHash = createHash("sha256").update(inputs.productionBlueprint).digest("hex");
  if (productionHash !== PRODUCTION_BLUEPRINT_BASELINE_SHA256) {
    findings.push({ code: "PRODUCTION_BLUEPRINT_CHANGED", message: "render.production.yaml differs from accepted baseline" });
  }

  for (const ignored of [".env*", ".agent-bus", ".hdrv", "MAIN-GOAL.md", "PROJECT-WORK-ORDER.md"]) {
    requireText(findings, inputs.dockerignore, ignored, "DOCKER_CONTEXT_EXCLUSION", `missing Docker context exclusion: ${ignored}`);
  }
  return findings;
}

export function readWebContainerInputs(root = process.cwd()): WebContainerInputs {
  return {
    dockerfile: fs.readFileSync(path.join(root, "Dockerfile.web"), "utf8"),
    stagingBlueprint: fs.readFileSync(path.join(root, "render.yaml"), "utf8"),
    productionBlueprint: fs.readFileSync(path.join(root, "render.production.yaml"), "utf8"),
    dockerignore: fs.readFileSync(path.join(root, ".dockerignore"), "utf8"),
  };
}

const invokedPath = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (invokedPath === fileURLToPath(import.meta.url)) {
  const findings = verifyWebContainerContract(readWebContainerInputs());
  if (findings.length > 0) {
    for (const finding of findings) console.error(`[web-container] ${finding.code}: ${finding.message}`);
    process.exitCode = 1;
  } else {
    console.log("[web-container] PASS static contract");
  }
}
