/**
 * node-postgres returns TIMESTAMPTZ as Date, while SQLite and test seams return
 * text. Convert only a real Date to canonical ISO. Keep strings byte-for-byte
 * so the central boundary can reject non-canonical or impossible timestamps
 * instead of silently normalizing their provenance.
 */
export function canonicalProductTypeTimestamp(value: unknown): string {
  if (value instanceof Date) {
    return Number.isFinite(value.getTime()) ? value.toISOString() : "";
  }
  return typeof value === "string" ? value : "";
}
