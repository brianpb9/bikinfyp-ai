#!/usr/bin/env node
const [action, serviceId, argument] = process.argv.slice(2);
if (!action || !serviceId) throw new Error("usage: render-api-evidence.mjs <get-service|maintenance-on|maintenance-off|candidate|restore-node> <service-id> [branch]");

const token = process.env.RENDER_API_TOKEN;
if (!token) throw new Error("RENDER_API_TOKEN unavailable");

const url = `https://api.render.com/v1/services/${encodeURIComponent(serviceId)}`;
const headers = { Authorization: `Bearer ${token}`, "Content-Type": "application/json" };

let method = "GET";
let body;
if (action === "maintenance-on" || action === "maintenance-off") {
  method = "PATCH";
  body = { serviceDetails: { maintenanceMode: { enabled: action === "maintenance-on", uri: "" } } };
} else if (action === "candidate") {
  if (!argument?.startsWith("staging/")) throw new Error("candidate requires a staging-only branch");
  method = "PATCH";
  body = {
    branch: argument,
    autoDeploy: "no",
    serviceDetails: {
      runtime: "docker",
      healthCheckPath: "/api/health",
      preDeployCommand: "node scripts/migrate-postgres-runtime.mjs",
      maintenanceMode: { enabled: true, uri: "" },
      dockerCommand: "",
      dockerContext: ".",
      dockerfilePath: "Dockerfile.web",
    },
  };
} else if (action === "restore-node") {
  method = "PATCH";
  body = {
    branch: "main",
    autoDeploy: "no",
    serviceDetails: {
      runtime: "node",
      buildCommand: "npm ci --include=dev && npm run build",
      preDeployCommand: "node scripts/migrate-postgres-runtime.mjs",
      startCommand: "npm start",
      healthCheckPath: "",
      maintenanceMode: { enabled: true, uri: "" },
    },
  };
} else if (action !== "get-service") {
  throw new Error(`unsupported action ${action}`);
}

const response = await fetch(url, { method, headers, body: body && JSON.stringify(body) });
const raw = await response.json();
if (!response.ok) throw new Error(`Render API ${response.status}: ${JSON.stringify(raw)}`);

const details = raw.serviceDetails ?? {};
const sanitized = {
  observedAt: new Date().toISOString(),
  request: { method, path: `/v1/services/${serviceId}`, action, payload: body ?? null },
  response: {
    id: raw.id,
    name: raw.name,
    type: raw.type,
    repo: raw.repo,
    branch: raw.branch,
    autoDeploy: raw.autoDeploy,
    suspended: raw.suspended,
    updatedAt: raw.updatedAt,
    serviceDetails: {
      runtime: details.runtime,
      plan: details.plan,
      region: details.region,
      buildCommand: details.buildCommand,
      preDeployCommand: details.preDeployCommand,
      startCommand: details.startCommand,
      healthCheckPath: details.healthCheckPath,
      maintenanceMode: details.maintenanceMode,
      dockerCommand: details.dockerCommand,
      dockerContext: details.dockerContext,
      dockerfilePath: details.dockerfilePath,
      envSpecificDetails: details.envSpecificDetails ? {
        buildCommand: details.envSpecificDetails.buildCommand,
        startCommand: details.envSpecificDetails.startCommand,
        dockerCommand: details.envSpecificDetails.dockerCommand,
        dockerContext: details.envSpecificDetails.dockerContext,
        dockerfilePath: details.envSpecificDetails.dockerfilePath,
      } : undefined,
    },
  },
};
console.log(JSON.stringify(sanitized, null, 2));
