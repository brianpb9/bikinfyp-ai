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
//   4. KERUSAKAN TIDAK BOLEH MENYAMAR JADI KEKOSONGAN. Kolom `images` yang
//      tidak bisa dibaca BUKAN "produk tanpa foto". Keduanya sama-sama
//      menghasilkan nol foto, tapi artinya berlawanan: tanpa foto berarti
//      tidak ada yang rusak, kolom rusak berarti kita TIDAK TAHU berapa yang
//      rusak. Menggabungkannya membuat cacah terbrick terlalu rendah persis
//      pada produk yang paling perlu dilihat manusia.

import { resolveApprovedReference, ALASAN_TOLAK, type AlasanTolak, type RinciTolak } from "./product-truth";

/**
 * Kenapa kolom `images` gagal dibaca. Dipisah karena tindakannya berbeda: JSON
 * korup menandakan penulisan yang terputus, non-array menandakan penulis yang
 * memakai bentuk lain, elemen bukan-teks menandakan satu baris tercemar di
 * tengah daftar yang selebihnya sah.
 */
export const KOLOM_RUSAK = {
  JSON_KORUP: "IMAGES_COLUMN_UNPARSEABLE",
  BUKAN_ARRAY: "IMAGES_COLUMN_NOT_ARRAY",
  ELEMEN_BUKAN_TEKS: "IMAGES_COLUMN_BAD_ELEMENT",
} as const;
export type SebabKolomRusak = (typeof KOLOM_RUSAK)[keyof typeof KOLOM_RUSAK];

/**
 * Hasil baca kolom `images`, TERDISKRIMINASI.
 *
 * Bentuk ini ada supaya kegagalan tidak bisa dikembalikan sebagai `[]`. Daftar
 * kosong adalah jawaban yang SAH dan berarti "produk ini memang tidak punya
 * foto"; ia tidak boleh dipakai juga untuk "saya tidak bisa membacanya".
 */
export type HasilKolomImages =
  | { ok: true; images: string[] }
  | { ok: false; sebab: SebabKolomRusak; contoh: string };

/** Potongan pendek nilai mentah, cukup untuk mengenali barisnya tanpa membanjiri laporan. */
function contohMentah(mentah: unknown): string {
  const teks = typeof mentah === "string" ? mentah : JSON.stringify(mentah) ?? String(mentah);
  return teks.length > 120 ? `${teks.slice(0, 120)}…` : teks;
}

/**
 * Membaca kolom `images` yang di kedua runtime disimpan sebagai teks JSON.
 *
 * Tinggal di pustaka, BUKAN di skrip, karena inilah tempat kesalahan hitung
 * bisa lahir tanpa terlihat — dan skrip tidak bisa diuji.
 */
export function bacaKolomImages(mentah: unknown): HasilKolomImages {
  if (Array.isArray(mentah)) return periksaElemen(mentah, mentah);
  if (mentah === null || mentah === undefined) return { ok: true, images: [] };
  if (typeof mentah !== "string") return { ok: false, sebab: KOLOM_RUSAK.BUKAN_ARRAY, contoh: contohMentah(mentah) };
  // Kolom kosong adalah default kolom (`'[]'` belum terisi di baris lama) dan
  // memang berarti tidak ada foto, bukan kerusakan.
  if (mentah.trim() === "") return { ok: true, images: [] };
  let nilai: unknown;
  try {
    nilai = JSON.parse(mentah);
  } catch {
    return { ok: false, sebab: KOLOM_RUSAK.JSON_KORUP, contoh: contohMentah(mentah) };
  }
  if (!Array.isArray(nilai)) return { ok: false, sebab: KOLOM_RUSAK.BUKAN_ARRAY, contoh: contohMentah(mentah) };
  return periksaElemen(nilai, mentah);
}

function periksaElemen(nilai: unknown[], mentah: unknown): HasilKolomImages {
  // Menyaring elemen bukan-teks akan MENGHILANGKAN foto dari cacah tanpa satu
  // pun tanda — kerusakan yang sama, sekadar lebih halus.
  if (nilai.some((x) => typeof x !== "string")) {
    return { ok: false, sebab: KOLOM_RUSAK.ELEMEN_BUKAN_TEKS, contoh: contohMentah(mentah) };
  }
  return { ok: true, images: nilai as string[] };
}

/** Satu produk apa adanya dari database — modul ini tidak tahu SQL. */
export interface ProdukUntukAudit {
  id: string;
  /**
   * Kolom `images` yang sudah dibaca. Array biasa diterima karena sebuah array
   * MEMANG kolom yang berhasil dibaca; kegagalan hanya bisa dinyatakan lewat
   * bentuk terdiskriminasi, jadi tidak ada cara menyelundupkannya sebagai kosong.
   */
  images: string[] | HasilKolomImages;
  /** Opsional, untuk laporan yang bisa ditindaklanjuti manusia. */
  nama?: string | null;
  orgId?: string | null;
}

/** Satu produk yang kolom fotonya tidak bisa dibaca sama sekali. */
export interface ProdukKolomRusak {
  id: string;
  nama: string | null;
  orgId: string | null;
  sebab: SebabKolomRusak;
  contoh: string;
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
  /** Produk yang kolom `images`-nya tidak bisa dibaca — TIDAK sama dengan tanpa foto. */
  produkKolomRusak: number;
  foto: number;
  fotoTersetujui: number;
  /** Cacah per reason code tingkat atas. */
  perAlasan: Record<string, number>;
  /** Cacah per sub-kategori EVIDENCE_INVALID. */
  perRinci: Record<string, number>;
  /** Cacah per sebab kolom `images` rusak. */
  perKolomRusak: Record<string, number>;
  /** Produk yang akan terbrick, untuk ditindaklanjuti. */
  terbrick: RingkasanProduk[];
  /** Produk dengan kolom rusak, DENGAN ID, karena hanya manusia yang bisa memperbaikinya. */
  kolomRusak: ProdukKolomRusak[];
}

/**
 * Menghitung satu angkatan produk.
 *
 * Produk TANPA foto sama sekali dihitung terpisah dan TIDAK disebut terbrick:
 * ia memang belum pernah bisa dirender, jadi gerbang bukti tidak mengubah
 * apa pun untuknya. Mencampurnya akan menggelembungkan angka kerusakan dengan
 * kerusakan yang bukan disebabkan perubahan ini.
 *
 * Produk dengan kolom `images` RUSAK dihitung di ember ketiga, bukan di salah
 * satu dari dua di atas. Ia tidak boleh disebut terbrick (gerbang bukti bukan
 * penyebabnya) dan tidak boleh disebut tanpa foto (kita tidak tahu berapa foto
 * yang dimilikinya). Satu-satunya jawaban jujur adalah menyebut namanya.
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
    produkKolomRusak: 0,
    foto: 0,
    fotoTersetujui: 0,
    perAlasan: {},
    perRinci: {},
    perKolomRusak: {},
    terbrick: [],
    kolomRusak: [],
  };

  for await (const produk of daftar as AsyncIterable<ProdukUntukAudit>) {
    hasil.produk += 1;

    const kolom: HasilKolomImages = Array.isArray(produk.images) ? { ok: true, images: produk.images } : produk.images;
    if (!kolom.ok) {
      hasil.produkKolomRusak += 1;
      hasil.perKolomRusak[kolom.sebab] = (hasil.perKolomRusak[kolom.sebab] ?? 0) + 1;
      if (hasil.kolomRusak.length < batasSimpan) {
        hasil.kolomRusak.push({
          id: produk.id,
          nama: produk.nama ?? null,
          orgId: produk.orgId ?? null,
          sebab: kolom.sebab,
          contoh: kolom.contoh,
        });
      }
      continue;
    }

    const images = kolom.images;
    if (images.length === 0) {
      hasil.produkTanpaFoto += 1;
      continue;
    }
    hasil.foto += images.length;

    const resolusi = await resolveApprovedReference(images);
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
          jumlahFoto: images.length,
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
  baris.push(`  KOLOM images RUSAK  : ${h.produkKolomRusak}  (rusak SEKARANG, bukan oleh gerbang)`);
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

  if (h.produkKolomRusak > 0) {
    baris.push("");
    baris.push("kolom images rusak per sebab:");
    for (const [k, v] of Object.entries(h.perKolomRusak).sort((a, b) => b[1] - a[1])) {
      baris.push(`  ${k.padEnd(28)} ${v}`);
    }
    baris.push(`produk dengan kolom rusak (${h.kolomRusak.length} pertama):`);
    for (const p of h.kolomRusak) {
      baris.push(`  ${p.id}  ${p.nama ?? "(tanpa nama)"}  org=${p.orgId ?? "-"}  -> ${p.sebab}  ${p.contoh}`);
    }
  }

  if (h.terbrick.length > 0) {
    baris.push("");
    baris.push(`produk yang akan terbrick (${h.terbrick.length} pertama):`);
    for (const p of h.terbrick) {
      const sebab = [...new Set(p.alasan.map((a) => a.rinci ?? a.alasan))].join(", ");
      baris.push(`  ${p.id}  foto=${p.jumlahFoto}  ${p.nama ?? "(tanpa nama)"}  org=${p.orgId ?? "-"}  -> ${sebab}`);
    }
  }
  return baris.join("\n");
}
