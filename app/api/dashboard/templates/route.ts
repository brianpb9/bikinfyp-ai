import crypto from "node:crypto";
import { Pool } from "pg";
import { ERR, errorResponse } from "@/lib/errors";
import { config } from "@/lib/config";
import { requireOrgContextApi } from "@/lib/dashboard-auth";
import { postgresRuntimeEnabled, pgAudit } from "@/lib/postgres/smoke-runtime";
import { getPool } from "@/lib/postgres/pool";
import { HOOK_LEVELS } from "@/lib/config/hooks";
import { assertDashboardRate } from "@/lib/dashboard-rate-limit";
import { getAvatarPreset } from "@/lib/avatar-presets";

import { durasiDidukung } from "@/lib/durasi";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Template milik brand. Lihat migrations/postgres/0020_org_templates.sql untuk
// alasan ia terpisah dari template bawaan di lib/templates.ts.

const KINDS = new Set(["affiliate", "ads", "tvc"]);
const FORMATS = new Set(["hands_only", "talking_head", "tvc", "ads"]);
const TIERS = new Set(["high_quality", "super_hq"]);
const LEVELS = new Set(HOOK_LEVELS as string[]);
const MAX_PER_ORG = 30;

type Row = {
  id: string; name: string; note: string | null; kind: string; format: string;
  duration_sec: number; quality_tier: string; hook_level: string;
  hook_family: string | null; variant_count: number;
  creator_category: string | null; avatar_gender: string | null; created_at: string;
};

export async function GET(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) return Response.json({ templates: [] });
    const { membership } = await requireOrgContextApi(req);
    const pool = getPool(config.databaseUrl);
    try {
      const rows = (await pool.query<Row>(
        `SELECT id, name, note, kind, format, duration_sec, quality_tier, hook_level,
                hook_family, variant_count, creator_category, avatar_gender, created_at
         FROM org_templates WHERE org_id=$1 ORDER BY created_at DESC`,
        [membership.org_id]
      )).rows;
      return Response.json({ templates: rows });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function POST(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { user, membership } = await requireOrgContextApi(req);
    await assertDashboardRate("template", membership.org_id);
    const body = await req.json().catch(() => ({}));

    const name = String(body.name ?? "").trim().slice(0, 60);
    if (!name) throw ERR.BAD_REQUEST("Kasih nama templatenya dulu.", "name is required.");
    const kind = String(body.kind ?? "");
    const format = String(body.format ?? "");
    const tier = String(body.quality_tier ?? "");
    const level = String(body.hook_level ?? "");
    const durationSec = Number(body.duration_sec);
    const count = Number(body.variant_count);
    if (!KINDS.has(kind) || !FORMATS.has(format) || !TIERS.has(tier) || !LEVELS.has(level)) {
      throw ERR.BAD_REQUEST("Pengaturan templatenya tidak dikenal.", "Unknown template settings.");
    }
    if (!durasiDidukung(durationSec)) throw ERR.BAD_REQUEST("Durasi tidak didukung.", "Unsupported duration.");
    if (!Number.isInteger(count) || count < 2 || count > 6) throw ERR.BAD_REQUEST("Jumlah variasi harus 2-6.", "variant_count out of range.");
    const hookFamily = /^H([1-9]|1[0-6])$/.test(String(body.hook_family ?? "")) ? String(body.hook_family) : null;
    const avatar = getAvatarPreset(String(body.creator_category ?? ""));
    if (!avatar) throw ERR.BAD_REQUEST("Pilih ulang avatar untuk template ini.", "Unknown avatar preset.");

    const pool = getPool(config.databaseUrl);
    try {
      // Batas per organisasi. Tanpa ini satu brand bisa menyimpan ribuan
      // template dan membuat galerinya sendiri tidak berguna — lagipula
      // template yang berguna jumlahnya sedikit, bukan ratusan.
      const n = await pool.query<{ c: string }>("SELECT COUNT(*)::text AS c FROM org_templates WHERE org_id=$1", [membership.org_id]);
      if (Number(n.rows[0]?.c ?? 0) >= MAX_PER_ORG) {
        throw ERR.BAD_REQUEST(`Maksimal ${MAX_PER_ORG} template. Hapus yang tidak terpakai dulu.`, "Template limit reached.");
      }
      const id = crypto.randomUUID();
      await pool.query(
        `INSERT INTO org_templates (id, org_id, name, note, kind, format, duration_sec, quality_tier,
           hook_level, hook_family, variant_count, creator_category, avatar_gender, created_by, created_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
        [id, membership.org_id, name, String(body.note ?? "").trim().slice(0, 200) || null,
         kind, format, durationSec, tier, level, hookFamily, count,
         avatar.id,
         avatar.gender,
         user.id, new Date().toISOString()]
      );
      await pgAudit(user.id, "template.created", "org_templates", id, { org_id: membership.org_id });
      return Response.json({ id, name });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}

export async function DELETE(req: Request) {
  try {
    if (!postgresRuntimeEnabled()) throw ERR.BAD_REQUEST("Dashboard butuh runtime PostgreSQL.", "Requires Postgres runtime.");
    const { membership } = await requireOrgContextApi(req);
    const body = await req.json().catch(() => ({}));
    const id = String(body.id ?? "");
    if (!id) throw ERR.BAD_REQUEST("id wajib diisi.", "id is required.");
    const pool = getPool(config.databaseUrl);
    try {
      const res = await pool.query("DELETE FROM org_templates WHERE id=$1 AND org_id=$2", [id, membership.org_id]);
      if (!res.rowCount) throw ERR.NOT_FOUND("Templatenya");
      return Response.json({ deleted: true });
    } finally {
      /* pool dibagikan seluruh proses (lib/postgres/pool.ts) — JANGAN ditutup di sini */
    }
  } catch (err) {
    return errorResponse(err);
  }
}
