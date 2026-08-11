import path from "node:path";
import { config } from "../config";
import { getPool } from "./pool";
import { mediaStorage } from "../storage";

// Brand kit organisasi untuk endcard. Logo disimpan di storage durable
// (bukan disk worker, yang hilang tiap deploy), jadi harus ditarik dulu ke
// workDir sebelum ffmpeg bisa memakainya.

export interface BrandKit {
  logoPath: string | null;
  color: string | null;
  tagline: string | null;
}

export async function loadBrandKit(orgId: string): Promise<BrandKit | null> {
  const res = await getPool(config.databaseUrl).query<{
    brand_logo_key: string | null; brand_color: string | null; brand_tagline: string | null;
  }>("SELECT brand_logo_key, brand_color, brand_tagline FROM organizations WHERE id=$1", [orgId]);
  const row = res.rows[0];
  if (!row) return null;

  let logoPath: string | null = null;
  if (row.brand_logo_key) {
    try {
      logoPath = await mediaStorage().materialize(row.brand_logo_key);
    } catch (err) {
      // Logo gagal ditarik bukan alasan menggagalkan render. Endcard tetap
      // dibuat dengan tagline saja.
      console.warn(`[brand-kit] logo ${row.brand_logo_key} gagal ditarik: ${(err as Error).message}`);
    }
  }
  return { logoPath, color: row.brand_color, tagline: row.brand_tagline };
}

/** Kunci storage untuk logo sebuah org — dipisah supaya jalur unggah dan
 * jalur baca tidak pernah menebak nama yang berbeda. */
export function brandLogoKey(orgId: string, ext: string): string {
  return path.posix.join("brand", orgId, `logo${ext.startsWith(".") ? ext : "." + ext}`);
}
