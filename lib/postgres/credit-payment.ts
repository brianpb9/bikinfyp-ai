/**
 * PostgreSQL parity adapter for checkpoint 1C: credit ledger and payments.
 * It is deliberately not imported by application routes; SQLite remains the
 * primary runtime until the full cutover is reviewed.
 */
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { TOPUP_PACKAGES, type CreditOwner } from "../credits";
import { getPool } from "./pool";

type Payment = { id: string; user_id: string; gateway: string; gateway_ref: string; amount_idr: number; credits: number; status: string; raw_payload: string | null; created_at: string };
function resolveOwner(owner: string | CreditOwner): CreditOwner {
  return typeof owner === "string" ? { userId: owner } : owner;
}

export class PgCreditPaymentRepository {
  private readonly pool: Pool;
  private readonly now: () => string;
  private readonly uuid: () => string;

  constructor(databaseUrl: string, options: { now?: () => string; uuid?: () => string } = {}) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("PgCreditPaymentRepository membutuhkan DATABASE_URL PostgreSQL.");
    this.pool = getPool(databaseUrl);
    this.now = options.now ?? (() => new Date().toISOString());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  async close(): Promise<void> { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }

  async getBalance(owner: string | CreditOwner): Promise<number> {
    const { userId, orgId } = resolveOwner(owner);
    const result = orgId
      ? await this.pool.query<{ balance: string }>("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE org_id = $1", [orgId])
      : await this.pool.query<{ balance: string }>("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = $1 AND org_id IS NULL", [userId]);
    return Number(result.rows[0].balance);
  }

  /** Creates the durable pending checkout record. Duplicate order references are harmless. */
  async createCheckout(input: { userId: string; gateway: string; gatewayRef: string; packageId: string; rawPayload?: unknown }): Promise<{ payment: Payment; duplicated: boolean }> {
    const pkg = this.package(input.packageId);
    return this.transaction(async (client) => {
      const created = await client.query<Payment>(
        `INSERT INTO payments (id,user_id,gateway,gateway_ref,amount_idr,credits,status,raw_payload,created_at)
         VALUES ($1,$2,$3,$4,$5,$5,'pending',$6,$7)
         ON CONFLICT (gateway_ref) DO NOTHING RETURNING *`,
        [this.uuid(), input.userId, input.gateway, input.gatewayRef, pkg.priceIdr, JSON.stringify({ package_id: input.packageId, ...(input.rawPayload as Record<string, unknown> ?? {}) }), this.now()]
      );
      if (created.rows[0]) {
        await this.audit(client, input.userId, "payment.checkout", "payments", input.gatewayRef, { package_id: input.packageId, amount_idr: pkg.priceIdr });
        return { payment: created.rows[0], duplicated: false };
      }
      const existing = await client.query<Payment>("SELECT * FROM payments WHERE gateway_ref = $1 FOR UPDATE", [input.gatewayRef]);
      if (!existing.rows[0]) throw new Error("Checkout conflict tidak dapat dibaca ulang.");
      return { payment: existing.rows[0], duplicated: true };
    });
  }

  /** Holds a balance once per job, serialized per wallet (org pool if present, else user) to prevent overspend. */
  async holdCredits(owner: string | CreditOwner, jobId: string, amountIdr: number): Promise<boolean> {
    const { userId, orgId } = resolveOwner(owner);
    return this.transaction(async (client) => {
      await this.lockWallet(client, userId, orgId);
      const previous = await client.query("SELECT id FROM credit_ledger WHERE job_id = $1 AND type = 'hold'", [jobId]);
      if (previous.rowCount) return true;
      const balance = await this.balanceForUpdate(client, userId, orgId);
      if (balance < amountIdr) return false;
      await this.ledger(client, userId, orgId, -amountIdr, "hold", jobId, null);
      await this.audit(client, userId, "credit.hold", "jobs", jobId, { amount_idr: amountIdr, org_id: orgId ?? undefined });
      return true;
    });
  }

  async captureCredits(owner: string | CreditOwner, jobId: string): Promise<boolean> {
    const { userId, orgId } = resolveOwner(owner);
    return this.transaction(async (client) => {
      await this.lockWallet(client, userId, orgId);
      const terminal = await client.query("SELECT id FROM credit_ledger WHERE job_id = $1 AND type IN ('capture','release')", [jobId]);
      if (terminal.rowCount) return false;
      const hold = await client.query("SELECT id FROM credit_ledger WHERE job_id = $1 AND type = 'hold'", [jobId]);
      if (!hold.rowCount) return false;
      await this.ledger(client, userId, orgId, 0, "capture", jobId, null);
      await this.audit(client, userId, "credit.capture", "jobs", jobId, {});
      return true;
    });
  }

  /**
   * Video yang SUDAH sampai ke pengguna tidak boleh direfund.
   *
   * Ledger saja tidak cukup untuk menjaga itu. Urutan di worker adalah
   * markReady lalu captureCredits, dan di antara keduanya job sudah READY
   * tapi ledger-nya masih cuma punya 'hold'. Kalau proses mati di celah itu —
   * atau kalau captureCredits sendiri yang gagal — penangkap galat di atasnya
   * memanggil releaseCredits, ledger tidak melihat catatan terminal apa pun,
   * dan videonya diberikan GRATIS. Jalur paling mungkin justru yang paling
   * berbahaya: blok catch di lib/promo/worker.ts membungkus captureCredits.
   *
   * Karena itu keadaan job diperiksa DI DALAM transaksi yang sama. Job yang
   * tidak ada barisnya (mis. skrip paritas) tetap boleh dilepas — yang
   * ditolak hanya job yang terbukti sudah READY.
   */
  private async sudahDiserahkan(client: PoolClient, jobId: string): Promise<boolean> {
    // FOR UPDATE, bukan SELECT biasa.
    //
    // Membaca state tanpa mengunci barisnya menyisakan balapan: refund membaca
    // "belum READY", worker menjadikannya READY, refund menulis release, lalu
    // capture menyerah karena melihat catatan terminal. Mengunci baris job
    // membuat worker menunggu sampai keputusan refund selesai.
    //
    // Ini lapis KEDUA. Lapis pertama ada di database (indeks unik terminal,
    // migrasi 0030) yang menolak capture+release berbarengan apa pun urutannya.
    const q = await client.query<{ state: string }>(
      "SELECT state FROM jobs WHERE id=$1 FOR UPDATE", [jobId]
    );
    const p = await client.query<{ state: string }>(
      "SELECT state FROM promo_jobs WHERE id=$1 FOR UPDATE", [jobId]
    );
    return [...q.rows, ...p.rows].some((r) => r.state === "READY");
  }

  async releaseCredits(owner: string | CreditOwner, jobId: string): Promise<number> {
    const { userId, orgId } = resolveOwner(owner);
    return this.transaction(async (client) => {
      await this.lockWallet(client, userId, orgId);
      if (await this.sudahDiserahkan(client, jobId)) return 0;
      const terminal = await client.query("SELECT id FROM credit_ledger WHERE job_id = $1 AND type IN ('capture','release')", [jobId]);
      if (terminal.rowCount) return 0;
      const held = await client.query<{ held: string }>("SELECT COALESCE(-SUM(delta), 0) AS held FROM credit_ledger WHERE job_id = $1 AND type = 'hold'", [jobId]);
      const amount = Number(held.rows[0].held);
      if (amount <= 0) return 0;
      await this.ledger(client, userId, orgId, amount, "release", jobId, null);
      await this.audit(client, userId, "credit.release", "jobs", jobId, { amount_idr: amount });
      return amount;
    });
  }

  /** Applies a verified webhook. gateway_ref's unique index + row lock make repeats safe. */
  async creditTopup(input: { userId: string; packageId: string; gateway: string; gatewayRef: string; rawPayload?: unknown }): Promise<{ duplicated: boolean; amountIdr: number }> {
    const pkg = this.package(input.packageId);
    return this.transaction(async (client) => {
      // Insert first makes a simultaneous new webhook contend on the database constraint.
      const inserted = await client.query<Payment>(
        `INSERT INTO payments (id,user_id,gateway,gateway_ref,amount_idr,credits,status,raw_payload,created_at)
         VALUES ($1,$2,$3,$4,$5,$5,'paid',$6,$7)
         ON CONFLICT (gateway_ref) DO NOTHING RETURNING *`,
        [this.uuid(), input.userId, input.gateway, input.gatewayRef, pkg.priceIdr, input.rawPayload === undefined ? null : JSON.stringify(input.rawPayload), this.now()]
      );
      let payment = inserted.rows[0];
      if (!payment) {
        const existing = await client.query<Payment>("SELECT * FROM payments WHERE gateway_ref = $1 FOR UPDATE", [input.gatewayRef]);
        payment = existing.rows[0];
        if (!payment) throw new Error("Webhook conflict tidak dapat dibaca ulang.");
        if (payment.status === "paid") return { duplicated: true, amountIdr: pkg.priceIdr };
        const oldPayload = this.parsePayload(payment.raw_payload);
        const merged = { ...oldPayload, ...(input.rawPayload as Record<string, unknown> ?? {}) };
        const updated = await client.query<Payment>("UPDATE payments SET status = 'paid', raw_payload = $1 WHERE id = $2 RETURNING *", [JSON.stringify(merged), payment.id]);
        payment = updated.rows[0];
      }
      await this.ledger(client, input.userId, null, pkg.priceIdr, "topup", null, payment.id);
      await this.audit(client, input.userId, "credit.topup", "payments", payment.id, { package_id: input.packageId, amount_idr: pkg.priceIdr, gateway: input.gateway });
      return { duplicated: false, amountIdr: pkg.priceIdr };
    });
  }

  async markPaymentFailed(gateway: string, gatewayRef: string, rawPayload?: unknown): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query<Payment>("SELECT * FROM payments WHERE gateway = $1 AND gateway_ref = $2 FOR UPDATE", [gateway, gatewayRef]);
      const payment = result.rows[0];
      if (!payment || payment.status === "paid") return false;
      await client.query("UPDATE payments SET status = 'failed', raw_payload = $1 WHERE id = $2", [rawPayload === undefined ? payment.raw_payload : JSON.stringify(rawPayload), payment.id]);
      await this.audit(client, payment.user_id, "webhook.failed", "payments", gatewayRef, {});
      return true;
    });
  }

  /** Records a Snap initiation failure without deleting the durable pending order. */
  async markPaymentInitiationFailed(gateway: string, gatewayRef: string, rawPayload: unknown): Promise<boolean> {
    return this.transaction(async (client) => {
      const result = await client.query<Payment>("SELECT * FROM payments WHERE gateway = $1 AND gateway_ref = $2 FOR UPDATE", [gateway, gatewayRef]);
      const payment = result.rows[0];
      if (!payment || payment.status === "paid") return false;
      const oldPayload = this.parsePayload(payment.raw_payload);
      const merged = { ...oldPayload, provider_initiation: rawPayload };
      await client.query("UPDATE payments SET status = 'failed', raw_payload = $1 WHERE id = $2", [JSON.stringify(merged), payment.id]);
      await this.audit(client, payment.user_id, "payment.initiation_failed", "payments", gatewayRef, {});
      return true;
    });
  }

  private package(id: string) { const pkg = TOPUP_PACKAGES.find((candidate) => candidate.id === id); if (!pkg) throw new Error(`Paket tidak dikenal: ${id}`); return pkg; }
  private parsePayload(value: string | null): Record<string, unknown> { try { return JSON.parse(value ?? "{}") as Record<string, unknown>; } catch { return {}; } }
  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    // SERIALIZABLE correctly rejects a losing concurrent transaction. Retrying
    // that transient conflict is required for an idempotent webhook/hold API.
    for (let attempt = 0; attempt < 3; attempt++) {
      const client = await this.pool.connect();
      try { await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE"); const value = await fn(client); await client.query("COMMIT"); return value; }
      catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        if ((code === "40001" || code === "40P01") && attempt < 2) continue;
        throw error;
      } finally { client.release(); }
    }
    throw new Error("Transaksi PostgreSQL habis retry.");
  }
  /** Serializes wallet spends: an org pool locks its organizations row (shared by every acting member), retail locks the user row. */
  private async lockWallet(client: PoolClient, userId: string, orgId: string | undefined | null) {
    if (orgId) await client.query("SELECT id FROM organizations WHERE id = $1 FOR UPDATE", [orgId]);
    else await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
  }
  private async balanceForUpdate(client: PoolClient, userId: string, orgId: string | undefined | null): Promise<number> {
    const row = orgId
      ? await client.query<{ balance: string }>("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE org_id = $1", [orgId])
      : await client.query<{ balance: string }>("SELECT COALESCE(SUM(delta), 0) AS balance FROM credit_ledger WHERE user_id = $1 AND org_id IS NULL", [userId]);
    return Number(row.rows[0].balance);
  }
  private async ledger(client: PoolClient, userId: string, orgId: string | undefined | null, delta: number, type: string, jobId: string | null, paymentId: string | null) { await client.query("INSERT INTO credit_ledger (id,user_id,org_id,delta,type,job_id,payment_id,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)", [this.uuid(), userId, orgId ?? null, delta, type, jobId, paymentId, this.now()]); }
  private async audit(client: PoolClient, actor: string, action: string, entity: string, entityId: string | null, meta: unknown) { await client.query("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)", [this.uuid(), actor, action, entity, entityId, JSON.stringify(meta), this.now()]); }
}
