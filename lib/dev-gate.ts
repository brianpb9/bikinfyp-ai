// Gate jalur khusus dev (dev-login, dev topup, webhook stub): hanya terbuka di luar
// production ATAU bila ALLOW_DEV_LOGIN=1. Di production jalur ini WAJIB mati.

import { config } from "./config";
import { ApiError } from "./errors";

export function devRouteAllowed(): boolean {
  return config.allowDevLogin || process.env.NODE_ENV !== "production";
}

export function assertDevRoute(): void {
  if (!devRouteAllowed()) {
    throw new ApiError(403, {
      code: "DEV_ROUTE_DISABLED",
      message_id: "Jalur ini cuma untuk mode pengembangan.",
      message_en: "This route is disabled in production.",
      retryable: false,
    });
  }
}
