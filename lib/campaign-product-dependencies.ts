import crypto from "node:crypto";

import { config } from "./config";
import { requireOrgContextApi } from "./dashboard-auth";
import { extractFromUrl } from "./extract";
import { withProductEvidenceMutationLock } from "./job-admission-reference";
import { getPool } from "./postgres/pool";
import { pgAudit, pgCanExtract, postgresRuntimeEnabled, smokeCreateProduct, smokeGetOrgProduct } from "./postgres/smoke-runtime";
import { downloadProductImages } from "./product-image-download";

const productionDependencies={postgresRuntimeEnabled,requireOrgContextApi,pgCanExtract,pgAudit,extractFromUrl,
  downloadProductImages,smokeCreateProduct,smokeGetOrgProduct,withProductEvidenceMutationLock,getPool,
  databaseUrl:()=>config.databaseUrl,uuid:()=>crypto.randomUUID(),now:()=>new Date().toISOString()};
export type CampaignProductDependencies=typeof productionDependencies;
let dependencyOverrides:Partial<CampaignProductDependencies>|undefined;

export function setCampaignProductDependenciesForTests(overrides?:Partial<CampaignProductDependencies>):void {
  dependencyOverrides=overrides;
}

export function campaignProductDependencies():CampaignProductDependencies {
  return {...productionDependencies,...dependencyOverrides};
}
