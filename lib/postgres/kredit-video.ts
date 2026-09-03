/**
 * Kredit per jenis video di atas PostgreSQL — runtime produksi.
 *
 * Aturannya (ember mana yang dipakai, apa yang dianggap cukup) TIDAK ditulis
 * ulang di sini; semuanya diambil dari lib/kredit-video.ts supaya runtime ini
 * dan runtime SQLite tidak bisa menyimpang diam-diam.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA BANYAK PAGAR UNTUK ANGKA YANG KECIL
 * ────────────────────────────────────────────────────────────────────────────
 * Yang dijaga di sini bukan "1" atau "0", melainkan barang yang dibayar orang.
 * Dua permintaan bersamaan yang sama-sama membaca sisa 1 akan sama-sama merasa
 * boleh, dan dua video keluar dari satu jatah. Karena itu setiap perubahan
 * jatah berjalan di dalam transaksi SERIALIZABLE yang MENGUNCI baris pengguna
 * lebih dulu, dan lapis terakhirnya indeks unik di database — bukan pembacaan
 * "kalau belum ada" yang bisa dilewati dua proses.
 */
import crypto from "node:crypto";
import { Pool, type PoolClient } from "pg";
import { getPool } from "./pool";
import {
  JENIS_VIDEO,
  emberUntukPakai,
  susunSisa,
  totalTagihan,
  akhirDari,
  type Ember,
  type HargaPerJenis,
  type ItemTopup,
  type JenisVideo,
  type Langganan,
  type PaketLangganan,
  type SisaKredit,
} from "../kredit-video";

type BarisLangganan = {
  id: string;
  paket_id: string;
  paket_nama: string;
  mulai_pada: string;
  berakhir_pada: string;
  status: string;
  sisa_standard: string;
  sisa_premium: string;
  sisa_ultra: string;
};

/**
 * Langganan yang MASIH berlaku, beserta sisanya per jenis.
 *
 * Diurutkan dari yang paling cepat berakhir. Urutan itu bukan kosmetik: ia
 * yang dipakai memilih jatah mana yang dihabiskan lebih dulu, supaya yang akan
 * hangus tidak mengendap sementara yang berumur panjang justru terpakai.
 *
 * Perbandingan waktunya STRING atas ISO UTC, bukan aritmetika waktu SQL —
 * kolomnya bertipe TEXT, dan `NOW() - INTERVAL` di kolom TEXT pernah membuat
 * /admin 500.
 */
const SQL_LANGGANAN_AKTIF = `
  SELECT l.id, l.paket_id, l.paket_nama, l.mulai_pada, l.berakhir_pada, l.status,
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
   WHERE l.user_id = $1 AND l.status = 'aktif' AND l.berakhir_pada > $2
   ORDER BY l.berakhir_pada ASC`;

export class PgKreditVideo {
  private readonly pool: Pool;
  private readonly now: () => string;
  private readonly uuid: () => string;

  constructor(databaseUrl: string, options: { now?: () => string; uuid?: () => string } = {}) {
    if (!/^postgres(?:ql)?:\/\//i.test(databaseUrl)) throw new Error("PgKreditVideo membutuhkan DATABASE_URL PostgreSQL.");
    this.pool = getPool(databaseUrl);
    this.now = options.now ?? (() => new Date().toISOString());
    this.uuid = options.uuid ?? (() => crypto.randomUUID());
  }

  // ── Baca ──────────────────────────────────────────────────────────────────

  /**
   * Langganan yang MASIH berlaku, beserta sisanya per jenis.
   *
   * Diurutkan dari yang paling cepat berakhir. Urutan itu bukan kosmetik: ia
   * yang dipakai memilih jatah mana yang dihabiskan lebih dulu, supaya yang
   * akan hangus tidak mengendap sementara yang berumur panjang terpakai.
   *
   * Perbandingan waktunya STRING atas ISO UTC, bukan aritmetika waktu SQL —
   * kolomnya bertipe TEXT, dan `NOW() - INTERVAL` di kolom TEXT pernah
   * membuat /admin 500.
   */
  private async langgananAktifPada(client: PoolClient | Pool, userId: string, sekarang: string): Promise<BarisLangganan[]> {
    const r = await client.query<BarisLangganan>(SQL_LANGGANAN_AKTIF, [userId, sekarang]);
    return r.rows;
  }

  async sisa(userId: string): Promise<SisaKredit> {
    const sekarang = this.now();
    const [langgananRows, topupRows] = await Promise.all([
      this.langgananAktifPada(this.pool, userId, sekarang),
      this.pool.query<{ jenis: JenisVideo; sisa: string }>(
        "SELECT jenis, COALESCE(SUM(delta), 0) AS sisa FROM kredit_video WHERE user_id = $1 AND ember = 'topup' GROUP BY jenis",
        [userId],
      ),
    ]);
    const l: Partial<Record<JenisVideo, number>> = {};
    for (const row of langgananRows) {
      l.standard = (l.standard ?? 0) + Number(row.sisa_standard);
      l.premium = (l.premium ?? 0) + Number(row.sisa_premium);
      l.ultra = (l.ultra ?? 0) + Number(row.sisa_ultra);
    }
    const t: Partial<Record<JenisVideo, number>> = {};
    for (const row of topupRows.rows) t[row.jenis] = Number(row.sisa);
    return susunSisa(l, t);
  }

  async langgananAktif(userId: string): Promise<(Langganan & { sisa: Record<JenisVideo, number> })[]> {
    const rows = await this.langgananAktifPada(this.pool, userId, this.now());
    return rows.map((r) => ({
      id: r.id,
      paketId: r.paket_id,
      paketNama: r.paket_nama,
      kuotaStandard: Number(r.sisa_standard),
      kuotaPremium: Number(r.sisa_premium),
      kuotaUltra: Number(r.sisa_ultra),
      mulaiPada: r.mulai_pada,
      berakhirPada: r.berakhir_pada,
      status: "aktif" as const,
      sisa: { standard: Number(r.sisa_standard), premium: Number(r.sisa_premium), ultra: Number(r.sisa_ultra) },
    }));
  }

  // ── Pakai & kembalikan ────────────────────────────────────────────────────

  /**
   * Potong satu jatah untuk sebuah job.
   *
   * Mengembalikan ember yang dipotong, atau null kalau jatahnya habis. TIDAK
   * melempar galat untuk jatah habis: itu keadaan normal yang harus dijawab
   * dengan kalimat, bukan dengan 500.
   */
  async pakai(userId: string, jenis: JenisVideo, jobId: string): Promise<Ember | null> {
    return this.transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      return pakaiDenganClient(client, userId, jenis, jobId, this.now(), this.uuid());
    });
  }

  /**
   * Kembalikan jatah sebuah job yang gagal.
   *
   * Dikembalikan ke ember dan periode YANG SAMA dengan saat dipotong. Kalau
   * tidak, jatah langganan yang gagal akan berubah jadi jatah abadi — cara
   * pelan untuk membocorkan barang, dan cara cepat untuk membuat pembukuan
   * periode tidak pernah cocok.
   *
   * Job yang sudah READY TIDAK dikembalikan: videonya sudah diterima.
   */
  async kembalikan(userId: string, jobId: string): Promise<boolean> {
    return this.transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      const job = await client.query<{ state: string }>("SELECT state FROM jobs WHERE id = $1 FOR UPDATE", [jobId]);
      if (job.rows.some((r) => r.state === "READY")) return false;

      const sudah = await client.query("SELECT id FROM kredit_video WHERE job_id = $1 AND tipe = 'kembali'", [jobId]);
      if (sudah.rowCount) return false;
      const asal = await client.query<{ jenis: JenisVideo; ember: Ember; langganan_id: string | null }>(
        "SELECT jenis, ember, langganan_id FROM kredit_video WHERE job_id = $1 AND tipe = 'pakai'", [jobId],
      );
      if (!asal.rowCount) return false;
      const { jenis, ember, langganan_id } = asal.rows[0];

      await client.query(
        `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
         VALUES ($1,$2,$3,$4,1,'kembali',$5,$6,NULL,$7,$8)`,
        [this.uuid(), userId, jenis, ember, langganan_id, jobId, "job gagal / dibatalkan", this.now()],
      );
      await this.audit(client, userId, "kredit_video.kembali", "jobs", jobId, { jenis, ember });
      return true;
    });
  }

  // ── Pembelian ─────────────────────────────────────────────────────────────

  /** Harga add-on yang berlaku, hanya yang aktif. */
  async harga(): Promise<Partial<HargaPerJenis>> {
    const r = await this.pool.query<{ jenis: JenisVideo; harga_idr: number }>(
      "SELECT jenis, harga_idr FROM harga_kredit_video WHERE aktif = TRUE",
    );
    const h: Partial<HargaPerJenis> = {};
    for (const row of r.rows) h[row.jenis] = Number(row.harga_idr);
    return h;
  }

  async setHarga(jenis: JenisVideo, hargaIdr: number, adminId: string): Promise<void> {
    if (!Number.isInteger(hargaIdr) || hargaIdr <= 0) throw new Error("Harga harus bilangan bulat positif.");
    await this.pool.query(
      `INSERT INTO harga_kredit_video (jenis, harga_idr, aktif, diubah_oleh, diubah_pada)
       VALUES ($1,$2,TRUE,$3,$4)
       ON CONFLICT (jenis) DO UPDATE SET harga_idr = EXCLUDED.harga_idr, aktif = TRUE,
                                         diubah_oleh = EXCLUDED.diubah_oleh, diubah_pada = EXCLUDED.diubah_pada`,
      [jenis, hargaIdr, adminId, this.now()],
    );
  }

  /**
   * Catat isi pesanan topup, dengan harga yang DISALIN saat ini juga.
   *
   * Dipanggil saat invoice dibuat, bukan saat dibayar. Kalau admin menaikkan
   * harga sementara invoice itu belum dibayar, yang berlaku tetap harga saat
   * pembeli menekan tombol.
   */
  async catatPesananTopup(paymentId: string, items: ItemTopup[], harga: Partial<HargaPerJenis>): Promise<number> {
    const total = totalTagihan(items, harga);
    for (const it of items) {
      await this.pool.query(
        `INSERT INTO pesanan_item (payment_id, jenis, qty, harga_satuan_idr) VALUES ($1,$2,$3,$4)
         ON CONFLICT (payment_id, jenis) DO NOTHING`,
        [paymentId, it.jenis, it.qty, harga[it.jenis]],
      );
    }
    return total;
  }

  /**
   * Berikan kredit topup setelah pembayaran benar-benar lunas.
   *
   * Idempoten lewat indeks unik (payment_id, jenis) untuk tipe 'beli': callback
   * gateway bisa datang lebih dari sekali, dan pernah begitu.
   */
  async kreditkanTopup(userId: string, paymentId: string): Promise<number> {
    return this.transaction(async (client) => {
      const items = await client.query<{ jenis: JenisVideo; qty: number }>(
        "SELECT jenis, qty FROM pesanan_item WHERE payment_id = $1", [paymentId],
      );
      let diberi = 0;
      for (const it of items.rows) {
        const r = await client.query(
          `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
           VALUES ($1,$2,$3,'topup',$4,'beli',NULL,NULL,$5,NULL,$6)
           ON CONFLICT DO NOTHING`,
          [this.uuid(), userId, it.jenis, it.qty, paymentId, this.now()],
        );
        diberi += r.rowCount ? it.qty : 0;
      }
      if (diberi) await this.audit(client, userId, "kredit_video.topup", "payments", paymentId, { diberi });
      return diberi;
    });
  }

  /**
   * Mulai atau PERPANJANG langganan.
   *
   * ──────────────────────────────────────────────────────────────────────────
   * PAKET SAMA = PERPANJANG; PAKET BEDA = MENUMPUK
   * ──────────────────────────────────────────────────────────────────────────
   * Membeli paket yang SAMA saat paket itu masih aktif dulu melahirkan periode
   * kedua yang berdampingan. Akibatnya nyata: pembeli dengan sisa 3 video dan
   * 5 hari lagi mendapat 9 video, tapi 3 di antaranya tetap hangus dalam 5
   * hari. Sekarang kuotanya ditambahkan ke periode yang ada dan tanggal
   * berakhirnya DIDORONG dari tanggal lamanya — bukan dari hari ini, karena
   * itulah arti "perpanjang".
   *
   * Paket BERBEDA tetap menumpuk: kuota lama utuh, kuota baru ditambahkan, dan
   * pemakaian menghabiskan periode yang paling cepat hangus lebih dulu.
   *
   * Kuota paket tetap DISALIN, tidak dirujuk: mengubah isi paket bulan depan
   * tidak boleh mengubah apa yang sudah dibeli — ke atas maupun ke bawah.
   *
   * IDEMPOTENSINYA PINDAH. Perpanjangan tidak melahirkan baris langganan baru,
   * jadi uniq_langganan_payment tidak lagi menjaganya. Kunci primer payment_id
   * di langganan_perpanjangan memulihkan penjagaan itu — callback Duitku yang
   * datang dua kali tidak bisa mendorong tanggalnya dua kali.
   */
  async mulaiLangganan(userId: string, paket: PaketLangganan, paymentId: string | null): Promise<string | null> {
    return this.transaction(async (client) => {
      await client.query("SELECT id FROM users WHERE id = $1 FOR UPDATE", [userId]);
      const sekarang = this.now();

      if (paymentId) {
        const sudah = await client.query(
          `SELECT 1 FROM langganan_perpanjangan WHERE payment_id = $1
            UNION ALL SELECT 1 FROM langganan WHERE payment_id = $1`,
          [paymentId],
        );
        if (sudah.rowCount) return null;
      }

      const berjalan = await client.query<{
        id: string; berakhir_pada: string;
      }>(
        `SELECT id, berakhir_pada FROM langganan
          WHERE user_id = $1 AND paket_id = $2 AND status = 'aktif' AND berakhir_pada > $3
          ORDER BY berakhir_pada DESC LIMIT 1`,
        [userId, paket.id, sekarang],
      );

      if (berjalan.rows[0]) {
        const lama = berjalan.rows[0];
        const berakhirBaru = akhirDari(lama.berakhir_pada, paket.masaHari);
        await client.query(
          `UPDATE langganan SET kuota_standard = kuota_standard + $2, kuota_premium = kuota_premium + $3,
                                kuota_ultra = kuota_ultra + $4, berakhir_pada = $5
            WHERE id = $1`,
          [lama.id, paket.kuotaStandard, paket.kuotaPremium, paket.kuotaUltra, berakhirBaru],
        );
        await client.query(
          `INSERT INTO langganan_perpanjangan
             (payment_id,langganan_id,paket_id,kuota_standard,kuota_premium,kuota_ultra,hari,berakhir_sebelum,berakhir_sesudah,dibuat_pada)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [paymentId ?? `manual-${this.uuid()}`, lama.id, paket.id,
           paket.kuotaStandard, paket.kuotaPremium, paket.kuotaUltra, paket.masaHari,
           lama.berakhir_pada, berakhirBaru, sekarang],
        );
        await this.audit(client, userId, "langganan.perpanjang", "langganan", lama.id, {
          paket_id: paket.id, payment_id: paymentId, berakhir_sebelum: lama.berakhir_pada, berakhir_sesudah: berakhirBaru,
        });
        return lama.id;
      }

      const id = this.uuid();
      await client.query(
        `INSERT INTO langganan (id,user_id,paket_id,paket_nama,harga_idr,kuota_standard,kuota_premium,kuota_ultra,
                                mulai_pada,berakhir_pada,status,payment_id,dibuat_pada)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,'aktif',$11,$9)`,
        [id, userId, paket.id, paket.nama, paket.hargaIdr, paket.kuotaStandard, paket.kuotaPremium, paket.kuotaUltra,
         sekarang, akhirDari(sekarang, paket.masaHari), paymentId],
      );
      await this.audit(client, userId, "langganan.mulai", "langganan", id, { paket_id: paket.id, payment_id: paymentId });
      return id;
    });
  }

  /** Pemberian cuma-cuma (paket gratis pendaftar baru, kompensasi). */
  async bonus(userId: string, jenis: JenisVideo, qty: number, catatan: string): Promise<void> {
    if (!Number.isInteger(qty) || qty <= 0) throw new Error("Jumlah bonus harus bilangan bulat positif.");
    await this.pool.query(
      `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
       VALUES ($1,$2,$3,'topup',$4,'bonus',NULL,NULL,NULL,$5,$6)`,
      [this.uuid(), userId, jenis, qty, catatan, this.now()],
    );
  }

  // ── Paket ─────────────────────────────────────────────────────────────────

  async daftarPaket(hanyaAktif = true): Promise<PaketLangganan[]> {
    const r = await this.pool.query(
      `SELECT * FROM paket_langganan ${hanyaAktif ? "WHERE aktif = TRUE" : ""} ORDER BY urutan ASC, harga_idr ASC`,
    );
    return r.rows.map(bacaPaket);
  }

  async ambilPaket(id: string): Promise<PaketLangganan | null> {
    const r = await this.pool.query("SELECT * FROM paket_langganan WHERE id = $1", [id]);
    return r.rows[0] ? bacaPaket(r.rows[0]) : null;
  }

  async simpanPaket(p: PaketLangganan): Promise<void> {
    const t = this.now();
    await this.pool.query(
      `INSERT INTO paket_langganan (id,nama,keterangan,harga_idr,kuota_standard,kuota_premium,kuota_ultra,masa_hari,urutan,aktif,dibuat_pada,diubah_pada)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (id) DO UPDATE SET nama=EXCLUDED.nama, keterangan=EXCLUDED.keterangan, harga_idr=EXCLUDED.harga_idr,
         kuota_standard=EXCLUDED.kuota_standard, kuota_premium=EXCLUDED.kuota_premium, kuota_ultra=EXCLUDED.kuota_ultra,
         masa_hari=EXCLUDED.masa_hari, urutan=EXCLUDED.urutan, aktif=EXCLUDED.aktif, diubah_pada=EXCLUDED.diubah_pada`,
      [p.id, p.nama, p.keterangan, p.hargaIdr, p.kuotaStandard, p.kuotaPremium, p.kuotaUltra, p.masaHari, p.urutan, p.aktif, t],
    );
  }

  /**
   * Paket dinonaktifkan, TIDAK dihapus. Langganan yang sudah berjalan menyimpan
   * salinan kuotanya sendiri, tapi riwayat pembelian tetap menunjuk id paket
   * ini — menghapus barisnya membuat riwayat menunjuk sesuatu yang hilang.
   */
  async nonaktifkanPaket(id: string): Promise<void> {
    await this.pool.query("UPDATE paket_langganan SET aktif = FALSE, diubah_pada = $2 WHERE id = $1", [id, this.now()]);
  }

  // ── Perkakas ──────────────────────────────────────────────────────────────

  private async transaction<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    for (let attempt = 0; attempt < 3; attempt++) {
      const client = await this.pool.connect();
      try {
        await client.query("BEGIN ISOLATION LEVEL SERIALIZABLE");
        const value = await fn(client);
        await client.query("COMMIT");
        return value;
      } catch (error) {
        await client.query("ROLLBACK").catch(() => undefined);
        const code = (error as { code?: string }).code;
        if ((code === "40001" || code === "40P01") && attempt < 2) continue;
        throw error;
      } finally {
        client.release();
      }
    }
    throw new Error("Transaksi PostgreSQL habis retry.");
  }

  private async audit(client: PoolClient, actor: string, action: string, entity: string, entityId: string | null, meta: unknown) {
    await client.query(
      "INSERT INTO audit_log (id,actor,action,entity,entity_id,meta,created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)",
      [this.uuid(), actor, action, entity, entityId, JSON.stringify(meta), this.now()],
    );
  }
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

export { JENIS_VIDEO };

/**
 * Inti pemotongan jatah, dijalankan DI DALAM transaksi milik pemanggil.
 *
 * Dipisah supaya pembuatan job bisa memotong jatah di transaksi YANG SAMA
 * dengan penulisan baris job-nya. Kalau keduanya di transaksi berbeda, ada
 * celah nyata di antaranya: proses mati setelah job tertulis tapi sebelum
 * jatah terpotong, dan videonya keluar gratis — atau sebaliknya, jatah
 * terpotong untuk job yang tidak pernah ada.
 *
 * PEMANGGIL WAJIB sudah mengunci baris pengguna (SELECT ... FOR UPDATE)
 * sebelum memanggil ini. Tanpa kunci itu, dua permintaan bersamaan sama-sama
 * membaca sisa 1 dan dua-duanya merasa boleh.
 */
export async function pakaiDenganClient(
  client: PoolClient,
  userId: string,
  jenis: JenisVideo,
  jobId: string,
  sekarang: string,
  idBaru: string,
): Promise<Ember | null> {
  const sudah = await client.query<{ ember: Ember }>(
    "SELECT ember FROM kredit_video WHERE job_id = $1 AND tipe = 'pakai'", [jobId],
  );
  // Idempoten — percobaan ulang pembuatan job bukan pembayaran kedua.
  if (sudah.rowCount) return sudah.rows[0].ember;

  const langganan = await client.query<BarisLangganan>(SQL_LANGGANAN_AKTIF, [userId, sekarang]);
  const kunci = `sisa_${jenis}` as const;
  const sisaLangganan = langganan.rows.reduce((n, r) => n + Number(r[kunci as keyof BarisLangganan]), 0);
  const topup = await client.query<{ sisa: string }>(
    "SELECT COALESCE(SUM(delta), 0) AS sisa FROM kredit_video WHERE user_id = $1 AND ember = 'topup' AND jenis = $2",
    [userId, jenis],
  );
  const ember = emberUntukPakai(susunSisa({ [jenis]: sisaLangganan }, { [jenis]: Number(topup.rows[0].sisa) }), jenis);
  if (!ember) return null;

  // Langganan yang paling cepat berakhir DAN masih punya jatah jenis ini.
  const dipakai = ember === "langganan"
    ? langganan.rows.find((r) => Number(r[kunci as keyof BarisLangganan]) > 0)
    : undefined;
  if (ember === "langganan" && !dipakai) return null;

  await client.query(
    `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
     VALUES ($1,$2,$3,$4,-1,'pakai',$5,$6,NULL,NULL,$7)`,
    [idBaru, userId, jenis, ember, dipakai?.id ?? null, jobId, sekarang],
  );
  return ember;
}

/**
 * Inti pengembalian jatah, dijalankan DI DALAM transaksi milik pemanggil.
 *
 * Dipakai failJob supaya kegagalan job dan kembalinya jatah adalah satu
 * satuan: kalau salah satunya batal, dua-duanya batal. Job yang sudah READY
 * tidak akan pernah sampai ke sini — failJob hanya berjalan untuk job yang
 * berhasil dipindahkan ke FAILED, dan transisi itu menolak job READY.
 */
export async function kembalikanDenganClient(
  client: PoolClient,
  userId: string,
  jobId: string,
  sekarang: string,
  idBaru: string,
): Promise<boolean> {
  const sudah = await client.query("SELECT id FROM kredit_video WHERE job_id = $1 AND tipe = 'kembali'", [jobId]);
  if (sudah.rowCount) return false;
  const asal = await client.query<{ jenis: JenisVideo; ember: Ember; langganan_id: string | null }>(
    "SELECT jenis, ember, langganan_id FROM kredit_video WHERE job_id = $1 AND tipe = 'pakai'", [jobId],
  );
  if (!asal.rowCount) return false;
  const { jenis, ember, langganan_id } = asal.rows[0];
  // Dikembalikan ke ember dan periode YANG SAMA. Kalau tidak, jatah langganan
  // yang gagal berubah jadi jatah abadi — cara pelan membocorkan barang, dan
  // cara cepat membuat pembukuan periode tidak pernah cocok.
  await client.query(
    `INSERT INTO kredit_video (id,user_id,jenis,ember,delta,tipe,langganan_id,job_id,payment_id,catatan,dibuat_pada)
     VALUES ($1,$2,$3,$4,1,'kembali',$5,$6,NULL,$7,$8)`,
    [idBaru, userId, jenis, ember, langganan_id, jobId, "job gagal / dibatalkan", sekarang],
  );
  return true;
}
