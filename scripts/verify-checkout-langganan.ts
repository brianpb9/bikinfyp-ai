/**
 * BUKTI bahwa checkout paket bulanan berjalan sampai ke gateway.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * KENAPA DIUJI LEWAT HTTP, BUKAN DENGAN MEMANGGIL FUNGSINYA
 * ─────────────────────────────────────────────────────────────────────────────
 * Kegagalan yang dilaporkan Brian 3 Sep 2026 — "klik paket bulanan, tidak
 * terjadi apa-apa" — TIDAK akan terlihat oleh tes unit mana pun: permintaannya
 * tidak pernah dikirim, karena tombolnya mati di klien. Dan kegagalan
 * sebelumnya (HTTP 500 pada checkout) juga hanya muncul di production, karena
 * di dev SQLite justru hidup.
 *
 * Jadi skrip ini menembak rute yang SUNGGUHAN di server yang sungguhan, dengan
 * sesi yang sah, lalu memeriksa jawabannya. Ia MEMBUAT pesanan di sandbox
 * Duitku — tidak ada uang sungguhan yang bergerak, tapi ia meninggalkan baris
 * pesanan, jadi ia membersihkan miliknya sendiri di akhir.
 */
import crypto from "node:crypto";
import { issueToken } from "../lib/auth";
import { closeAllPools, getPool } from "../lib/postgres/pool";
import { config } from "../lib/config";

const basis = (config.appBaseUrl || "https://bikinfyp.com").replace(/\/+$/, "");
const pool = getPool(config.databaseUrl);
const userId = crypto.randomUUID();
const email = `uji-checkout-${Date.now()}@bikinfyp.test`;
const at = () => new Date().toISOString();

async function bersihkan() {
  const { rows } = await pool.query<{ gateway_ref: string }>(
    "SELECT gateway_ref FROM payments WHERE user_id = $1", [userId],
  );
  for (const r of rows) await pool.query("DELETE FROM pesanan_item WHERE payment_id = $1", [r.gateway_ref]).catch(() => {});
  await pool.query("DELETE FROM kredit_video WHERE user_id = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM langganan WHERE user_id = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM payments WHERE user_id = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM audit_log WHERE actor = $1", [userId]).catch(() => {});
  await pool.query("DELETE FROM users WHERE id = $1", [userId]).catch(() => {});
}

const hasil: Record<string, unknown> = {};
try {
  await pool.query(
    "INSERT INTO users (id,email,phone,tier,locale,created_at) VALUES ($1,$2,NULL,'free','id-ID',$3)",
    [userId, email, at()],
  );
  const token = await issueToken(userId, "");
  const kepala = { "content-type": "application/json", cookie: `racun_token=${token}` };

  // Paket aktif termurah — yang persis ditekan Brian.
  const { rows: paket } = await pool.query<{ id: string; nama: string; harga_idr: number }>(
    "SELECT id, nama, harga_idr FROM paket_langganan WHERE aktif = TRUE ORDER BY urutan ASC LIMIT 1",
  );
  if (!paket[0]) throw new Error("tidak ada paket aktif untuk diuji");
  hasil.paket = paket[0];

  // 1. Katalog terbaca oleh pemilik sesi.
  const katalog = await fetch(`${basis}/api/kredit-video`, { headers: kepala });
  hasil.katalog_status = katalog.status;
  if (!katalog.ok) throw new Error(`GET /api/kredit-video ${katalog.status}: ${(await katalog.text()).slice(0, 200)}`);

  // 2. Checkout paket bulanan — jalur yang dilaporkan tidak berfungsi.
  const res = await fetch(`${basis}/api/kredit-video/checkout`, {
    method: "POST",
    headers: kepala,
    body: JSON.stringify({ mode: "langganan", paket_id: paket[0].id, payment_method: "I1" }),
  });
  const teks = await res.text();
  hasil.checkout_status = res.status;
  hasil.checkout_body = teks.slice(0, 400);
  if (res.status !== 201) throw new Error(`checkout langganan gagal: ${res.status} ${teks.slice(0, 300)}`);

  const jawab = JSON.parse(teks) as { order_id: string; amount_idr: number; va_number?: string; redirect_url?: string };
  if (jawab.amount_idr !== Number(paket[0].harga_idr)) {
    throw new Error(`nilai tagihan ${jawab.amount_idr} tidak sama dengan harga paket ${paket[0].harga_idr}`);
  }

  // 3. Pesanan BENAR-BENAR tercatat, dan tahu dirinya pesanan langganan.
  const { rows: bayar } = await pool.query<{ jenis_pesanan: string; paket_id: string; amount_idr: number; status: string }>(
    "SELECT jenis_pesanan, paket_id, amount_idr, status FROM payments WHERE gateway_ref = $1", [jawab.order_id],
  );
  if (!bayar[0]) throw new Error("pesanan tidak tercatat di tabel payments");
  if (bayar[0].jenis_pesanan !== "langganan") throw new Error(`jenis_pesanan salah: ${bayar[0].jenis_pesanan}`);
  if (bayar[0].paket_id !== paket[0].id) throw new Error(`paket_id salah: ${bayar[0].paket_id}`);

  // 4. Jalur SATUAN juga, di skrip yang sama: keduanya berbagi rute dan
  // penyusun tagihan, jadi menguji salah satunya saja meninggalkan separuh
  // jalur uang tanpa bukti.
  const jenisTermurah = await pool.query<{ jenis: string; harga_idr: number }>(
    "SELECT jenis, harga_idr FROM harga_kredit_video WHERE aktif = TRUE ORDER BY harga_idr ASC LIMIT 1",
  );
  if (jenisTermurah.rows[0]) {
    const j = jenisTermurah.rows[0];
    const res2 = await fetch(`${basis}/api/kredit-video/checkout`, {
      method: "POST",
      headers: kepala,
      body: JSON.stringify({ mode: "topup", items: [{ jenis: j.jenis, qty: 2 }], payment_method: "I1" }),
    });
    const teks2 = await res2.text();
    hasil.topup_status = res2.status;
    if (res2.status !== 201) throw new Error(`checkout satuan gagal: ${res2.status} ${teks2.slice(0, 300)}`);
    const jawab2 = JSON.parse(teks2) as { order_id: string; amount_idr: number };
    if (jawab2.amount_idr !== Number(j.harga_idr) * 2) {
      throw new Error(`tagihan satuan ${jawab2.amount_idr} bukan 2x ${j.harga_idr}`);
    }
    // Isi pesanannya tercatat dengan harga yang DISALIN saat memesan.
    const { rows: item } = await pool.query<{ jenis: string; qty: number; harga_satuan_idr: number }>(
      "SELECT jenis, qty, harga_satuan_idr FROM pesanan_item WHERE payment_id = $1", [jawab2.order_id],
    );
    if (!item[0] || item[0].qty !== 2 || Number(item[0].harga_satuan_idr) !== Number(j.harga_idr)) {
      throw new Error(`isi pesanan satuan tidak tercatat benar: ${JSON.stringify(item)}`);
    }
    hasil.topup_order = { order_id: jawab2.order_id, total: jawab2.amount_idr, item: item[0] };
  }

  // 5. PESANAN CAMPURAN — paket + satuan dalam satu invoice.
  const jenis2 = await pool.query<{ jenis: string; harga_idr: number }>(
    "SELECT jenis, harga_idr FROM harga_kredit_video WHERE aktif = TRUE ORDER BY harga_idr ASC LIMIT 1",
  );
  if (jenis2.rows[0]) {
    const j = jenis2.rows[0];
    const res3 = await fetch(`${basis}/api/kredit-video/checkout`, {
      method: "POST",
      headers: kepala,
      body: JSON.stringify({ paket_id: paket[0].id, items: [{ jenis: j.jenis, qty: 1 }], payment_method: "I1" }),
    });
    const teks3 = await res3.text();
    hasil.campuran_status = res3.status;
    if (res3.status !== 201) throw new Error(`checkout campuran gagal: ${res3.status} ${teks3.slice(0, 300)}`);
    const jawab3 = JSON.parse(teks3) as { order_id: string; amount_idr: number };
    const seharusnya = Number(paket[0].harga_idr) + Number(j.harga_idr);
    if (jawab3.amount_idr !== seharusnya) {
      throw new Error(`tagihan campuran ${jawab3.amount_idr}, seharusnya ${seharusnya}`);
    }
    const { rows: pay } = await pool.query<{ jenis_pesanan: string; paket_id: string }>(
      "SELECT jenis_pesanan, paket_id FROM payments WHERE gateway_ref = $1", [jawab3.order_id],
    );
    if (pay[0]?.jenis_pesanan !== "campuran") throw new Error(`jenis_pesanan campuran salah: ${pay[0]?.jenis_pesanan}`);
    if (pay[0]?.paket_id !== paket[0].id) throw new Error("paket_id hilang dari pesanan campuran");
    const { rows: it } = await pool.query("SELECT jenis, qty FROM pesanan_item WHERE payment_id = $1", [jawab3.order_id]);
    if (!it.length) throw new Error("isi satuan hilang dari pesanan campuran");
    hasil.campuran = { order_id: jawab3.order_id, total: jawab3.amount_idr, paket: pay[0].paket_id, item: it[0] };

    // 6. DIULANG dengan isi yang SAMA PERSIS — harus DILANJUTKAN, bukan
    //    menerbitkan invoice kedua yang sama-sama hidup.
    const res4 = await fetch(`${basis}/api/kredit-video/checkout`, {
      method: "POST",
      headers: kepala,
      body: JSON.stringify({ paket_id: paket[0].id, items: [{ jenis: j.jenis, qty: 1 }], payment_method: "I1" }),
    });
    const jawab4 = JSON.parse(await res4.text()) as { order_id: string; dilanjutkan?: boolean };
    hasil.ulang_status = res4.status;
    hasil.ulang_dilanjutkan = jawab4.dilanjutkan ?? false;
    if (jawab4.order_id !== jawab3.order_id) {
      throw new Error(`pesanan kedua menerbitkan invoice baru (${jawab4.order_id}) — pembeli bisa membayar dua kali`);
    }
  }

  hasil.status = "PASS";
  hasil.order_id = jawab.order_id;
  hasil.va_number = jawab.va_number ?? null;
  hasil.tercatat = bayar[0];
} catch (err) {
  hasil.status = "FAIL";
  hasil.error = err instanceof Error ? err.message : String(err);
  process.exitCode = 1;
} finally {
  await bersihkan();
  console.log(JSON.stringify(hasil, null, 2));
  await closeAllPools();
}
