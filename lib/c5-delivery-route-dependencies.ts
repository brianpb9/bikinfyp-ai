import { config } from "./config";
import { requireOrgContextApi } from "./dashboard-auth";
import { assertDashboardRate } from "./dashboard-rate-limit";
import { withProductEvidenceMutationLock } from "./job-admission-reference";
import { getPool } from "./postgres/pool";
import { pgAudit, postgresRuntimeEnabled } from "./postgres/smoke-runtime";
import { createSignedUrl } from "./signed-url";

const productionDependencies = {
  postgresRuntimeEnabled,
  requireOrgContextApi,
  assertDashboardRate,
  withProductEvidenceMutationLock,
  getPool: () => getPool(config.databaseUrl),
  pgAudit,
  createSignedUrl,
};

export type C5DeliveryRouteDependencies = typeof productionDependencies;
let overrides: Partial<C5DeliveryRouteDependencies> | undefined;

export function setC5DeliveryRouteDependenciesForTests(
  next?: Partial<C5DeliveryRouteDependencies>,
): void {
  overrides = next;
}

export function c5DeliveryRouteDependencies(): C5DeliveryRouteDependencies {
  return { ...productionDependencies, ...overrides };
}
