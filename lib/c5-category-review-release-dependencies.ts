import crypto from "node:crypto";

import { getAuthUser } from "./auth";
import { config } from "./config";
import { requireOrgContextApi } from "./dashboard-auth";
import { withProductEvidenceMutationLock } from "./job-admission-reference";
import { getPool } from "./postgres/pool";

const productionDependencies = {
  requireOrgContextApi,
  getAuthUser,
  withProductEvidenceMutationLock,
  getPool,
  databaseUrl: () => config.databaseUrl,
  configuredRole: () => process.env.C5_AUTHORIZED_HUMAN_REVIEW_ROLE ?? "",
  configuredPrincipalId: () => process.env.C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID ?? "",
  now: () => new Date().toISOString(),
  uuid: () => crypto.randomUUID(),
};

export type CategoryReviewReleaseDependencies = typeof productionDependencies;
let overrides: Partial<CategoryReviewReleaseDependencies> | undefined;

export function setCategoryReviewReleaseDependenciesForTests(
  next?: Partial<CategoryReviewReleaseDependencies>,
): void {
  overrides = next;
}

export function categoryReviewReleaseDependencies(): CategoryReviewReleaseDependencies {
  return { ...productionDependencies, ...overrides };
}
