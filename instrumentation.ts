/** Runtime-only assertion invoked from the Next Node server registration hook.
 * Importing this module alone performs no secret read or validation. */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { assertRuntimeAuthSecretSafe } = await import("./lib/runtime/assert-runtime-auth-secret");
  assertRuntimeAuthSecretSafe();
}
