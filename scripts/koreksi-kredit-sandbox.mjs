#!/usr/bin/env node
/**
 * Balikkan kredit yang masuk dari callback SANDBOX ke dompet produksi.
 *
 * Kejadiannya: 19 Agu 2026, uji integrasi Duitku sandbox saya sendiri
 * mengkredit Rp60.000 sungguhan ke dompet pengguna produksi (order
 * racun-9f1b7d04-18dbf97f-2c35). Gerbangnya sudah ditutup di kode (webhook
 * sandbox hanya mengkredit penguji terdaftar), tapi saldo yang terlanjur
 * masuk tidak hilang sendiri.
 *
 * BENTUK KOREKSINYA APPEND-ONLY: satu baris credit_ledger type='koreksi'
 * dengan delta negatif, menunjuk payment_id yang sama, plus satu baris
 * audit_log yang menyebut alasannya. Baris topup aslinya TIDAK disentuh —
 * saldo adalah agregat ledger, dan riwayat yang bisa diedit adalah riwayat
 * yang berhenti bisa dipercaya.
 *
 * IDEMPOTEN: dijalankan dua kali tidak memotong dua kali (kunci: satu koreksi
 * per payment_id).
 *
 * Pakai:
 *   DATABASE_URL='postgres://...' node scripts/koreksi-kredit-sandbox.mjs --dry-run
 *   DATABASE_URL='postgres://...' node scripts/koreksi-kredit-sandbox.mjs --apply
 */
import crypto from "node:crypto";
import pg from "pg";

const ALASAN = "duitku sandbox test credit";
const DRY = !process.argv.includes("--apply");
const url = process.env.DATABASE_URL;
if (!url || !/^postgres(ql)?:\/\//i.test(url)) {
  console.error("DATABASE_URL PostgreSQL wajib diisi.");
  process.exit(2);
}

/**
 * Order yang KREDITNYA HARUS DIBALIK, ditulis satu per satu.
 *
 * Daftar sadar, bukan hasil tebakan otomatis dari pola order id: menebak
 * "mana yang sandbox" dari bentuk data akan menebak salah pada saat paling
 * mahal — dan yang dipotong di sini adalah saldo orang.
 */
const ORDER_SANDBOX = [
  { gatewayRef: "racun-9f1b7d04-18dbf97f-2c35", catatan: "uji integrasi Duitku sandbox 19 Agu 2026 (Fase 3), dibayar lewat halaman demo sandbox" },
];

const pool = new pg.Pool({ connectionString: url, max: 2, ssl: { rejectUnauthorized: false } });

try {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const { gatewayRef, catatan } of ORDER_SANDBOX) {
      const pay = await client.query(
        "SELECT id, user_id, amount_idr, status FROM payments WHERE gateway_ref = $1",
        [gatewayRef]
      );
      if (!pay.rows.length) { console.log(`[lewat] ${gatewayRef}: payment tidak ada di basis data ini`); continue; }
      const p = pay.rows[0];

      const topup = await client.query(
        "SELECT id, delta, user_id, org_id FROM credit_ledger WHERE payment_id = $1 AND type = 'topup'",
        [p.id]
      );
      if (!topup.rows.length) { console.log(`[lewat] ${gatewayRef}: tidak ada baris topup — tidak ada yang perlu dibalik`); continue; }

      const sudah = await client.query(
        "SELECT id, delta FROM credit_ledger WHERE payment_id = $1 AND type = 'koreksi'",
        [p.id]
      );
      if (sudah.rows.length) {
        console.log(`[sudah] ${gatewayRef}: koreksi ${sudah.rows[0].id} (${sudah.rows[0].delta}) sudah ada — idempoten, tidak menulis lagi`);
        continue;
      }

      const totalTopup = topup.rows.reduce((n, r) => n + Number(r.delta), 0);
      const t = topup.rows[0];
      console.log(`[${DRY ? "dry-run" : "apply"}] ${gatewayRef}: topup +${totalTopup} -> koreksi ${-totalTopup} (user ${String(t.user_id).slice(0, 8)})`);
      if (DRY) continue;

      const idKoreksi = crypto.randomUUID();
      await client.query(
        "INSERT INTO credit_ledger (id, user_id, org_id, delta, type, payment_id, created_at) VALUES ($1,$2,$3,$4,'koreksi',$5,$6)",
        [idKoreksi, t.user_id, t.org_id ?? null, -totalTopup, p.id, new Date().toISOString()]
      );
      await client.query(
        "INSERT INTO audit_log (id, actor, action, entity, entity_id, meta, created_at) VALUES ($1,'ops-koreksi','credit.koreksi','credit_ledger',$2,$3,$4)",
        [crypto.randomUUID(), idKoreksi, JSON.stringify({
          reason: ALASAN, gateway_ref: gatewayRef, payment_id: p.id,
          topup_ledger_id: t.id, delta: -totalTopup, catatan,
        }), new Date().toISOString()]
      );
      console.log(`   koreksi ${idKoreksi} ditulis, audit_log menunjuk ke sana`);
    }
    if (DRY) { await client.query("ROLLBACK"); console.log("\nDRY-RUN — tidak ada yang ditulis. Jalankan dengan --apply untuk menerapkan."); }
    else { await client.query("COMMIT"); console.log("\nSelesai. Koreksi tersimpan APPEND-ONLY; baris topup aslinya tidak disentuh."); }
  } catch (err) {
    await client.query("ROLLBACK").catch(() => {});
    throw err;
  } finally { client.release(); }
} finally { await pool.end(); }
