// Kredit & billing (FSD F-10) — DENOMINASI RUPIAH (keputusan final 31 Jul 2026).
// credit_ledger APPEND-ONLY: saldo = agregat delta rupiah, tidak pernah UPDATE langsung.
// Alur wajib: hold (sebesar harga tier) -> capture (QC lulus) | release (gagal).

import { getDb, now, uuid, audit } from "./db";
import { config } from "./config";
import type { QualityTier } from "./providers/types";

// Paket top-up — bundel per tier (BRD §5.2 "kebiasaan beli pulsa").
// 2026-08-06: tier Teks+Musik DIHAPUS dari AI UGC Affiliate (fokus persona
// bersuara) — paket senyap5/senyap10 pensiun; hq5 jadi paket masuk termurah.
export const TOPUP_PACKAGES = [
  { id: "hq5", name: "5× AI Bersuara", priceIdr: 60_000, videos: 5, tier: "high_quality" },
  { id: "hq10", name: "10× AI Bersuara", priceIdr: 120_000, videos: 10, tier: "high_quality" },
  { id: "super5", name: "5× AI Bersuara Pro", priceIdr: 245_000, videos: 5, tier: "super_hq" },
] as const;

export type PackageId = (typeof TOPUP_PACKAGES)[number]["id"];

/** Harga per tier skala linear dari basis 15 dtk — AI video-gen (BytePlus) dibayar
 * per detik shot, jadi video 30 dtk = 2x shot-detik = kira-kira 2x biaya (2026-08-03). */
export function tierPriceIdr(tier: QualityTier, durationSec = 15): number {
  const base = config.tiers[tier]?.priceIdr ?? config.tiers.silent_caption.priceIdr;
  return Math.round(base * (durationSec / 15));
}

export function getBalance(userId: string): number {
  const row = getDb()
    .prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ?")
    .get(userId) as { balance: number };
  return row.balance; // rupiah
}

function ledger(userId: string, delta: number, type: string, jobId: string | null, paymentId: string | null) {
  getDb()
    .prepare(
      "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(uuid(), userId, delta, type, jobId, paymentId, now());
}

/** Hold sebesar harga tier saat job dibuat. Return false bila saldo kurang. */
export function holdCredits(userId: string, jobId: string, amountIdr: number): boolean {
  if (getBalance(userId) < amountIdr) return false;
  ledger(userId, -amountIdr, "hold", jobId, null);
  audit(userId, "credit.hold", "jobs", jobId, { amount_idr: amountIdr });
  return true;
}

/** Capture saat QC lulus: hold menjadi final (delta 0 — saldo tetap terpotong oleh hold). Idempoten. */
export function captureCredits(userId: string, jobId: string): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM credit_ledger WHERE job_id = ? AND type = 'capture'")
    .get(jobId);
  if (existing) return;
  ledger(userId, 0, "capture", jobId, null);
  audit(userId, "credit.capture", "jobs", jobId, {});
}

/** Release/refund saat job gagal: kembalikan seluruh hold yang belum di-capture. Idempoten. */
export function releaseCredits(userId: string, jobId: string): number {
  const db = getDb();
  const already = db
    .prepare("SELECT id FROM credit_ledger WHERE job_id = ? AND type IN ('capture','release')")
    .get(jobId);
  if (already) return 0;
  const held = db
    .prepare("SELECT COALESCE(-SUM(delta), 0) AS held FROM credit_ledger WHERE job_id = ? AND type = 'hold'")
    .get(jobId) as { held: number };
  if (held.held <= 0) return 0;
  ledger(userId, held.held, "release", jobId, null);
  audit(userId, "credit.release", "jobs", jobId, { amount_idr: held.held });
  return held.held;
}

export function getLedger(userId: string, limit = 50) {
  return getDb()
    .prepare("SELECT * FROM credit_ledger WHERE user_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?")
    .all(userId, limit);
}

/**
 * Kreditkan top-up dari pembayaran (rupiah). Idempoten via gateway_ref (BR-10.3).
 */
export function creditTopup(opts: {
  userId: string;
  packageId: string;
  gateway: string;
  gatewayRef: string;
  rawPayload?: unknown;
}): { duplicated: boolean; amountIdr: number } {
  const pkg = TOPUP_PACKAGES.find((p) => p.id === opts.packageId);
  if (!pkg) throw new Error(`Paket tidak dikenal: ${opts.packageId}`);
  const db = getDb();
  const dup = db.prepare("SELECT id, status FROM payments WHERE gateway_ref = ?").get(opts.gatewayRef) as
    | { id: string; status: string }
    | undefined;
  if (dup && dup.status === "paid") return { duplicated: true, amountIdr: pkg.priceIdr };

  if (dup) {
    // Row pending dari checkout — promosikan jadi paid + 1 entri ledger (tetap idempoten).
    // raw_payload lama (berisi package_id) digabung agar tidak hilang.
    const oldPayload = (() => {
      try {
        const row = db.prepare("SELECT raw_payload FROM payments WHERE id = ?").get(dup.id) as { raw_payload: string | null };
        return JSON.parse(row.raw_payload ?? "{}") as Record<string, unknown>;
      } catch {
        return {};
      }
    })();
    const merged = { ...oldPayload, ...(opts.rawPayload as Record<string, unknown> | undefined) };
    db.prepare("UPDATE payments SET status = 'paid', raw_payload = ? WHERE id = ?").run(
      JSON.stringify(merged), dup.id
    );
    ledger(opts.userId, pkg.priceIdr, "topup", null, dup.id);
    audit(opts.userId, "credit.topup", "payments", dup.id, {
      package_id: opts.packageId, amount_idr: pkg.priceIdr, gateway: opts.gateway,
    });
    return { duplicated: false, amountIdr: pkg.priceIdr };
  }

  const paymentId = uuid();
  db.prepare(
    "INSERT INTO payments (id, user_id, gateway, gateway_ref, amount_idr, credits, status, raw_payload, created_at) VALUES (?,?,?,?,?,?,?,?,?)"
  ).run(
    paymentId, opts.userId, opts.gateway, opts.gatewayRef, pkg.priceIdr, pkg.priceIdr,
    "paid", opts.rawPayload ? JSON.stringify(opts.rawPayload) : null, now()
  );
  ledger(opts.userId, pkg.priceIdr, "topup", null, paymentId);
  audit(opts.userId, "credit.topup", "payments", paymentId, {
    package_id: opts.packageId, amount_idr: pkg.priceIdr, gateway: opts.gateway,
  });
  return { duplicated: false, amountIdr: pkg.priceIdr };
}
