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

/** Seam deterministik untuk exported E1 POST tests; produksi selalu memakai
 * auth dan persistence asli. */
export function setProductCreateDependenciesForTests(
  dependencies?: Partial<ProductCreateDependencies>
): void {
  dependenciesForTests = dependencies;
}

export function productCreateDependencies(): ProductCreateDependencies {
  return { ...productionDependencies, ...dependenciesForTests };
}
