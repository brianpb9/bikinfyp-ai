import { config } from "@/lib/config";
import { assertQueueConfiguration } from "@/lib/job-queue";
import { jobIntakeMode } from "@/lib/job-intake";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Render liveness/readiness endpoint.  It deliberately exposes no secrets and
 * does not accept traffic-control changes.  A configuration failure returns
 * 503 so Render health checks do not mark a misconfigured deployment healthy.
 */
export async function GET() {
  try {
    assertQueueConfiguration();
    if (process.env.NODE_ENV === "production" && config.dbRuntime !== "postgres") {
      throw new Error("Production wajib RACUN_DB_RUNTIME=postgres.");
    }
    if (process.env.NODE_ENV === "production" && config.storageMode !== "r2") {
      throw new Error("Production wajib STORAGE_MODE=r2.");
    }
    if (process.env.RACUN_DEPLOY_ENV === "production" && config.allowDevLogin) {
      throw new Error("ALLOW_DEV_LOGIN wajib 0 pada deployment production.");
    }
    return Response.json({ ok: true, intake: jobIntakeMode() }, { status: 200 });
  } catch (error) {
    console.error("[health] configuration failure", error);
    return Response.json({ ok: false, code: "HEALTH_CONFIGURATION_FAILED" }, { status: 503 });
  }
}
