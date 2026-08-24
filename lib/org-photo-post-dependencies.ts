import { requireOrgContextApi } from "./dashboard-auth";
import { assertDashboardRate } from "./dashboard-rate-limit";
import { acquirePhotoUploadSlot, readSinglePhotoMultipart } from "./capped-form-data";
import {
  pgAppendOrgProductImages,
  pgAudit,
  postgresRuntimeEnabled,
  smokeGetOrgProduct,
} from "./postgres/smoke-runtime";

const productionDependencies = {
  postgresRuntimeEnabled,
  requireOrgContextApi,
  assertDashboardRate,
  smokeGetOrgProduct,
  acquirePhotoUploadSlot,
  readSinglePhotoMultipart,
  pgAppendOrgProductImages,
  pgAudit,
};

export type OrgPhotoPostDependencies = typeof productionDependencies;
let dependenciesForTests: Partial<OrgPhotoPostDependencies> | undefined;

/** Seam deterministik untuk boundary test E8; produksi selalu memakai
 * dependency nyata dan route DELETE tidak melewati seam ini. */
export function setOrgPhotoPostDependenciesForTests(
  dependencies?: Partial<OrgPhotoPostDependencies>
): void {
  dependenciesForTests = dependencies;
}

export function orgPhotoPostDependencies(): OrgPhotoPostDependencies {
  return { ...productionDependencies, ...dependenciesForTests };
}
