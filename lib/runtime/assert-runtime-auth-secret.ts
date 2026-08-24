import { assertAuthSecretSafe } from "../auth-secret-policy";

/** Node-server startup boundary. Imported lazily by Next instrumentation so
 * build-time module discovery never requires or receives a runtime secret. */
export function assertRuntimeAuthSecretSafe(): void {
  assertAuthSecretSafe(process.env);
}
