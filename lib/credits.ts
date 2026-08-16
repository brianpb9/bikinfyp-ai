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
  // r7 (Brian 2026-08-07): AI Bersuara Pro = satu-satunya tier presenter
  // ber-lip-sync sungguhan (audio embedded asli, bukan Gemini TTS) -> harga naik
  // dari Rp49rb/video ke Rp80rb/video (COGS Rp37rb, margin lama terlalu tipis).
  { id: "super5", name: "5× AI Bersuara Pro", priceIdr: 400_000, videos: 5, tier: "super_hq" },
] as const;

export type PackageId = (typeof TOPUP_PACKAGES)[number]["id"];

/** Harga per tier skala linear dari basis 15 dtk — AI video-gen (BytePlus) dibayar
 * per detik shot, jadi video 30 dtk = 2x shot-detik = kira-kira 2x biaya (2026-08-03). */
export function tierPriceIdr(tier: QualityTier, durationSec = 15): number {
  const base = config.tiers[tier]?.priceIdr ?? config.tiers.silent_caption.priceIdr;
  return Math.round(base * (durationSec / 15));
}

// CreditOwner (F-ENT-01, 2026-08-11): siapa yang dompetnya dipakai. Retail
// tetap string userId polos -> saldo = SUM(delta) WHERE user_id=? AND
// org_id IS NULL (baris retail lama TIDAK PERNAH punya org_id, jadi filter
// ini transparan buat mereka). {orgId} = saldo bersama org, delta ditagih
// ke wallet org tapi user_id TETAP diisi (acting member, jejak audit siapa
// yang belanja) — lihat migrations/postgres/0013_org_id_columns.sql.
//
// Bug nyata yang ditemukan & diperbaiki sekalian (2026-08-11): SEBELUM fix
// ini, getBalance/getLedger tanpa filter org_id IS NULL berarti user yang
// juga jadi owner org (co. Brian setelah admin-provision-org.mjs) akan
// melihat saldo retail-nya KETAMBAHAN saldo org — credit_ledger.user_id
// org selalu diisi = user_id owner (lihat admin-grant-org-credit.mjs),
// jadi WHERE user_id=? polos ikut menjumlahkan baris org itu.
export type CreditOwner = { userId: string; orgId?: string };
function resolveOwner(owner: string | CreditOwner): CreditOwner {
  return typeof owner === "string" ? { userId: owner } : owner;
}

export function getBalance(owner: string | CreditOwner): number {
  const { userId, orgId } = resolveOwner(owner);
  const row = orgId
    ? (getDb().prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE org_id = ?").get(orgId) as { balance: number })
    : (getDb().prepare("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = ? AND org_id IS NULL").get(userId) as { balance: number });
  return row.balance; // rupiah
}

function ledger(owner: string | CreditOwner, delta: number, type: string, jobId: string | null, paymentId: string | null) {
  const { userId, orgId } = resolveOwner(owner);
  getDb()
    .prepare(
      "INSERT INTO credit_ledger (id, user_id, org_id, delta, type, job_id, payment_id, created_at) VALUES (?,?,?,?,?,?,?,?)"
    )
    .run(uuid(), userId, orgId ?? null, delta, type, jobId, paymentId, now());
}

/** Hold sebesar harga tier saat job dibuat. Return false bila saldo kurang. */
export function holdCredits(owner: string | CreditOwner, jobId: string, amountIdr: number): boolean {
  if (getBalance(owner) < amountIdr) return false;
  ledger(owner, -amountIdr, "hold", jobId, null);
  audit(resolveOwner(owner).userId, "credit.hold", "jobs", jobId, { amount_idr: amountIdr });
  return true;
}

/** Capture saat QC lulus: hold menjadi final (delta 0 — saldo tetap terpotong oleh hold). Idempoten. */
export function captureCredits(owner: string | CreditOwner, jobId: string): void {
  const db = getDb();
  const existing = db
    .prepare("SELECT id FROM credit_ledger WHERE job_id = ? AND type = 'capture'")
    .get(jobId);
  if (existing) return;
  ledger(owner, 0, "capture", jobId, null);
  audit(resolveOwner(owner).userId, "credit.capture", "jobs", jobId, {});
}

/**
 * Release/refund saat job gagal: kembalikan seluruh hold yang belum di-capture.
 * Idempoten, dan MENOLAK job yang sudah READY.
 *
 * Penolakan itu bukan kehati-hatian berlebihan. Worker menandai job READY dulu,
 * baru capture; di celah antara keduanya ledger cuma punya 'hold', sehingga
 * pemanggil release mana pun akan melihat "belum terminal" dan merefund video
 * yang sudah diserahkan. Padanan PostgreSQL-nya ada di
 * PgCreditPaymentRepository.sudahDiserahkan.
 */
export function releaseCredits(owner: string | CreditOwner, jobId: string): number {
  const db = getDb();
  const diserahkan = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state?: string } | undefined;
  if (diserahkan?.state === "READY") return 0;
  const already = db
    .prepare("SELECT id FROM credit_ledger WHERE job_id = ? AND type IN ('capture','release')")
    .get(jobId);
  if (already) return 0;
  const held = db
    .prepare("SELECT COALESCE(-SUM(delta), 0) AS held FROM credit_ledger WHERE job_id = ? AND type = 'hold'")
    .get(jobId) as { held: number };
  if (held.held <= 0) return 0;
  ledger(owner, held.held, "release", jobId, null);
  audit(resolveOwner(owner).userId, "credit.release", "jobs", jobId, { amount_idr: held.held });
  return held.held;
}

export function getLedger(owner: string | CreditOwner, limit = 50) {
  const { userId, orgId } = resolveOwner(owner);
  return orgId
    ? getDb().prepare("SELECT * FROM credit_ledger WHERE org_id = ? ORDER BY created_at DESC, rowid DESC LIMIT ?").all(orgId, limit)
    : getDb().prepare("SELECT * FROM credit_ledger WHERE user_id = ? AND org_id IS NULL ORDER BY created_at DESC, rowid DESC LIMIT ?").all(userId, limit);
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

// --- Harga layanan tambahan dalam TOKEN (1 token = Rp1, lihat lib/tokens.ts) ---
// Ditaruh di sini, bukan di lib/tokens.ts, karena butuh tierPriceIdr dan
// lib/tokens.ts harus tetap bebas impor agar aman dipakai komponen klien.

import { idrToTokens } from "./tokens";

/** Biaya membuat ulang SATU scene.
 *
 * Dihitung dari durasi scene itu, bukan durasi video utuh: provider menagih
 * kami per detik video (estimateCost di lib/providers/stubs/byteplus.ts
 * menjumlahkan durasi shot), jadi mengganti satu shot 5 detik pada TVC 30
 * detik memang sepertiga biaya video 15 detik — bukan biaya penuh. Menagih
 * penuh akan menghukum brand karena struktur teknis yang tidak mereka pilih.
 */
export function regenerateSceneTokens(tier: QualityTier, sceneDurationSec: number): number {
  return idrToTokens(tierPriceIdr(tier, Math.max(1, Math.round(sceneDurationSec))));
}

/** Selisih token bila brand menaikkan tier ("upgrade model generator" dari
 * masukan tester). Tidak pernah negatif — menurunkan tier tidak mengembalikan
 * token, karena keputusan itu diambil SEBELUM render dimulai. */
export function tierUpgradeTokens(from: QualityTier, to: QualityTier, durationSec: number): number {
  return Math.max(0, idrToTokens(tierPriceIdr(to, durationSec) - tierPriceIdr(from, durationSec)));
}
