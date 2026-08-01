// Seed data demo: user demo (08123456789, bonus 3 kredit), 1 persona Hijaber, kategori aktif.
// Jalankan: npm run seed

import { getDb, now, uuid } from "../lib/db";
import { findOrCreateUserByPhone } from "../lib/auth";
import { CREATOR_CATEGORIES } from "../lib/personas";

const db = getDb();

// User demo
const user = findOrCreateUserByPhone("08123456789");
db.prepare("UPDATE users SET name = ? WHERE id = ?").run("Seller Demo", user.id);

// Bonus demo Rp15.000 (3 video Senyap+Teks) — idempoten
const bonus = db
  .prepare("SELECT COALESCE(SUM(delta),0) AS b FROM credit_ledger WHERE user_id = ? AND type = 'bonus'")
  .get(user.id) as { b: number };
if (bonus.b < 15000) {
  db.prepare(
    "INSERT INTO credit_ledger (id, user_id, delta, type, job_id, payment_id, created_at) VALUES (?,?,?,?,NULL,NULL,?)"
  ).run(uuid(), user.id, 15000 - bonus.b, "bonus", now());
}

// Persona Hijaber (kategori terkuat, skor uji 9/10)
const existing = db
  .prepare("SELECT id FROM personas WHERE user_id = ? AND creator_category = 'hijaber'")
  .get(user.id);
if (!existing) {
  db.prepare(
    "INSERT INTO personas (id, user_id, name, creator_category, voice_id, register, created_at) VALUES (?,?,?,?,?,?,?)"
  ).run(uuid(), user.id, "Kak Sari (Hijaber)", "hijaber", "mock-damayanti", "bestie", now());
}

console.log("Seed selesai:");
console.log(`- user demo: 08123456789 (id ${user.id})`);
console.log(`- saldo kredit demo: cek GET /api/credits`);
console.log(`- persona: Kak Sari (Hijaber, register bestie)`);
console.log(`- kategori kreator: ${CREATOR_CATEGORIES.map((c) => `${c.id}=${c.status}`).join(", ")}`);
