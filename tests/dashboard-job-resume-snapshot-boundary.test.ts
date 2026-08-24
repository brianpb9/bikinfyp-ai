import test from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";

const { POST } = await import("../app/api/dashboard/campaign/job/[jobId]/route");
const { setDashboardJobPostDependenciesForTests } = await import("../lib/dashboard-job-post-dependencies");

const productSnapshot = JSON.stringify({
  version: 2,
  productName: "Produk Admission",
  category: "beauty",
  priceIdr: 89_000,
  trustedBrand: { source: "products.raw_meta.brand", value: "Merek Sah" },
  productVisualDesc: "botol amber",
  brandBrief: "faktual",
  claims: ["ringan"],
});
const referenceManifest = JSON.stringify({
  version: 1,
  references: [{
    rel: "uploads/approved.webp",
    sha256: "a".repeat(64),
    versiBukti: 1,
    snapshotRel: "jobs/job-c9/approved-references/0-approved.webp",
  }],
});

test("A6 POST menolak snapshot missing/invalid sebelum semua side effect approve dan regenerate", async (t) => {
  t.after(() => setDashboardJobPostDependenciesForTests());
  const cases = [
    { name: "approve missing manifest", action: "approve", product: productSnapshot, manifest: null },
    { name: "approve invalid product", action: "approve", product: "{}", manifest: referenceManifest },
    { name: "regenerate missing product", action: "regenerate", product: null, manifest: referenceManifest },
    { name: "regenerate invalid manifest", action: "regenerate", product: productSnapshot, manifest: "{}" },
  ] as const;

  for (const scenario of cases) {
    const effects = { query: 0, connect: 0, materialize: 0, reset: 0, enqueue: 0 };
    const pool = {
      query: async () => { effects.query += 1; throw new Error("DB side effect reached"); },
      connect: async () => { effects.connect += 1; throw new Error("regen transaction reached"); },
    };
    setDashboardJobPostDependenciesForTests({
      postgresRuntimeEnabled: () => true,
      requireOrgContextApi: async () => ({
        user: { id: "owner-c9" },
        membership: { org_id: "org-c9", role: "owner" },
      }) as never,
      getPool: () => pool as never,
      loadJob: async () => ({
        id: "job-c9",
        state: "AWAITING_APPROVAL",
        org_id: "org-c9",
        approved_at: null,
        requires_approval: true,
        product_name: "Produk Mutable",
        segments: "[]",
        quality_tier: "silent_caption",
        format: "tvc",
        template_id: null,
        script_validation_result: null,
        approved_reference_manifest: scenario.manifest,
        job_product_snapshot: scenario.product,
      }),
      pastikanBolehBelanja: () => undefined,
      assertPaidAdmission: async () => undefined,
      assertDashboardRate: async () => undefined,
      materializeJobReferenceManifest: async () => { effects.materialize += 1; return []; },
      pgForgetShotTask: async () => { effects.reset += 1; },
      enqueueJobResume: async () => { effects.enqueue += 1; },
    });

    const response = await POST(new Request("http://local.test/api/dashboard/campaign/job/job-c9", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(scenario.action === "approve" ? { action: "approve" } : { action: "regenerate", idx: 0 }),
    }), { params: Promise.resolve({ jobId: "job-c9" }) });
    assert.equal(response.status, 400, `${scenario.name}: ${await response.clone().text()}`);
    assert.deepEqual(effects, { query: 0, connect: 0, materialize: 0, reset: 0, enqueue: 0 },
      `${scenario.name}: approval/regen/ledger/audit/reset/enqueue side effect lolos`);
  }
});
