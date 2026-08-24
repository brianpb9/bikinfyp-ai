import { getAuthUser } from "./auth";
import { assertDashboardRate } from "./dashboard-rate-limit";
import { requireOrgContextApi } from "./dashboard-auth";
import { assertPaidAdmission } from "./job-intake";
import { allowRate } from "./rate-limit";
import { generateScripts } from "./script-engine";
import {
  pgFindOrCreatePersona,
  postgresRuntimeEnabled,
  smokeCreateScripts,
  smokeGetOrgProduct,
  smokeGetProduct,
} from "./postgres/smoke-runtime";
import { config } from "./config";
import { getPool } from "./postgres/pool";
import { PgJobsRepository } from "./postgres/jobs";
import { PgCreditPaymentRepository } from "./postgres/credit-payment";

const productionDependencies = {
  getAuthUser,
  assertDashboardRate,
  requireOrgContextApi,
  assertPaidAdmission,
  allowRate,
  generateScripts,
  pgFindOrCreatePersona,
  postgresRuntimeEnabled,
  smokeCreateScripts,
  smokeGetOrgProduct,
  smokeGetProduct,
  createMatrixResources: () => ({
    pool: getPool(config.databaseUrl),
    jobsRepo: new PgJobsRepository(config.databaseUrl),
    creditsRepo: new PgCreditPaymentRepository(config.databaseUrl),
  }),
};

export type AdmissionRouteDependencies = typeof productionDependencies;
let dependenciesForTests: Partial<AdmissionRouteDependencies> | undefined;

export function setAdmissionRouteDependenciesForTests(
  dependencies?: Partial<AdmissionRouteDependencies>
): void {
  dependenciesForTests = dependencies;
}

export function admissionRouteDependencies(): AdmissionRouteDependencies {
  return { ...productionDependencies, ...dependenciesForTests };
}
