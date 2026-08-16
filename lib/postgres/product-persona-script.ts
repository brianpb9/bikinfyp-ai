/**
 * PostgreSQL parity adapter for checkpoint 1C: products, personas, and
 * scripts. It is intentionally not imported by routes yet; SQLite remains
 * the runtime source of truth until the whole migration has passed.
 */
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import type { PersonaRow, ProductRow, ScriptRow } from "../db";
import { getPool } from "./pool";

export interface PgProductInput {
  sourceUrl?: string | null;
  name: string;
  priceIdr: number;
  category: string;
  productVisualDesc?: string | null;
  images: string[];
  rawMeta?: unknown | null;
  /** Add-on Promo & Urgency (lib/promo.ts) — opsional semua. */
  promoPriceBeforeIdr?: number | null;
  promoEndsAt?: string | null;
  promoStockLeft?: number | null;
  /** Non-NULL = dibuat lewat dashboard enterprise/brand (F-ENT-01). */
  orgId?: string | null;
  /** M8: arahan kreatif bebas dari brand (beda dari productVisualDesc). */
  brandBrief?: string | null;
}

export interface PgScriptInput {
  hookFamily: string;
  emotion: string;
  register: string;
  segments: unknown;
  caption: string;
  hashtags: unknown;
  validationResult: unknown;
  qualityTier: "silent_caption" | "high_quality" | "super_hq";
  hookLevel?: import("../config/hooks").HookLevel;
}

export class PgProductPersonaScriptRepository {
  private readonly pool: Pool;
  private readonly now: () => string;
  private readonly uuid: () => string;

  constructor(databaseUrl: string, options: { now?: () => string; uuid?: () => string } = {}) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) {
      throw new Error("PgProductPersonaScriptRepository membutuhkan DATABASE_URL PostgreSQL.");
    }
    this.pool = getPool(databaseUrl);
    this.now = options.now ?? (() => new Date().toISOString());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  async close(): Promise<void> { /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */ }

  async createProduct(userId: string, input: PgProductInput): Promise<ProductRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const product = await this.insertProduct(client, userId, input);
      await this.insertAudit(client, userId, "product.created", "products", product.id, { name: product.name, category: product.category });
      await client.query("COMMIT");
      return product;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  /** Mirrors /api/products/extract's persisted product and completion audit. */
  async createExtractedProduct(userId: string, input: PgProductInput): Promise<ProductRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const product = await this.insertProduct(client, userId, input);
      await this.insertAudit(client, userId, "product.extracted", "products", product.id, { reason: "ok", price: input.priceIdr });
      await client.query("COMMIT");
      return product;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async getOwnedProduct(userId: string, productId: string): Promise<ProductRow | null> {
    const found = await this.pool.query<ProductRow>("SELECT * FROM products WHERE id = $1 AND user_id = $2", [productId, userId]);
    return found.rows[0] ?? null;
  }

  /**
   * Produk milik ORGANISASI, bukan milik anggota yang kebetulan membuatnya.
   *
   * Kepemilikan per-user benar untuk retail dan SALAH untuk dashboard brand:
   * produk dibuat satu orang, dibayar dari dompet organisasi, dan dipakai
   * seluruh tim. Dengan getOwnedProduct, rekan satu tim melihat produk itu di
   * daftar (daftarnya memang di-query per org) lalu mendapat "tidak ditemukan"
   * saat menekan render — kegagalan yang terlihat seperti bug data padahal
   * murni soal siapa yang dianggap pemilik.
   */
  async getOrgProduct(orgId: string, productId: string): Promise<ProductRow | null> {
    const found = await this.pool.query<ProductRow>("SELECT * FROM products WHERE id = $1 AND org_id = $2", [productId, orgId]);
    return found.rows[0] ?? null;
  }

  async updateOwnedProduct(
    userId: string,
    productId: string,
    patch: Pick<PgProductInput, "name" | "priceIdr" | "category" | "productVisualDesc" | "promoPriceBeforeIdr" | "promoEndsAt" | "promoStockLeft">
  ): Promise<ProductRow | null> {
    const result = await this.pool.query<ProductRow>(
      `UPDATE products SET name = $1, price_idr = $2, category = $3, product_visual_desc = $4,
         promo_price_before_idr = $5, promo_ends_at = $6, promo_stock_left = $7
       WHERE id = $8 AND user_id = $9 RETURNING *`,
      [patch.name, patch.priceIdr, patch.category, patch.productVisualDesc ?? null,
       patch.promoPriceBeforeIdr ?? null, patch.promoEndsAt ?? null, patch.promoStockLeft ?? null, productId, userId]
    );
    const product = result.rows[0] ?? null;
    if (product) await this.appendAudit(userId, "product.updated", "products", productId, { name: product.name, price_idr: product.price_idr });
    return product;
  }

  /** Serializes only a single (user, category) lookup/create race. */
  async findOrCreatePersona(userId: string, category: { id: string; name: string }, voiceId = "mock-damayanti", register = "bestie"): Promise<PersonaRow> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`persona:${userId}:${category.id}`]);
      const existing = await client.query<PersonaRow>(
        "SELECT * FROM personas WHERE user_id = $1 AND creator_category = $2 ORDER BY created_at ASC, id ASC LIMIT 1",
        [userId, category.id]
      );
      if (existing.rows[0]) {
        await client.query("COMMIT");
        return existing.rows[0];
      }
      const persona: PersonaRow = {
        id: this.uuid(), user_id: userId, name: `Kreator ${category.name}`, creator_category: category.id,
        voice_id: voiceId, register, created_at: this.now(),
      };
      await client.query(
        "INSERT INTO personas (id, user_id, name, creator_category, voice_id, register, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
        [persona.id, persona.user_id, persona.name, persona.creator_category, persona.voice_id, persona.register, persona.created_at]
      );
      await this.insertAudit(client, userId, "persona.created", "personas", persona.id, { creator_category: category.id });
      await client.query("COMMIT");
      return persona;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  async getOwnedPersona(userId: string, personaId: string): Promise<PersonaRow | null> {
    const result = await this.pool.query<PersonaRow>("SELECT * FROM personas WHERE id = $1 AND user_id = $2", [personaId, userId]);
    return result.rows[0] ?? null;
  }

  /** Persists the three generated variants atomically, with the route's audit trail. */
  /**
   * `orgId` opsional MELUASKAN kepemilikan, bukan menggantikannya: produk milik
   * organisasi boleh dipakai anggota mana pun. Tanpa ini, rekan satu tim yang
   * membuka produk buatan orang lain di dashboard akan ditolak dengan "Produk
   * tidak dimiliki user" — benar untuk retail, salah untuk dashboard brand di
   * mana produk dibuat satu orang dan dipakai seluruh tim.
   *
   * Jalur retail tidak mengirim orgId sama sekali, jadi perilakunya tidak
   * berubah sedikit pun.
   */
  async createScripts(userId: string, productId: string, variants: PgScriptInput[], orgId?: string): Promise<ScriptRow[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const product = orgId
        ? await client.query("SELECT id FROM products WHERE id = $1 AND (user_id = $2 OR org_id = $3)", [productId, userId, orgId])
        : await client.query("SELECT id FROM products WHERE id = $1 AND user_id = $2", [productId, userId]);
      if (!product.rowCount) throw new Error("Produk tidak dimiliki user.");
      const scripts: ScriptRow[] = [];
      for (const variant of variants) {
        const script: ScriptRow = {
          id: this.uuid(), job_id: null, product_id: productId, hook_family: variant.hookFamily, emotion: variant.emotion,
          register: variant.register, segments: JSON.stringify(variant.segments), caption: variant.caption,
          hashtags: JSON.stringify(variant.hashtags), validation_result: JSON.stringify(variant.validationResult),
          quality_tier: variant.qualityTier, hook_level: variant.hookLevel ?? "normal",
          approved_by_user_at: null, edited_by_user: 0, created_at: this.now(),
        };
        await client.query(
          `INSERT INTO scripts (id, job_id, product_id, hook_family, emotion, register, segments, caption, hashtags, validation_result, quality_tier, hook_level, approved_by_user_at, edited_by_user, created_at)
           VALUES ($1,NULL,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,NULL,0,$12)`,
          [script.id, script.product_id, script.hook_family, script.emotion, script.register, script.segments, script.caption, script.hashtags, script.validation_result, script.quality_tier, script.hook_level, script.created_at]
        );
        await this.insertAudit(client, userId, "script.generated", "scripts", script.id, { hook_family: script.hook_family, passed: Boolean((variant.validationResult as { passed?: boolean })?.passed) });
        scripts.push(script);
      }
      await client.query("COMMIT");
      return scripts;
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    } finally { client.release(); }
  }

  // `orgId` opsional meluaskan kepemilikan skrip dengan alasan yang sama
  // seperti createScripts: skrip menggantung pada produk, dan produk milik
  // organisasi dipakai seluruh tim. Jalur retail tidak mengirimnya.
  async getOwnedScript(userId: string, scriptId: string, orgId?: string): Promise<ScriptRow | null> {
    const result = orgId
      ? await this.pool.query<ScriptRow>(
          "SELECT s.* FROM scripts s JOIN products p ON p.id = s.product_id WHERE s.id = $1 AND (p.user_id = $2 OR p.org_id = $3)", [scriptId, userId, orgId]
        )
      : await this.pool.query<ScriptRow>(
          "SELECT s.* FROM scripts s JOIN products p ON p.id = s.product_id WHERE s.id = $1 AND p.user_id = $2", [scriptId, userId]
        );
    return result.rows[0] ?? null;
  }

  async approveOwnedScript(userId: string, scriptId: string, update: { segments: unknown; edited: boolean; validationResult: unknown }, orgId?: string): Promise<ScriptRow | null> {
    const approvedAt = this.now();
    const result = await this.pool.query<ScriptRow>(
      `UPDATE scripts SET segments = $1, edited_by_user = $2, approved_by_user_at = $3, validation_result = $4
       WHERE id = $5 AND product_id IN (SELECT id FROM products WHERE user_id = $6 OR ($7::text IS NOT NULL AND org_id = $7)) RETURNING *`,
      [JSON.stringify(update.segments), update.edited ? 1 : 0, approvedAt, JSON.stringify(update.validationResult), scriptId, userId, orgId ?? null]
    );
    const script = result.rows[0] ?? null;
    if (script) await this.appendAudit(userId, "script.approved", "scripts", script.id, { edited: update.edited });
    return script;
  }

  async appendAudit(actor: string, action: string, entity: string, entityId: string | null, meta?: unknown): Promise<void> {
    await this.pool.query("INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [this.uuid(), actor, action, entity, entityId, meta === undefined ? null : JSON.stringify(meta), this.now()]);
  }

  private async insertProduct(client: PoolClient, userId: string, input: PgProductInput): Promise<ProductRow> {
    const product: ProductRow = {
      id: this.uuid(), user_id: userId, org_id: input.orgId ?? null, source_url: input.sourceUrl ?? null, name: input.name, price_idr: input.priceIdr,
      category: input.category, product_visual_desc: input.productVisualDesc ?? null, brand_brief: input.brandBrief ?? null, images: JSON.stringify(input.images),
      promo_price_before_idr: input.promoPriceBeforeIdr ?? null, promo_ends_at: input.promoEndsAt ?? null,
      promo_stock_left: input.promoStockLeft ?? null,
      raw_meta: input.rawMeta === undefined || input.rawMeta === null ? null : JSON.stringify(input.rawMeta), created_at: this.now(),
    };
    await client.query(
      `INSERT INTO products (id, user_id, org_id, source_url, name, price_idr, category, product_visual_desc, brand_brief, images, promo_price_before_idr, promo_ends_at, promo_stock_left, raw_meta, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
      [product.id, product.user_id, product.org_id, product.source_url, product.name, product.price_idr, product.category, product.product_visual_desc, product.brand_brief, product.images, product.promo_price_before_idr, product.promo_ends_at, product.promo_stock_left, product.raw_meta, product.created_at]
    );
    return product;
  }

  private async insertAudit(client: PoolClient, actor: string, action: string, entity: string, entityId: string | null, meta: unknown): Promise<void> {
    await client.query("INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [this.uuid(), actor, action, entity, entityId, JSON.stringify(meta), this.now()]);
  }
}
