/**
 * KATALOG PAKET — satu sumber, dibaca UI dan server.
 *
 * Sebelumnya daftar paket hidup di komponen klien saja, dan rute pengajuan
 * menyimpan HARGA KIRIMAN KLIEN sebagai fakta. Board review 19 Agu menandainya:
 * siapa pun bisa mengirim {paket:"scale", harga_idr: 1} dan angka itulah yang
 * sampai ke tim penjualan. Harga yang menjadi dasar tagihan tidak boleh pernah
 * berasal dari klien.
 *
 * SATUANNYA KREDIT SEJAK 26 Agu 2026 (tagihan BytePlus membuka COGS nyata;
 * lihat lib/harga-kredit.ts). `tokenIdr` tetap ada dan tetap rupiah karena
 * credit_ledger memang menyimpan rupiah — kredit adalah satuan JUAL, dan
 * konversinya hidup di satu fungsi saja, kreditKeIdr(). Tidak ada migrasi
 * ledger di sini, dan itu disengaja: kurs selain 1:1 di dalam ledger berarti
 * menyentuh setiap baris yang sudah ada (lihat catatan di lib/tokens.ts).
 */
import { PAKET_LANGGANAN, IDR_PER_KREDIT, kreditKeIdr } from "./harga-kredit";

export interface PaketToken {
  id: string;
  jenis: "subscription" | "topup";
  label: string;
  priceIdr: number;
  /** Kredit yang didapat pembeli. SATUAN JUAL. */
  kredit: number;
  /** Bagian dari `kredit` yang merupakan diskon volume. Satu-satunya bentuk
   *  diskon yang diizinkan — harga per kredit TIDAK PERNAH turun, karena itu
   *  akan memaksa biaya render dihitung ulang per paket. */
  kreditBonus: number;
  /** Rupiah yang masuk credit_ledger. */
  tokenIdr: number;
  /**
   * Kredit langganan hangus tiap akhir periode.
   *
   * BELUM ADA PENEGAKNYA. Tidak ada mekanisme kedaluwarsa di credit_ledger —
   * saldo adalah SUM(delta) tanpa dimensi waktu. Bendera ini menyatakan NIAT
   * produk, bukan perilaku sistem, dan ditulis begini supaya tidak ada yang
   * mengira fiturnya sudah jalan. Menegakkannya butuh kolom periode + job
   * kedaluwarsa; itu pekerjaan tersendiri.
   */
  hangusBulanan: boolean;
}

const LANGGANAN: PaketToken[] = PAKET_LANGGANAN.map((p) => ({
  id: p.id,
  jenis: "subscription",
  label: p.label,
  priceIdr: p.priceIdr,
  kredit: p.kreditTotal,
  kreditBonus: p.kreditBonus,
  tokenIdr: kreditKeIdr(p.kreditTotal),
  hangusBulanan: true,
}));

/**
 * Top-up sekali beli. Angka rupiahnya TIDAK diubah 26 Agu — hanya dinyatakan
 * ulang dalam kredit, supaya perubahan harga jual terjadi di satu tempat
 * (paket langganan) dan bisa dinilai terpisah.
 *
 * CATATAN UNTUK BRIAN: pada Rp1jt ke atas, top-up memberi kredit sedikit lebih
 * banyak per rupiah daripada langganan di rentang yang sama. Bukan kebocoran
 * margin (biaya render tetap satu angka), tapi ia melemahkan alasan berlangganan.
 */
const TOPUP_MENTAH = [
  { id: "t1", label: "Top-up Rp250.000", priceIdr: 250_000, tokenIdr: 250_000 },
  { id: "t2", label: "Top-up Rp500.000", priceIdr: 500_000, tokenIdr: 550_000 },
  { id: "t3", label: "Top-up Rp1.000.000", priceIdr: 1_000_000, tokenIdr: 1_150_000 },
  { id: "t4", label: "Top-up Rp2.500.000", priceIdr: 2_500_000, tokenIdr: 3_000_000 },
] as const;

const TOPUP: PaketToken[] = TOPUP_MENTAH.map((p) => {
  const kredit = p.tokenIdr / IDR_PER_KREDIT;
  return {
    ...p,
    jenis: "topup" as const,
    kredit,
    kreditBonus: kredit - p.priceIdr / IDR_PER_KREDIT,
    hangusBulanan: false,
  };
});

export const PAKET_TOKEN: readonly PaketToken[] = [...LANGGANAN, ...TOPUP];

export function paketById(id: string): PaketToken | undefined {
  return PAKET_TOKEN.find((p) => p.id === id);
}
