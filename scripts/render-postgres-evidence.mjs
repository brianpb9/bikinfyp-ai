#!/usr/bin/env node
const [databaseId] = process.argv.slice(2);
if (!databaseId?.startsWith("dpg-")) throw new Error("usage: render-postgres-evidence.mjs <database-id>");
const token = process.env.RENDER_API_TOKEN;
if (!token) throw new Error("RENDER_API_TOKEN unavailable");
const response = await fetch(`https://api.render.com/v1/postgres/${encodeURIComponent(databaseId)}`, {
  headers: { Authorization: `Bearer ${token}` },
});
const raw = await response.json();
if (!response.ok) throw new Error(`Render API ${response.status}: ${JSON.stringify(raw)}`);
console.log(JSON.stringify({
  observedAt: new Date().toISOString(),
  request: { method: "GET", path: `/v1/postgres/${databaseId}` },
  response: {
    id: raw.id,
    name: raw.name,
    status: raw.status,
    suspended: raw.suspended,
    plan: raw.plan,
    region: raw.region,
    version: raw.version,
    ipAllowList: raw.ipAllowList,
    updatedAt: raw.updatedAt,
  },
}, null, 2));
