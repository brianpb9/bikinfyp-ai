export const ACTIVE_EVIDENCE_LEASE = "ACTIVE_EVIDENCE_LEASE" as const;
export const NORMAL_EVIDENCE_LEASE_TTL_SECONDS = 6 * 60 * 60;

export type EvidenceLeaseRow = {
  state: string;
  provider_post_count: number | string;
  lease_kind: string | null;
  lease_last_progress_at: string | Date | null;
  lease_expires_at: string | Date | null;
};

export function normalEvidenceLeaseWindow(
  lastProgressAt: string,
  ttlSeconds = NORMAL_EVIDENCE_LEASE_TTL_SECONDS,
): { kind: typeof ACTIVE_EVIDENCE_LEASE; lastProgressAt: string; expiresAt: string } {
  const progressMs = Date.parse(lastProgressAt);
  if (!Number.isFinite(progressMs) || !Number.isSafeInteger(ttlSeconds) || ttlSeconds <= 0) {
    throw new Error("NORMAL_EVIDENCE_LEASE_WINDOW_INVALID");
  }
  return {
    kind: ACTIVE_EVIDENCE_LEASE,
    lastProgressAt: new Date(progressMs).toISOString(),
    expiresAt: new Date(progressMs + ttlSeconds * 1_000).toISOString(),
  };
}

export function hasUnexpiredEvidenceLease(row: EvidenceLeaseRow, evaluatedAt: string): boolean {
  return row.lease_kind === ACTIVE_EVIDENCE_LEASE
    && row.state === "PREPOST_READY"
    && Number(row.provider_post_count) === 0
    && row.lease_expires_at !== null
    && Date.parse(String(row.lease_expires_at)) > Date.parse(evaluatedAt);
}

/** Generic stale cleanup must never settle an outbound request. Provider
 * recovery owns those states because request bytes or provider cost may
 * already exist even when the evidence lease has expired. */
export function isProviderEvidenceInFlight(row: EvidenceLeaseRow): boolean {
  return Number(row.provider_post_count) > 0
    || ["POST_ATTEMPTED", "TASK_BOUND", "PROVIDER_SUCCEEDED"].includes(row.state);
}
