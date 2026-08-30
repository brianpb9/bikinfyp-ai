import { getDb } from "./db";
import {
  pgAppendRetailProductImages,
  pgRemoveRetailProductImage,
  postgresRuntimeEnabled,
} from "./postgres/smoke-runtime";
import type { PoolClient } from "pg";
import crypto from "node:crypto";
import { removeStagingReferenceRightsBindingFromRawMeta, stagingReferenceRightsBindingFromRawMeta, type StagingReferenceRightsBinding } from "./staging-reference-rights";

/**
 * Mutasi daftar foto retail harus menghitung hasil dari row terkini, bukan dari
 * snapshot yang dibaca route sebelum kerja storage/klasifikasi dimulai.
 */
export async function appendRetailProductImages(
  userId: string,
  productId: string,
  added: string[],
  maxImages: number,
  rightsBinding?: StagingReferenceRightsBinding,
): Promise<string[] | null> {
  if (postgresRuntimeEnabled()) {
    return pgAppendRetailProductImages(userId, productId, added, maxImages, rightsBinding);
  }

  return getDb().transaction(() => {
    const row = getDb().prepare(
      "SELECT images,raw_meta FROM products WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).get(productId, userId) as { images: string; raw_meta: string | null } | undefined;
    if (!row) return null;
    const current = JSON.parse(row.images || "[]") as string[];
    if (current.length + added.length > maxImages) return null;
    if (stagingReferenceRightsBindingFromRawMeta(row.raw_meta) || (rightsBinding && current.length !== 0)) return null;
    const images = [...current, ...added];
    let rawMeta:Record<string,unknown>={};
    try { rawMeta=row.raw_meta ? JSON.parse(row.raw_meta) as Record<string,unknown> : {}; }
    catch { throw new Error("PRODUCT_RAW_META_INVALID"); }
    if (!rawMeta || typeof rawMeta !== "object" || Array.isArray(rawMeta)) throw new Error("PRODUCT_RAW_META_INVALID");
    if (rightsBinding) rawMeta.staging_reference_rights=rightsBinding;
    getDb().prepare(
      "UPDATE products SET images = ?, raw_meta = ? WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).run(JSON.stringify(images), Object.keys(rawMeta).length ? JSON.stringify(rawMeta) : null, productId, userId);
    if (rightsBinding) getDb().prepare(
      `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(crypto.randomUUID(),userId,"product.staging_reference_rights_ingested","products",productId,JSON.stringify(rightsBinding),new Date().toISOString());
    return images;
  })();
}

/** Atomic removal: append yang paralel tetap hidup dan delete ulang gagal. */
export async function removeRetailProductImage(
  userId: string,
  productId: string,
  target: string,
  client?: PoolClient,
): Promise<string[] | null> {
  if (postgresRuntimeEnabled()) {
    return pgRemoveRetailProductImage(userId, productId, target, client);
  }

  return getDb().transaction(() => {
    const row = getDb().prepare(
      "SELECT images,raw_meta FROM products WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).get(productId, userId) as { images: string; raw_meta: string | null } | undefined;
    if (!row) return null;
    const current = JSON.parse(row.images || "[]") as string[];
    if (!current.includes(target)) return null;
    const images = current.filter((image) => image !== target);
    const rights = removeStagingReferenceRightsBindingFromRawMeta(row.raw_meta, target);
    getDb().prepare(
      "UPDATE products SET images = ?, raw_meta = ? WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).run(JSON.stringify(images), rights.rawMeta, productId, userId);
    if (rights.removed) getDb().prepare(
      `INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)`
    ).run(crypto.randomUUID(),userId,"product.staging_reference_rights_removed","products",productId,JSON.stringify({reference_key:target}),new Date().toISOString());
    return images;
  })();
}
