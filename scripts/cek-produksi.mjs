#!/usr/bin/env node
// Pemeriksa kesiapan produksi. Dijalankan dari Shell service Render, di mana
// DATABASE_URL dan env lain sudah tersedia:
//
//     node scripts/cek-produksi.mjs
//
// HANYA MEMBACA. Tidak mengubah apa pun, dan sengaja TIDAK PERNAH mencetak
// nilai rahasia — hanya "terisi (N karakter)" — supaya keluarannya aman
// ditempel ke chat, tiket, atau grup tim.

import pg from "pg";

const OK = "ADA", NO = "BELUM";

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL tidak ada. Jalankan dari Shell service Render, bukan dari laptop.");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: url, connectionTimeoutMillis: 10_000 });
  const count = async (sql, args) => Number((await pool.query(sql, args)).rows[0].c);
  const hasColumn = (t, c) =>
    count("SELECT count(*)::int c FROM information_schema.columns WHERE table_name=$1 AND column_name=$2", [t, c]);
  const hasTable = (t) =>
    count("SELECT count(*)::int c FROM information_schema.tables WHERE table_name=$1", [t]);

  try {
    console.log("\n== MIGRASI ==");
    const m18 = await hasColumn("organizations", "onboarded_at");
    const m19 = await hasTable("post_plans");
    const m20 = await hasTable("org_templates");
    console.log(`  0018 organizations.onboarded_at : ${m18 ? OK : NO}`);
    console.log(`  0019 tabel post_plans           : ${m19 ? OK : NO}`);
    console.log(`  0020 tabel org_templates        : ${m20 ? OK : NO}`);

    if (m18) {
      // Backfill wajib berhasil, kalau tidak brand lama akan dihadang
      // onboarding ulang (lihat catatan di 0018 dan di layout dashboard).
      const belum = await count("SELECT count(*)::int c FROM organizations WHERE onboarded_at IS NULL", []);
      const total = await count("SELECT count(*)::int c FROM organizations", []);
      console.log(`  backfill: ${total - belum}/${total} organisasi sudah ditandai`);
      if (belum > 0) {
        console.log(`  -> ${belum} org akan melihat alur onboarding (benar untuk org BARU, salah untuk org lama)`);
      }
    }

    console.log("\n== ENV (nilai tidak pernah dicetak) ==");
    for (const key of ["AUTH_SECRET", "UPLOAD_POST_API_KEY", "SUPPORT_WHATSAPP", "DATABASE_URL", "REDIS_URL"]) {
      const v = process.env[key];
      console.log(`  ${key.padEnd(20)}: ${v ? `terisi (${v.length} karakter)` : "KOSONG"}`);
    }
    const secret = process.env.AUTH_SECRET ?? "";
    if (secret && secret.length < 32) {
      console.log(`  -> AUTH_SECRET cuma ${secret.length} karakter; disarankan >= 32 acak.`);
    }

    console.log("\n== DATA ==");
    for (const t of ["organizations", "org_members", "jobs", "products"]) {
      console.log(`  ${t.padEnd(20)}: ${await count(`SELECT count(*)::int c FROM ${t}`, [])} baris`);
    }
    console.log("");
  } finally {
    await pool.end();
  }
}

main().catch((err) => {
  console.error("GAGAL:", err.message);
  process.exit(1);
});
