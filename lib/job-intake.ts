/**
 * Operational admission gate.  Closing intake rejects only *new* POST /jobs
 * requests; queued/in-flight BullMQ jobs remain owned by the worker and can
 * drain safely.  It is deliberately an env-controlled, deploy-time switch:
 * no unprotected HTTP endpoint can change it.
 */
import { config } from "./config";
import { ApiError } from "./errors";

export type JobIntakeMode = "open" | "closed";

export function jobIntakeMode(value = config.jobIntakeMode): JobIntakeMode {
  if (value === "open" || value === "closed") return value;
  throw new Error("JOB_INTAKE_MODE harus bernilai open atau closed.");
}

export function assertJobIntakeOpen(value = config.jobIntakeMode): void {
  if (jobIntakeMode(value) === "open") return;
  throw new ApiError(503, {
    code: "JOB_INTAKE_PAUSED",
    message_id: "Pembuatan video sedang dijeda sebentar untuk perawatan. Job yang sudah masuk tetap aman.",
    message_en: "New render jobs are temporarily paused for maintenance. Existing jobs continue to run.",
    retryable: true,
  });
}
