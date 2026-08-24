import { getAuthUser } from "./auth";
import { audit, getDb, now, uuid } from "./db";
import { postgresRuntimeEnabled, smokeCreateProduct } from "./postgres/smoke-runtime";

const productionDependencies = {
  getAuthUser,
  audit,
  getDb,
  now,
  uuid,
  postgresRuntimeEnabled,
  smokeCreateProduct,
};

export type ProductCreateDependencies = typeof productionDependencies;
let dependenciesForTests: Partial<ProductCreateDependencies> | undefined;

/** Test seam for the exported E1 handler; production keeps canonical deps. */
export function setProductCreateDependenciesForTests(
  dependencies?: Partial<ProductCreateDependencies>,
): void {
  dependenciesForTests = dependencies;
}

export function productCreateDependencies(): ProductCreateDependencies {
  return { ...productionDependencies, ...dependenciesForTests };
}
