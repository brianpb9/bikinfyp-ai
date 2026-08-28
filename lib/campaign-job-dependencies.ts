import { config } from "./config";
import { requireOrgContextApi } from "./dashboard-auth";
import { assertPaidAdmission } from "./job-intake";
import { withProductEvidenceMutationLock } from "./job-admission-reference";
import { getPool } from "./postgres/pool";
import { postgresRuntimeEnabled } from "./postgres/smoke-runtime";
import { createSignedUrl } from "./signed-url";

const productionDependencies = {
  postgresRuntimeEnabled,
  requireOrgContextApi,
  assertPaidAdmission,
  getPool: () => getPool(config.databaseUrl),
  withProductEvidenceMutationLock,
  createSignedUrl,
};

export type CampaignJobDependencies = typeof productionDependencies;
let dependenciesForTests: Partial<CampaignJobDependencies> | undefined;

export function setCampaignJobDependenciesForTests(
  dependencies?: Partial<CampaignJobDependencies>
): void {
  dependenciesForTests = dependencies;
}

export function campaignJobDependencies(): CampaignJobDependencies {
  return { ...productionDependencies, ...dependenciesForTests };
}
