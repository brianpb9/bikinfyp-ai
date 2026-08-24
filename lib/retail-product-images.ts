import { getDb } from "./db";
import {
  pgAppendRetailProductImages,
  pgRemoveRetailProductImage,
  postgresRuntimeEnabled,
} from "./postgres/smoke-runtime";
import type { PoolClient } from "pg";

/**
 * Mutasi daftar foto retail harus menghitung hasil dari row terkini, bukan dari
 * snapshot yang dibaca route sebelum kerja storage/klasifikasi dimulai.
 */
export async function appendRetailProductImages(
  userId: string,
  productId: string,
  added: string[],
  maxImages: number
): Promise<string[] | null> {
  if (postgresRuntimeEnabled()) {
    return pgAppendRetailProductImages(userId, productId, added, maxImages);
  }

  return getDb().transaction(() => {
    const row = getDb().prepare(
      "SELECT images FROM products WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).get(productId, userId) as { images: string } | undefined;
    if (!row) return null;
    const current = JSON.parse(row.images || "[]") as string[];
    if (current.length + added.length > maxImages) return null;
    const images = [...current, ...added];
    getDb().prepare(
      "UPDATE products SET images = ? WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).run(JSON.stringify(images), productId, userId);
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
      "SELECT images FROM products WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).get(productId, userId) as { images: string } | undefined;
    if (!row) return null;
    const current = JSON.parse(row.images || "[]") as string[];
    if (!current.includes(target)) return null;
    const images = current.filter((image) => image !== target);
    getDb().prepare(
      "UPDATE products SET images = ? WHERE id = ? AND user_id = ? AND org_id IS NULL"
    ).run(JSON.stringify(images), productId, userId);
    return images;
  })();
}
