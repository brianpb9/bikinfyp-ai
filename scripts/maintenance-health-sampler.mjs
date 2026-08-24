#!/usr/bin/env node
import crypto from "node:crypto";

const serviceId = process.env.STAGING_WEB_SERVICE_ID;
const healthUrl = process.env.STAGING_HEALTH_URL;
if (!serviceId || !healthUrl) throw new Error("STAGING_WEB_SERVICE_ID and STAGING_HEALTH_URL are required");
const token = process.env.RENDER_API_TOKEN;
if (!token) throw new Error("RENDER_API_TOKEN unavailable");
const headers = { Authorization: `Bearer ${token}` };
let stopping = false;
process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

while (!stopping) {
  const observedAt = new Date().toISOString();
  let service;
  let healthStatus;
  let healthBodySha256;
  let error;
  try {
    const [serviceResponse, healthResponse] = await Promise.all([
      fetch(`https://api.render.com/v1/services/${serviceId}`, { headers }),
      fetch(healthUrl),
    ]);
    service = await serviceResponse.json();
    const healthBody = await healthResponse.text();
    healthStatus = healthResponse.status;
    healthBodySha256 = crypto.createHash("sha256").update(healthBody).digest("hex");
    if (!serviceResponse.ok) throw new Error(`service GET ${serviceResponse.status}`);
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
  }
  console.log(JSON.stringify({
    observedAt,
    serviceId,
    maintenanceMode: service?.serviceDetails?.maintenanceMode,
    serviceUpdatedAt: service?.updatedAt,
    healthUrl,
    healthStatus,
    healthBodySha256,
    error,
  }));
  if (!stopping) await new Promise((resolve) => setTimeout(resolve, 15_000));
}
