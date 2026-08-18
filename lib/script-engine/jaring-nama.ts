import { cleanProductName } from "../extract";

/**
 * JARING PENGAMAN NAMA PRODUK — tangga tiga tahap.
 *
 * Canary 12 klip (19 Agu), temuan #4: nama produk 4–6 kata mengalahkan penulis
 * SECARA KONSISTEN. kopitang-a dan arva-b gagal L-05/S-09 di TIGA putaran
 * (25–28 kata vs jendela 22) — dua jatah perbaikan LLM tidak pernah cukup,
 * karena nama yang wajib disebut sudah memakan jendela katanya.
 *
 * cleanProductName saja TIDAK menolong kasus ini: batasnya 6 kata, dan nama
 * yang gagal justru sudah ≤6 kata — masalahnya bukan embel-embel marketplace,
 * tapi nama sah yang kepanjangan untuk dialog 15 detik. Penjual sungguhan
 * juga tidak menyebut SKU lengkap di video — mereka menyebut MEREKNYA.
 *
 * Tangganya, berhenti di anak tangga pertama yang lolos:
 *   1. nama asli (perilaku lama, mayoritas produk berhenti di sini);
 *   2. cleanProductName — buang embel-embel promo/spesifikasi (maks 6 kata);
 *   3. namaPanggung — merek saja, seperti penjual menyebutnya.
 *
 * Nama yang DIPAKAI diaporkan lewat shortenedTo supaya provenance-nya tidak
 * hilang: pengguna berhak tahu dialognya menyebut "KOPI TANG", bukan SKU
 * lengkap, dan QC hilir tetap menilai berdasarkan nama produk tersimpan.
 */

/**
 * Nama panggung: bagaimana penjual MENYEBUT produk ini, bukan bagaimana
 * marketplace mengejanya.
 *
 * Aturan: deretan kata ALL-CAPS di depan nama (1–2 kata) hampir selalu merek
 * ("KOPI TANG …", "SOMETHINC …", "ARVA …"). Tanpa deretan itu, dua kata
 * pertama hasil pembersihan ("Mosseru Glow Serum X" → "Mosseru Glow").
 * Ekor kata pendek menggantung (≤3 huruf) dibuang — pola yang sama dengan
 * cleanProductName, supaya tidak ada "KOPI TANG Gu" di dialog.
 */
export function namaPanggung(raw: string): string {
  const bersih = cleanProductName(raw);
  const kata = bersih.split(/\s+/).filter(Boolean);
  if (kata.length <= 2) return bersih;

  // Deretan ALL-CAPS di depan = merek. Angka/persen ikut memutus deretan
  // ("SOMETHINC Level 1% ..." → hanya "SOMETHINC").
  const capsRun: string[] = [];
  for (const k of kata) {
    if (/^[A-Z][A-Z0-9&'-]+$/.test(k) && capsRun.length < 2) capsRun.push(k);
    else break;
  }
  let pilih = capsRun.length >= 1 && capsRun.join(" ").length >= 3 ? capsRun : kata.slice(0, 2);

  const akhir = pilih[pilih.length - 1];
  if (pilih.length > 1 && akhir && akhir.length <= 3 && /^[A-Za-z]+$/.test(akhir)) pilih = pilih.slice(0, -1);

  const hasil = pilih.join(" ").trim();
  return hasil.length >= 3 ? hasil : bersih;
}

export interface HasilJaringNama<V> {
  variants: V[];
  /** Ada varian yang lolos gate? (variants selalu berisi putaran TERAKHIR.) */
  adaLolos: boolean;
  /** Nama yang akhirnya dipakai bila berbeda dari nama asli; null = nama asli. */
  shortenedTo: string | null;
}

/**
 * Jalankan generator naskah dengan tangga nama. `run` menerima nama produk dan
 * mengembalikan varian ber-`validation.passed` — bentuk yang sama di keempat
 * rute (campaign, retail, matrix, coba).
 */
export async function cobaDenganNamaPendek<V extends { validation: { passed: boolean } }>(
  run: (namaProduk: string) => Promise<V[]>,
  namaAsli: string
): Promise<HasilJaringNama<V>> {
  const tangga: string[] = [namaAsli];
  for (const kandidat of [cleanProductName(namaAsli), namaPanggung(namaAsli)]) {
    if (kandidat && !tangga.includes(kandidat)) tangga.push(kandidat);
  }

  let variants: V[] = [];
  for (const [i, nama] of tangga.entries()) {
    variants = await run(nama);
    if (variants.some((v) => v.validation.passed)) {
      return { variants, adaLolos: true, shortenedTo: i === 0 ? null : nama };
    }
  }
  // Semua anak tangga gagal — kembalikan putaran terakhir (error message-nya
  // paling relevan: nama sudah sependek mungkin, sebabnya pasti bukan nama).
  return { variants, adaLolos: false, shortenedTo: null };
}
