import Database from "better-sqlite3";
import fs from "node:fs";
import path from "node:path";
import { config, ensureDirs } from "./config";
import { assertLegacySqliteRuntimeAllowed } from "./database-config";

// Singleton lintas hot-reload Next dev (modul route bisa dimuat ulang).
const g = globalThis as unknown as { __racunDb?: Database.Database };

export function getDb(): Database.Database {
  // Fail closed in production: this checkpoint has not installed the pg
  // adapter yet, so SQLite must never be used as an ephemeral-disk fallback.
  assertLegacySqliteRuntimeAllowed();
  if (!g.__racunDb) {
    ensureDirs();
    const db = new Database(config.dbPath);
    db.pragma("journal_mode = WAL");
    db.pragma("foreign_keys = ON");
    // Pra-skema: otp_codes lama (kolom phone, kode bersifat sementara) harus di-drop
    // SEBELUM exec schema — kalau tidak, CREATE INDEX idx_otp_email gagal ("no such column").
    const otpTableSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='otp_codes'").get() as { sql: string } | undefined)?.sql ?? "";
    if (otpTableSql.includes("phone") && !otpTableSql.includes("email TEXT")) {
      db.exec("DROP TABLE IF EXISTS otp_codes");
    }
    // Pra-skema: org_id (F-ENT-01) harus ada SEBELUM exec schema — schema.sql
    // bikin index di kolom org_id lewat CREATE INDEX IF NOT EXISTS, yang gagal
    // ("no such column") kalau tabel lama (credit_ledger/products/jobs) sudah
    // ada tapi belum punya kolom itu (CREATE TABLE IF NOT EXISTS melewatinya).
    for (const [table, addCols] of [
      ["credit_ledger", ["org_id TEXT REFERENCES organizations(id)"]],
      ["products", ["org_id TEXT REFERENCES organizations(id)"]],
      ["jobs", ["org_id TEXT REFERENCES organizations(id)", "bulk_run_id TEXT", "avatar_custom_desc TEXT"]],
    ] as const) {
      const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(table);
      if (!exists) continue;
      const existingCols = (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
      for (const colDef of addCols) {
        const colName = colDef.split(" ")[0];
        if (!existingCols.includes(colName)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${colDef}`);
      }
    }
    const schema = fs.readFileSync(path.join(process.cwd(), "lib", "schema.sql"), "utf8");
    db.exec(schema);
    // Migrasi ringan untuk DB lama: profil bisnis org (M7, F-ENT-01).
    const orgCols = (db.prepare("PRAGMA table_info(organizations)").all() as { name: string }[]).map((c) => c.name);
    for (const col of ["website_url", "business_type", "category", "audience", "elevator_pitch"]) {
      if (!orgCols.includes(col)) db.exec(`ALTER TABLE organizations ADD COLUMN ${col} TEXT`);
    }
    // Migrasi ringan untuk DB lama: kolom state_changed_at di jobs.
    const cols = (db.prepare("PRAGMA table_info(jobs)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("state_changed_at")) {
      db.exec("ALTER TABLE jobs ADD COLUMN state_changed_at TEXT");
      db.exec("UPDATE jobs SET state_changed_at = created_at WHERE state_changed_at IS NULL");
    }
    if (!cols.includes("quality_tier")) {
      db.exec("ALTER TABLE jobs ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'silent_caption'");
    }
    const scriptCols = (db.prepare("PRAGMA table_info(scripts)").all() as { name: string }[]).map((c) => c.name);
    if (!scriptCols.includes("quality_tier")) {
      db.exec("ALTER TABLE scripts ADD COLUMN quality_tier TEXT NOT NULL DEFAULT 'silent_caption'");
    }
    if (!scriptCols.includes("hook_level")) {
      db.exec("ALTER TABLE scripts ADD COLUMN hook_level TEXT NOT NULL DEFAULT 'normal'");
    }
    const prodCols = (db.prepare("PRAGMA table_info(products)").all() as { name: string }[]).map((c) => c.name);
    if (!prodCols.includes("product_visual_desc")) {
      db.exec("ALTER TABLE products ADD COLUMN product_visual_desc TEXT");
    }
    if (!prodCols.includes("brand_brief")) {
      db.exec("ALTER TABLE products ADD COLUMN brand_brief TEXT");
    }
    if (!prodCols.includes("promo_price_before_idr")) {
      db.exec("ALTER TABLE products ADD COLUMN promo_price_before_idr INTEGER");
      db.exec("ALTER TABLE products ADD COLUMN promo_ends_at TEXT");
      db.exec("ALTER TABLE products ADD COLUMN promo_stock_left INTEGER");
    }
    // Migrasi users -> email sebagai identifier (phone jadi nullable). Aman re-run:
    // hanya jalan bila skema lama terdeteksi (phone NOT NULL). FK dimatikan sesaat
    // selama rebuild (jobs/products/personas mereferensikan users).
    const usersSql = (db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='users'").get() as { sql: string } | undefined)?.sql ?? "";
    if (usersSql.includes("phone TEXT UNIQUE NOT NULL")) {
      db.exec(`
        PRAGMA foreign_keys = OFF;
        BEGIN;
        CREATE TABLE IF NOT EXISTS users_new (
          id TEXT PRIMARY KEY,
          phone TEXT,
          email TEXT UNIQUE,
          name TEXT,
          tier TEXT NOT NULL DEFAULT 'free',
          locale TEXT NOT NULL DEFAULT 'id-ID',
          created_at TEXT NOT NULL
        );
        DELETE FROM users_new;
        INSERT INTO users_new (id, phone, email, name, tier, locale, created_at)
          SELECT id, phone, email, name, tier, locale, created_at FROM users;
        DROP TABLE users;
        ALTER TABLE users_new RENAME TO users;
        COMMIT;
        PRAGMA foreign_keys = ON;
      `);
    }
    // otp_codes: kolom phone -> email (kode bersifat sementara — aman di-recreate)
    const otpCols = (db.prepare("PRAGMA table_info(otp_codes)").all() as { name: string }[]).map((c) => c.name);
    if (otpCols.includes("phone") && !otpCols.includes("email")) {
      db.exec("DROP TABLE otp_codes");
      db.exec(`
        CREATE TABLE otp_codes (
          id TEXT PRIMARY KEY,
          email TEXT NOT NULL,
          code_hash TEXT NOT NULL,
          expires_at TEXT NOT NULL,
          attempts INTEGER NOT NULL DEFAULT 0,
          created_at TEXT NOT NULL
        );
        CREATE INDEX idx_otp_email ON otp_codes(email, created_at);
      `);
    }
    g.__racunDb = db;
  }
  return g.__racunDb;
}

export const now = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();

export function audit(actor: string, action: string, entity: string, entityId: string | null, meta?: unknown) {
  getDb()
    .prepare(
      "INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES (?,?,?,?,?,?,?)"
    )
    .run(uuid(), actor, action, entity, entityId, meta ? JSON.stringify(meta) : null, now());
}

// --- Row types ---
export interface UserRow { id: string; phone: string | null; email: string | null; name: string | null; tier: string; locale: string; created_at: string }
export interface ProductRow { id: string; user_id: string; org_id?: string | null; source_url: string | null; name: string; price_idr: number; category: string; product_visual_desc?: string | null; brand_brief?: string | null; images: string; promo_price_before_idr?: number | null; promo_ends_at?: string | null; promo_stock_left?: number | null; raw_meta: string | null; created_at: string }
export interface PersonaRow { id: string; user_id: string; name: string; creator_category: string; voice_id: string; register: string; created_at: string }
export interface ScriptRow { id: string; job_id: string | null; product_id: string; hook_family: string; emotion: string; register: string; segments: string; caption: string; hashtags: string; validation_result: string; quality_tier: string; hook_level?: string; approved_by_user_at: string | null; edited_by_user: number; created_at: string }
export interface JobRow { id: string; user_id: string; org_id: string | null; bulk_run_id: string | null; avatar_custom_desc?: string | null; product_id: string; persona_id: string | null; script_id: string; format: string; quality_tier: string; duration_s: number; state: string; provider_video: string | null; provider_voice: string | null; cost_actual_idr: number; qc_result: string | null; output_url: string | null; qc_retry_count: number; created_at: string; completed_at: string | null; state_changed_at?: string | null }
