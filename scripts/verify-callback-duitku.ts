/**
 * BUKTI rantai lengkap pembayaran: callback Duitku -> kredit masuk -> status paid.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA HARUS DIUJI DI SERVER, LEWAT HTTP
 * ─────────────────────────────────────────────────────────────────────────────
 * Yang dilaporkan Brian 3 Sep 2026 — "sudah bayar di simulator Duitku, tapi
 * tidak ada pemberitahuan" — ternyata BUKAN callback yang tidak sampai:
 * pesanannya tercatat sandbox_paid, artinya tanda tangan dan nilainya sudah
 * lolos. Yang menahan kreditnya adalah gerbang sandbox.
 *
 * Rantai itu melewati tanda tangan md5, pencocokan nilai, gerbang sandbox,
 * pemberian kredit, dan penulisan status — lima hal yang hanya bisa dibuktikan
 * bersama-sama, di lingkungan yang sungguhan.
 *
 * Skrip ini MEMAKAI AKUN YANG SUDAH ADA (email penguji sandbox terdaftar),
 * membuat satu pesanan, menembak webhook seperti Duitku, lalu MENGHAPUS
 * seluruh jejaknya — pesanan, kredit, langganan, dan audit.
 */
import crypto from "node:crypto";
import { closeAllPools, getPool } from "../lib/postgres/pool";
import { config } from "../lib/config";

const basis = (config.appBaseUrl || "https://bikinfyp.com").replace(/\/+$/, "");
const pool = getPool(config.databaseUrl);
const at = () => new Date().toISOString();
const orderId = `uji-callback-${Date.now()}`;
const hasil: Record<string, unknown> = { order_id: orderId };
let userId = "";

async function bersihkan() {
  await pool.query("DELETE FROM kredit_video WHERE payment_id = $1", [orderId]).catch(() => {});
  await pool.query("DELETE FROM langganan WHERE payment_id = $1", [orderId]).catch(() => {});
  await pool.query("DELETE FROM pesanan_item WHERE payment_id = $1", [orderId]).catch(() => {});
  await pool.query("DELETE FROM payments WHERE gateway_ref = $1", [orderId]).catch(() => {});
  await pool.query("DELETE FROM audit_log WHERE entity_id = $1", [orderId]).catch(() => {});
}

try {
  // Akun penguji sandbox yang SUDAH terdaftar — gerbang sandbox hanya
  // mengkredit mereka, dan itu memang aturannya.
  const daftar = (config.sandboxTesterEmails ?? "").split(",").map((e) => e.trim().toLowerCase()).filter(Boolean);
  if (!daftar.length) throw new Error("SANDBOX_TESTER_EMAILS kosong — tidak ada akun yang boleh dikredit di sandbox");
  const { rows: u } = await pool.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE lower(email) = ANY($1::text[]) LIMIT 1", [daftar],
  );
  if (!u[0]) throw new Error(`tidak ada akun dengan email penguji terdaftar (${daftar.join(", ")})`);
  userId = u[0].id;
  hasil.penguji = u[0].email;

  const { rows: paket } = await pool.query<{ id: string; nama: string; harga_idr: number; kuota_premium: number }>(
    "SELECT id, nama, harga_idr, kuota_premium FROM paket_langganan WHERE aktif = TRUE ORDER BY urutan ASC LIMIT 1",
  );
  if (!paket[0]) throw new Error("tidak ada paket aktif");
  const { rows: hargaRow } = await pool.query<{ jenis: string; harga_idr: number }>(
    "SELECT jenis, harga_idr FROM harga_kredit_video WHERE aktif = TRUE ORDER BY harga_idr ASC LIMIT 1",
  );
  const jenis = hargaRow[0];
  const total = Number(paket[0].harga_idr) + (jenis ? Number(jenis.harga_idr) : 0);

  // Pesanan CAMPURAN: paket + satuan, supaya callback diuji pada bentuk yang
  // paling banyak bagiannya.
  await pool.query(
    `INSERT INTO payments (id,user_id,gateway,gateway_ref,amount_idr,credits,status,raw_payload,created_at,jenis_pesanan,paket_id)
     VALUES ($1,$2,'duitku',$3,$4,0,'pending',$5,$6,'campuran',$7)`,
    [crypto.randomUUID(), userId, orderId, total, JSON.stringify({ uji: true }), at(), paket[0].id],
  );
  if (jenis) {
    await pool.query(
      "INSERT INTO pesanan_item (payment_id,jenis,qty,harga_satuan_idr) VALUES ($1,$2,1,$3)",
      [orderId, jenis.jenis, jenis.harga_idr],
    );
  }

  const sebelum = await pool.query<{ n: string }>(
    "SELECT COALESCE(SUM(delta),0)::text AS n FROM kredit_video WHERE user_id = $1", [userId],
  );

  // Tanda tangan callback Duitku: md5(merchantCode + amount + merchantOrderId + apiKey)
  const sign = crypto.createHash("md5")
    .update(config.duitkuMerchantCode + String(total) + orderId + config.duitkuApiKey)
    .digest("hex");
  const form = new URLSearchParams({
    merchantCode: config.duitkuMerchantCode,
    amount: String(total),
    merchantOrderId: orderId,
    resultCode: "00",
    signature: sign,
    reference: `UJI${Date.now()}`,
  });

  const res = await fetch(`${basis}/api/webhooks/duitku`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  hasil.webhook_status = res.status;
  hasil.webhook_body = (await res.text()).slice(0, 300);
  if (!res.ok) throw new Error(`webhook menolak: ${res.status} ${hasil.webhook_body}`);

  const { rows: bayar } = await pool.query<{ status: string }>(
    "SELECT status FROM payments WHERE gateway_ref = $1", [orderId],
  );
  hasil.status_pesanan = bayar[0]?.status;
  if (bayar[0]?.status !== "paid") throw new Error(`status pesanan ${bayar[0]?.status}, seharusnya paid`);

  const sesudah = await pool.query<{ n: string }>(
    "SELECT COALESCE(SUM(delta),0)::text AS n FROM kredit_video WHERE user_id = $1", [userId],
  );
  const bertambah = Number(sesudah.rows[0].n) - Number(sebelum.rows[0].n);
  hasil.kredit_satuan_bertambah = bertambah;
  if (jenis && bertambah < 1) throw new Error("kredit satuan tidak bertambah");

  const { rows: lang } = await pool.query<{ id: string; kuota_premium: number }>(
    "SELECT id, kuota_premium FROM langganan WHERE payment_id = $1", [orderId],
  );
  hasil.langganan_dibuat = Boolean(lang[0]);
  if (!lang[0]) throw new Error("langganan tidak dibuat dari pesanan campuran");

  // Callback ULANGAN — Duitku memang mengulang, dan pernah begitu.
  const res2 = await fetch(`${basis}/api/webhooks/duitku`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: form.toString(),
  });
  hasil.ulangan_status = res2.status;
  const sesudah2 = await pool.query<{ n: string }>(
    "SELECT COALESCE(SUM(delta),0)::text AS n FROM kredit_video WHERE user_id = $1", [userId],
  );
  if (Number(sesudah2.rows[0].n) !== Number(sesudah.rows[0].n)) {
    throw new Error("callback ulangan menambah kredit lagi");
  }
  const { rows: lang2 } = await pool.query("SELECT id FROM langganan WHERE payment_id = $1", [orderId]);
  if (lang2.length !== 1) throw new Error(`callback ulangan membuat ${lang2.length} langganan`);

  hasil.status = "PASS";
} catch (err) {
  hasil.status = "FAIL";
  hasil.error = err instanceof Error ? err.message : String(err);
  process.exitCode = 1;
} finally {
  await bersihkan();
  console.log(JSON.stringify(hasil, null, 2));
  await closeAllPools();
}
