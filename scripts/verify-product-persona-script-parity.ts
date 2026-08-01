import assert from "node:assert/strict";
import fs from "node:fs";
import type { PgScriptInput } from "../lib/postgres/product-persona-script";

type Snapshot = {
  product: { owned: boolean; deniedOtherUser: boolean; name: string; visualDesc: string | null; images: string[]; extractedRawMeta: boolean };
  persona: { sameCategoryReused: boolean; category: string; createdAudits: number };
  scripts: { generated: number; readableByOwner: boolean; deniedOtherUser: boolean; qualityTiers: string[]; edited: number; approved: boolean; segmentsChanged: boolean; generatedAudits: number; approvedAudits: number };
};

const mode = process.argv[2];
if (mode !== "sqlite" && mode !== "postgres") throw new Error("Gunakan sqlite atau postgres.");
const owner = "user-owner";
const other = "user-other";
const variants: PgScriptInput[] = (["silent_caption", "high_quality", "super_hq"] as const).map((qualityTier, i) => ({
  hookFamily: `hook-${i}`, emotion: "senang", register: "bestie", qualityTier,
  segments: [{ scene: i + 1, text: `teks awal ${i}` }], caption: `caption ${i}`, hashtags: ["#racun"], validationResult: { passed: true, warnings: [] },
}));
const manual = { sourceUrl: null, name: "Serum Andal", priceIdr: 129000, category: "beauty", productVisualDesc: "botol amber", images: ["uploads/p/0.webp"], rawMeta: null };
const extracted = { sourceUrl: "https://shop.test/item", name: "Produk dari link", priceIdr: 0, category: "default", images: [], rawMeta: { og: { price: null } } };

function emit(snapshot: Snapshot) { process.stdout.write(`${JSON.stringify(snapshot)}\n`); }

if (mode === "sqlite") {
  const dbPath = process.env.DB_PATH;
  assert.ok(dbPath, "DB_PATH sementara wajib untuk parity SQLite");
  fs.rmSync(dbPath, { force: true });
  process.env.RACUN_NO_DOTENV = "1";
  const { getDb } = await import("../lib/db");
  const db = getDb();
  for (const id of [owner, other]) db.prepare("INSERT INTO users (id, email, tier, locale, created_at) VALUES (?,?,?,?,?)").run(id, `${id}@test`, "free", "id-ID", "2026-08-01T00:00:00.000Z");
  const productId = "product-manual";
  db.prepare("INSERT INTO products (id,user_id,source_url,name,price_idr,category,product_visual_desc,images,raw_meta,created_at) VALUES (?,?,?,?,?,?,?,?,?,?)")
    .run(productId, owner, manual.sourceUrl, manual.name, manual.priceIdr, manual.category, manual.productVisualDesc, JSON.stringify(manual.images), null, "2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)").run("a-product", owner, "product.created", "products", productId, JSON.stringify({ name: manual.name, category: manual.category }), "2026-08-01T00:00:00.000Z");
  db.prepare("UPDATE products SET name=?, price_idr=?, category=?, product_visual_desc=? WHERE id=? AND user_id=?").run("Serum Andal Baru", 135000, "skincare", null, productId, owner);
  db.prepare("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)").run("a-update", owner, "product.updated", "products", productId, JSON.stringify({ name: "Serum Andal Baru", price_idr: 135000 }), "2026-08-01T00:00:00.000Z");
  db.prepare("INSERT INTO products (id,user_id,source_url,name,price_idr,category,images,raw_meta,created_at) VALUES (?,?,?,?,?,?,?,?,?)")
    .run("product-extracted", owner, extracted.sourceUrl, extracted.name, extracted.priceIdr, extracted.category, "[]", JSON.stringify(extracted.rawMeta), "2026-08-01T00:00:00.000Z");
  const existing = db.prepare("SELECT * FROM personas WHERE user_id=? AND creator_category=?").get(owner, "hijaber") as { id: string } | undefined;
  const personaId = existing?.id ?? "persona-hijaber";
  if (!existing) { db.prepare("INSERT INTO personas (id,user_id,name,creator_category,voice_id,register,created_at) VALUES (?,?,?,?,?,?,?)").run(personaId, owner, "Kreator Hijaber", "hijaber", "mock-damayanti", "bestie", "2026-08-01T00:00:00.000Z"); db.prepare("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)").run("a-persona", owner, "persona.created", "personas", personaId, JSON.stringify({ creator_category: "hijaber" }), "2026-08-01T00:00:00.000Z"); }
  const personaAgain = (db.prepare("SELECT id FROM personas WHERE user_id=? AND creator_category=?").get(owner, "hijaber") as { id: string }).id;
  const scriptIds: string[] = [];
  variants.forEach((v, i) => { const id = `script-${i}`; scriptIds.push(id); db.prepare("INSERT INTO scripts (id,job_id,product_id,hook_family,emotion,register,segments,caption,hashtags,validation_result,quality_tier,approved_by_user_at,edited_by_user,created_at) VALUES (?,NULL,?,?,?,?,?,?,?,?,?,NULL,0,?)").run(id, productId, v.hookFamily, v.emotion, v.register, JSON.stringify(v.segments), v.caption, JSON.stringify(v.hashtags), JSON.stringify(v.validationResult), v.qualityTier, "2026-08-01T00:00:00.000Z"); db.prepare("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)").run(`a-script-${i}`, owner, "script.generated", "scripts", id, JSON.stringify({ hook_family: v.hookFamily, passed: true }), "2026-08-01T00:00:00.000Z"); });
  db.prepare("UPDATE scripts SET segments=?, edited_by_user=?, approved_by_user_at=?, validation_result=? WHERE id=?").run(JSON.stringify([{ scene: 1, text: "teks edit" }]), 1, "2026-08-01T00:01:00.000Z", JSON.stringify({ passed: true, warnings: [] }), scriptIds[0]);
  db.prepare("INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES (?,?,?,?,?,?,?)").run("a-approve", owner, "script.approved", "scripts", scriptIds[0], JSON.stringify({ edited: true }), "2026-08-01T00:01:00.000Z");
  const product = db.prepare("SELECT * FROM products WHERE id=? AND user_id=?").get(productId, owner) as { name: string; product_visual_desc: string | null; images: string };
  const script = db.prepare("SELECT * FROM scripts WHERE id=?").get(scriptIds[0]) as { approved_by_user_at: string | null; edited_by_user: number; segments: string };
  const count = (sql: string, params: unknown[] = []) => (db.prepare(sql).get(...params) as { value: number }).value;
  emit({ product: { owned: !!product, deniedOtherUser: !db.prepare("SELECT id FROM products WHERE id=? AND user_id=?").get(productId, other), name: product.name, visualDesc: product.product_visual_desc, images: JSON.parse(product.images), extractedRawMeta: !!db.prepare("SELECT id FROM products WHERE id=? AND raw_meta IS NOT NULL").get("product-extracted") }, persona: { sameCategoryReused: personaId === personaAgain, category: "hijaber", createdAudits: count("SELECT COUNT(*) AS value FROM audit_log WHERE action='persona.created'") }, scripts: { generated: scriptIds.length, readableByOwner: !!db.prepare("SELECT s.id FROM scripts s JOIN products p ON p.id=s.product_id WHERE s.id=? AND p.user_id=?").get(scriptIds[0], owner), deniedOtherUser: !db.prepare("SELECT s.id FROM scripts s JOIN products p ON p.id=s.product_id WHERE s.id=? AND p.user_id=?").get(scriptIds[0], other), qualityTiers: (db.prepare("SELECT quality_tier FROM scripts ORDER BY id").all() as { quality_tier: string }[]).map((r) => r.quality_tier), edited: script.edited_by_user, approved: script.approved_by_user_at !== null, segmentsChanged: JSON.parse(script.segments)[0].text === "teks edit", generatedAudits: count("SELECT COUNT(*) AS value FROM audit_log WHERE action='script.generated'"), approvedAudits: count("SELECT COUNT(*) AS value FROM audit_log WHERE action='script.approved'") } });
} else {
  const databaseUrl = process.env.DATABASE_URL;
  assert.ok(databaseUrl, "DATABASE_URL database disposable wajib untuk parity PostgreSQL");
  const { PgProductPersonaScriptRepository } = await import("../lib/postgres/product-persona-script");
  const { Pool } = await import("pg");
  const repo = new PgProductPersonaScriptRepository(databaseUrl, { now: (() => { let i = 0; return () => `2026-08-01T00:00:${String(i++).padStart(2, "0")}.000Z`; })(), uuid: (() => { let i = 0; return () => `00000000-0000-4000-8000-${String(++i).padStart(12, "0")}`; })() });
  const pool = new Pool({ connectionString: databaseUrl });
  try {
    for (const id of [owner, other]) await pool.query("INSERT INTO users (id,email,tier,locale,created_at) VALUES ($1,$2,$3,$4,$5)", [id, `${id}@test`, "free", "id-ID", "2026-08-01T00:00:00.000Z"]);
    const product = await repo.createProduct(owner, manual);
    const updated = await repo.updateOwnedProduct(owner, product.id, { name: "Serum Andal Baru", priceIdr: 135000, category: "skincare", productVisualDesc: null });
    assert.ok(updated);
    assert.equal(await repo.updateOwnedProduct(other, product.id, { name: "tidak boleh", priceIdr: 1, category: "x", productVisualDesc: null }), null, "ownership produk wajib dijaga");
    await repo.createExtractedProduct(owner, extracted);
    const personas = await Promise.all(Array.from({ length: 8 }, () => repo.findOrCreatePersona(owner, { id: "hijaber", name: "Hijaber" })));
    assert.equal(new Set(personas.map((p) => p.id)).size, 1, "find/create persona paralel harus satu baris");
    const scripts = await repo.createScripts(owner, product.id, variants);
    assert.equal(await repo.createScripts(other, product.id, variants).then(() => false, () => true), true, "pembuatan script lintas owner wajib ditolak");
    const approved = await repo.approveOwnedScript(owner, scripts[0].id, { segments: [{ scene: 1, text: "teks edit" }], edited: true, validationResult: { passed: true, warnings: [] } });
    assert.ok(approved);
    assert.equal(await repo.approveOwnedScript(other, scripts[0].id, { segments: [], edited: false, validationResult: {} }), null, "approval lintas owner wajib ditolak");
    await assert.rejects(repo.createProduct("user-missing", manual));
    const failedProducts = Number((await pool.query<{ value: string }>("SELECT COUNT(*) AS value FROM products WHERE user_id='user-missing'")).rows[0].value);
    assert.equal(failedProducts, 0, "FK failure harus rollback produk dan audit");
    const owned = await repo.getOwnedProduct(owner, product.id);
    const rawMeta = await pool.query("SELECT raw_meta FROM products WHERE source_url=$1", [extracted.sourceUrl]);
    const count = async (action: string) => Number((await pool.query<{ value: string }>("SELECT COUNT(*) AS value FROM audit_log WHERE action=$1", [action])).rows[0].value);
    emit({ product: { owned: !!owned, deniedOtherUser: (await repo.getOwnedProduct(other, product.id)) === null, name: owned!.name, visualDesc: owned!.product_visual_desc ?? null, images: JSON.parse(owned!.images), extractedRawMeta: rawMeta.rows[0].raw_meta !== null }, persona: { sameCategoryReused: new Set(personas.map((p) => p.id)).size === 1, category: personas[0].creator_category, createdAudits: await count("persona.created") }, scripts: { generated: scripts.length, readableByOwner: (await repo.getOwnedScript(owner, scripts[0].id)) !== null, deniedOtherUser: (await repo.getOwnedScript(other, scripts[0].id)) === null, qualityTiers: scripts.map((s) => s.quality_tier), edited: approved!.edited_by_user, approved: approved!.approved_by_user_at !== null, segmentsChanged: JSON.parse(approved!.segments)[0].text === "teks edit", generatedAudits: await count("script.generated"), approvedAudits: await count("script.approved") } });
  } finally { await pool.end(); await repo.close(); }
}
