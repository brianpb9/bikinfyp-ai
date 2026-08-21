// P0-B3 — AUDIT BUKTI PRODUK, OFFLINE DAN HANYA-BACA.
//
// Pertanyaan yang dijawab: kalau penegakan bukti dinyalakan HARI INI, berapa
// produk yang berhenti bisa dirender, dan KENAPA masing-masing?
//
// Kenapa ini harus ada SEBELUM penegakan. Seluruh produk yang sudah hidup di
// produksi dibuat sebelum kontrak bukti ada. Sebagian punya sidecar (jalur
// unggah manual Retail), sebagian tidak sama sekali (ekstrak-link dan seluruh
// jalur Enterprise). Menyalakan gerbang tanpa mengetahui angkanya berarti
// mengetahui akibatnya dari keluhan pengguna — yaitu terlambat.
//
// TIGA ATURAN YANG TIDAK BOLEH DILANGGAR MODUL INI:
//
//   1. HANYA BACA. Nol tulis ke storage, nol tulis ke database, nol jaringan.
//      Audit yang memperbaiki sambil menghitung tidak bisa dijalankan dua kali
//      dan angkanya tidak bisa direproduksi siapa pun.
//   2. HAKIMNYA RESOLVER YANG SAMA. Audit memakai `resolveApprovedReference`,
//      bukan aturan tandingan. Audit yang menilai dengan aturannya sendiri akan
//      melaporkan angka yang tidak pernah cocok dengan apa yang terjadi saat
//      gerbang benar-benar menyala.
//   3. TIDAK MENGARANG ASAL-USUL. Foto tanpa bukti dihitung sebagai foto tanpa
//      bukti. Ia tidak "dianggap layak karena sudah lama", dan tidak
//      diterbitkan buktinya di sini.

import { resolveApprovedReference, ALASAN_TOLAK, type AlasanTolak, type RinciTolak } from "./product-truth";

/** Satu produk apa adanya dari database — modul ini tidak tahu SQL. */
export interface ProdukUntukAudit {
  id: string;
  /** Kolom `images` yang sudah di-parse. */
  images: string[];
  /** Opsional, untuk laporan yang bisa ditindaklanjuti manusia. */
  nama?: string | null;
  orgId?: string | null;
}

export interface RingkasanProduk {
  id: string;
  nama: string | null;
  orgId: string | null;
  jumlahFoto: number;
  jumlahTersetujui: number;
  /** Produk ini berhenti bisa dirender begitu gerbang menyala. */
  terbrick: boolean;
  /** Alasan per foto, urut sesuai daftar foto. */
  alasan: { rel: string; alasan: AlasanTolak; rinci?: RinciTolak }[];
}

export interface HasilAudit {
  produk: number;
  produkTerbrick: number;
  produkTanpaFoto: number;
  foto: number;
  fotoTersetujui: number;
  /** Cacah per reason code tingkat atas. */
  perAlasan: Record<string, number>;
  /** Cacah per sub-kategori EVIDENCE_INVALID. */
  perRinci: Record<string, number>;
  /** Produk yang akan terbrick, untuk ditindaklanjuti. */
  terbrick: RingkasanProduk[];
}

/**
 * Menghitung satu angkatan produk.
 *
 * Produk TANPA foto sama sekali dihitung terpisah dan TIDAK disebut terbrick:
 * ia memang belum pernah bisa dirender, jadi gerbang bukti tidak mengubah
 * apa pun untuknya. Mencampurnya akan menggelembungkan angka kerusakan dengan
 * kerusakan yang bukan disebabkan perubahan ini.
 */
export async function auditBuktiProduk(
  daftar: AsyncIterable<ProdukUntukAudit> | Iterable<ProdukUntukAudit>,
  opsi: { simpanTerbrick?: number } = {}
): Promise<HasilAudit> {
  const batasSimpan = opsi.simpanTerbrick ?? 200;
  const hasil: HasilAudit = {
    produk: 0,
    produkTerbrick: 0,
    produkTanpaFoto: 0,
    foto: 0,
    fotoTersetujui: 0,
    perAlasan: {},
    perRinci: {},
    terbrick: [],
  };

  for await (const produk of daftar as AsyncIterable<ProdukUntukAudit>) {
    hasil.produk += 1;
    if (produk.images.length === 0) {
      hasil.produkTanpaFoto += 1;
      continue;
    }
    hasil.foto += produk.images.length;

    const resolusi = await resolveApprovedReference(produk.images);
    hasil.fotoTersetujui += resolusi.tersetujui.length;
    for (const d of resolusi.ditolak) {
      hasil.perAlasan[d.alasan] = (hasil.perAlasan[d.alasan] ?? 0) + 1;
      if (d.rinci) hasil.perRinci[d.rinci] = (hasil.perRinci[d.rinci] ?? 0) + 1;
    }

    const terbrick = resolusi.tersetujui.length === 0;
    if (terbrick) {
      hasil.produkTerbrick += 1;
      if (hasil.terbrick.length < batasSimpan) {
        hasil.terbrick.push({
          id: produk.id,
          nama: produk.nama ?? null,
          orgId: produk.orgId ?? null,
          jumlahFoto: produk.images.length,
          jumlahTersetujui: 0,
          terbrick: true,
          alasan: resolusi.ditolak.map((d) => ({
            rel: d.rel,
            alasan: d.alasan,
            ...(d.rinci ? { rinci: d.rinci } : {}),
          })),
        });
      }
    }
  }

  return hasil;
}

/** Laporan siap-baca. Dipisah dari perhitungan supaya keduanya bisa diuji sendiri. */
export function laporanAudit(h: HasilAudit): string {
  const baris: string[] = [];
  baris.push("AUDIT BUKTI PRODUK — hanya-baca, nol perubahan");
  baris.push("");
  baris.push(`produk diperiksa      : ${h.produk}`);
  baris.push(`  tanpa foto          : ${h.produkTanpaFoto}  (tidak terpengaruh gerbang)`);
  baris.push(`  AKAN TERBRICK       : ${h.produkTerbrick}`);
  baris.push(`foto diperiksa        : ${h.foto}`);
  baris.push(`  tersetujui          : ${h.fotoTersetujui}`);
  baris.push("");
  baris.push("penolakan per alasan:");
  const kosong = "  (tidak ada)";
  const perAlasan = Object.entries(h.perAlasan).sort((a, b) => b[1] - a[1]);
  if (perAlasan.length === 0) baris.push(kosong);
  for (const [k, v] of perAlasan) baris.push(`  ${k.padEnd(20)} ${v}`);
  baris.push("");
  baris.push(`rincian ${ALASAN_TOLAK.BUKTI_TIDAK_SAH}:`);
  const perRinci = Object.entries(h.perRinci).sort((a, b) => b[1] - a[1]);
  if (perRinci.length === 0) baris.push(kosong);
  for (const [k, v] of perRinci) baris.push(`  ${k.padEnd(24)} ${v}`);

  if (h.terbrick.length > 0) {
    baris.push("");
    baris.push(`produk yang akan terbrick (${h.terbrick.length} pertama):`);
    for (const p of h.terbrick) {
      const sebab = [...new Set(p.alasan.map((a) => a.rinci ?? a.alasan))].join(", ");
      baris.push(`  ${p.id}  foto=${p.jumlahFoto}  ${p.nama ?? "(tanpa nama)"}  -> ${sebab}`);
    }
  }
  return baris.join("\n");
}
