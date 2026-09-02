/**
 * Kredit per jenis video di atas SQLite — dev dan tes.
 *
 * Cermin dari lib/postgres/kredit-video.ts. Yang membuat keduanya tidak bisa
 * menyimpang bukan disiplin, melainkan pembagian tugas: SEMUA keputusan
 * (ember mana yang dipotong, apa yang dianggap cukup, kapan langganan masih
 * berlaku) diambil dari lib/kredit-video.ts, dan berkas ini cuma menjalankan
 * SQL-nya. Ada tes yang menjalankan urutan kejadian yang sama pada kedua
 * runtime dan membandingkan hasilnya.
 *
 * Serialisasi di sini bersandar pada transaksi better-sqlite3 yang sinkron dan
 * penulisannya berurutan dalam satu proses; pagar terakhirnya tetap indeks
 * unik di skema, sama seperti di PostgreSQL.
 */
import crypto from "node:crypto";
import { getDb, now } from "./db";
import {
  emberUntukPakai,
  susunSisa,
  totalTagihan,
  akhirDari,
  type Ember,
  type HargaPerJenis,
  type ItemTopup,
  type JenisVideo,
  type PaketLangganan,
  type SisaKredit,
} from "./kredit-video";

type BarisLangganan = {
  id: string;
  paket_id: string;
  paket_nama: string;
  mulai_pada: string;
  berakhir_pada: string;
  sisa_standard: number;
  sisa_premium: number;
  sisa_ultra: number;
};

const SQL_LANGGANAN_AKTIF = `
  SELECT l.id, l.paket_id, l.paket_nama, l.mulai_pada, l.berakhir_pada,
         l.kuota_standard + COALESCE(k.d_standard, 0) AS sisa_standard,
         l.kuota_premium  + COALESCE(k.d_premium, 0)  AS sisa_premium,
         l.kuota_ultra    + COALESCE(k.d_ultra, 0)    AS sisa_ultra
    FROM langganan l
    LEFT JOIN (
      SELECT langganan_id,
             SUM(CASE WHEN jenis = 'standard' THEN delta ELSE 0 END) AS d_standard,
             SUM(CASE WHEN jenis = 'premium'  THEN delta ELSE 0 END) AS d_premium,
             SUM(CASE WHEN jenis = 'ultra'    THEN delta ELSE 0 END) AS d_ultra
        FROM kredit_video WHERE ember = 'langganan' GROUP BY langganan_id
    ) k ON k.langganan_id = l.id
   WHERE l.user_id = ? AND l.status = 'aktif' AND l.berakhir_pada > ?
   ORDER BY l.berakhir_pada ASC`;

function langgananAktifRows(userId: string, sekarang: string): BarisLangganan[] {
  return getDb().prepare(SQL_LANGGANAN_AKTIF).all(userId, sekarang) as BarisLangganan[];
}

export function sisaKredit(userId: string): SisaKredit {
  const rows = langgananAktifRows(userId, now());
  const l: Partial<Record<JenisVideo, number>> = {};
  for (const r of rows) {
    l.standard = (l.standard ?? 0) + r.sisa_standard;
    l.premium = (l.premium ?? 0) + r.sisa_premium;
    l.ultra = (l.ultra ?? 0) + r.sisa_ultra;
  }
  const t: Partial<Record<JenisVideo, number>> = {};
  for (const r of getDb()
    .prepare("SELECT jenis, COALESCE(SUM(delta), 0) AS sisa FROM kredit_video WHERE user_id = ? AND ember = 'topup' GROUP BY jenis")
    .all(userId) as { jenis: JenisVideo; sisa: number }[]) {
    t[r.jenis] = r.sisa;
  }
  return susunSisa(l, t);
}

export function langgananAktif(userId: string) {
  return langgananAktifRows(userId, now()).map((r) => ({
    id: r.id,
    paketId: r.paket_id,
    paketNama: r.paket_nama,
    mulaiPada: r.mulai_pada,
    berakhirPada: r.berakhir_pada,
    status: "aktif" as const,
    sisa: { standard: r.sisa_standard, premium: r.sisa_premium, ultra: r.sisa_ultra },
  }));
}

/** Potong satu jatah. Mengembalikan ember yang dipotong, atau null bila habis. */
export function pakaiKredit(userId: string, jenis: JenisVideo, jobId: string): Ember | null {
  const db = getDb();
  return db.transaction(() => {
    const sudah = db.prepare("SELECT ember FROM kredit_video WHERE job_id = ? AND tipe = 'pakai'").get(jobId) as
      | { ember: Ember }
      | undefined;
    if (sudah) return sudah.ember; // idempoten — percobaan ulang bukan pembayaran kedua

    const sekarang = now();
    const langganan = langgananAktifRows(userId, sekarang);
    const kunci = `sisa_${jenis}` as const;
    const sisaLangganan = langganan.reduce((n, r) => n + Number(r[kunci]), 0);
    const topup = db
      .prepare("SELECT COALESCE(SUM(delta), 0) AS sisa FROM kredit_video WHERE user_id = ? AND ember = 'topup' AND jenis = ?")
      .get(userId, jenis) as { sisa: number };
    const ember = emberUntukPakai(susunSisa({ [jenis]: sisaLangganan }, { [jenis]: topup.sisa }), jenis);
    if (!ember) return null;

    const dipakai = ember === "langganan" ? langganan.find((r) => Number(r[kunci]) > 0) : undefined;
    if (ember === "langganan" && !dipakai) return null;

    db.prepare(
      `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
       VALUES (?,?,?,?,-1,'pakai',?,?,NULL,NULL,?)`,
    ).run(crypto.randomUUID(), userId, jenis, ember, dipakai?.id ?? null, jobId, sekarang);
    return ember;
  })();
}

/** Kembalikan jatah job yang gagal — ke ember dan periode YANG SAMA. */
export function kembalikanKredit(userId: string, jobId: string): boolean {
  const db = getDb();
  return db.transaction(() => {
    const job = db.prepare("SELECT state FROM jobs WHERE id = ?").get(jobId) as { state: string } | undefined;
    if (job?.state === "READY") return false; // video sudah diterima

    if (db.prepare("SELECT id FROM kredit_video WHERE job_id = ? AND tipe = 'kembali'").get(jobId)) return false;
    const asal = db
      .prepare("SELECT jenis, ember, langganan_id FROM kredit_video WHERE job_id = ? AND tipe = 'pakai'")
      .get(jobId) as { jenis: JenisVideo; ember: Ember; langganan_id: string | null } | undefined;
    if (!asal) return false;

    db.prepare(
      `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
       VALUES (?,?,?,?,1,'kembali',?,?,NULL,?,?)`,
    ).run(crypto.randomUUID(), userId, asal.jenis, asal.ember, asal.langganan_id, jobId, "job gagal / dibatalkan", now());
    return true;
  })();
}

export function hargaKredit(): Partial<HargaPerJenis> {
  const h: Partial<HargaPerJenis> = {};
  for (const r of getDb().prepare("SELECT jenis, harga_idr FROM harga_kredit_video WHERE aktif = 1").all() as {
    jenis: JenisVideo;
    harga_idr: number;
  }[]) {
    h[r.jenis] = r.harga_idr;
  }
  return h;
}

export function setHargaKredit(jenis: JenisVideo, hargaIdr: number, adminId: string): void {
  if (!Number.isInteger(hargaIdr) || hargaIdr <= 0) throw new Error("Harga harus bilangan bulat positif.");
  getDb()
    .prepare(
      `INSERT INTO harga_kredit_video (jenis, harga_idr, aktif, diubah_oleh, diubah_pada) VALUES (?,?,1,?,?)
       ON CONFLICT(jenis) DO UPDATE SET harga_idr=excluded.harga_idr, aktif=1,
                                        diubah_oleh=excluded.diubah_oleh, diubah_pada=excluded.diubah_pada`,
    )
    .run(jenis, hargaIdr, adminId, now());
}

export function catatPesananTopup(paymentId: string, items: ItemTopup[], harga: Partial<HargaPerJenis>): number {
  const total = totalTagihan(items, harga);
  const stmt = getDb().prepare(
    "INSERT OR IGNORE INTO pesanan_item (payment_id, jenis, qty, harga_satuan_idr) VALUES (?,?,?,?)",
  );
  for (const it of items) stmt.run(paymentId, it.jenis, it.qty, harga[it.jenis]);
  return total;
}

export function kreditkanTopup(userId: string, paymentId: string): number {
  const db = getDb();
  return db.transaction(() => {
    const items = db.prepare("SELECT jenis, qty FROM pesanan_item WHERE payment_id = ?").all(paymentId) as {
      jenis: JenisVideo;
      qty: number;
    }[];
    let diberi = 0;
    for (const it of items) {
      const r = db
        .prepare(
          `INSERT OR IGNORE INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
           VALUES (?,?,?,'topup',?,'beli',NULL,NULL,?,NULL,?)`,
        )
        .run(crypto.randomUUID(), userId, it.jenis, it.qty, paymentId, now());
      diberi += r.changes ? it.qty : 0;
    }
    return diberi;
  })();
}

export function mulaiLangganan(userId: string, paket: PaketLangganan, paymentId: string | null): string | null {
  const db = getDb();
  return db.transaction(() => {
    if (paymentId && db.prepare("SELECT id FROM langganan WHERE payment_id = ?").get(paymentId)) return null;
    const mulai = now();
    const id = crypto.randomUUID();
    db.prepare(
      `INSERT INTO langganan (id,user_id,paket_id,paket_nama,harga_idr,kuota_standard,kuota_premium,kuota_ultra,
                              mulai_pada,berakhir_pada,status,payment_id,dibuat_pada)
       VALUES (?,?,?,?,?,?,?,?,?,?,'aktif',?,?)`,
    ).run(id, userId, paket.id, paket.nama, paket.hargaIdr, paket.kuotaStandard, paket.kuotaPremium, paket.kuotaUltra,
      mulai, akhirDari(mulai, paket.masaHari), paymentId, mulai);
    return id;
  })();
}

export function bonusKredit(userId: string, jenis: JenisVideo, qty: number, catatan: string): void {
  if (!Number.isInteger(qty) || qty <= 0) throw new Error("Jumlah bonus harus bilangan bulat positif.");
  getDb()
    .prepare(
      `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
       VALUES (?,?,?,'topup',?,'bonus',NULL,NULL,NULL,?,?)`,
    )
    .run(crypto.randomUUID(), userId, jenis, qty, catatan, now());
}

function bacaPaket(r: Record<string, unknown>): PaketLangganan {
  return {
    id: String(r.id),
    nama: String(r.nama),
    keterangan: String(r.keterangan ?? ""),
    hargaIdr: Number(r.harga_idr),
    kuotaStandard: Number(r.kuota_standard),
    kuotaPremium: Number(r.kuota_premium),
    kuotaUltra: Number(r.kuota_ultra),
    masaHari: Number(r.masa_hari),
    urutan: Number(r.urutan),
    aktif: Boolean(r.aktif),
  };
}

export function daftarPaket(hanyaAktif = true): PaketLangganan[] {
  const rows = getDb()
    .prepare(`SELECT * FROM paket_langganan ${hanyaAktif ? "WHERE aktif = 1" : ""} ORDER BY urutan ASC, harga_idr ASC`)
    .all() as Record<string, unknown>[];
  return rows.map(bacaPaket);
}

export function ambilPaket(id: string): PaketLangganan | null {
  const r = getDb().prepare("SELECT * FROM paket_langganan WHERE id = ?").get(id) as Record<string, unknown> | undefined;
  return r ? bacaPaket(r) : null;
}

export function simpanPaket(p: PaketLangganan): void {
  const t = now();
  getDb()
    .prepare(
      `INSERT INTO paket_langganan (id,nama,keterangan,harga_idr,kuota_standard,kuota_premium,kuota_ultra,masa_hari,urutan,aktif,dibuat_pada,diubah_pada)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET nama=excluded.nama, keterangan=excluded.keterangan, harga_idr=excluded.harga_idr,
         kuota_standard=excluded.kuota_standard, kuota_premium=excluded.kuota_premium, kuota_ultra=excluded.kuota_ultra,
         masa_hari=excluded.masa_hari, urutan=excluded.urutan, aktif=excluded.aktif, diubah_pada=excluded.diubah_pada`,
    )
    .run(p.id, p.nama, p.keterangan, p.hargaIdr, p.kuotaStandard, p.kuotaPremium, p.kuotaUltra, p.masaHari, p.urutan,
      p.aktif ? 1 : 0, t, t);
}

export function nonaktifkanPaket(id: string): void {
  getDb().prepare("UPDATE paket_langganan SET aktif = 0, diubah_pada = ? WHERE id = ?").run(now(), id);
}
