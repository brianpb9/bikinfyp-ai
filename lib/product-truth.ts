// PRODUCT TRUTH — satu rumah untuk pertanyaan "foto mana yang boleh jadi acuan".
//
// KENAPA MODUL INI ADA. Sebelumnya tidak ada satu pun tempat yang menjawabnya,
// jadi setiap pemanggil menyusun aturannya sendiri — dan itulah kenapa dua
// worker bisa berbeda. `lib/worker.ts` dan `lib/postgres/worker.ts` sama-sama
// mengambil `images[0]`: foto pertama menang karena URUTAN UNGGAH, bukan karena
// bukti. Produk yang foto pertamanya banner promo mengirim BANNER ke model
// video sebagai acuan "beginilah rupa produknya", dan model menyalin teksnya ke
// kemasan. Baru ketahuan sesudah dibayar.
//
// KONTRAK YANG DIPEGANG MODUL INI, dan ketiganya dipilih sengaja:
//
//   1. TIDAK PERNAH MELEMPAR untuk bukti tidak sah. Bukti tidak sah adalah
//      keadaan data yang normal dan terduga, bukan kondisi luar biasa. Yang
//      boleh melempar hanya kegagalan infrastruktur (storage mati) — dan itu
//      memang harus naik, karena "storage mati" tidak boleh disamakan dengan
//      "fotonya tidak layak".
//   2. ALASAN DILAPORKAN SEBAGAI DATA. Setiap penolakan membawa reason code
//      stabil dan pesan yang bisa dibaca manusia. Penolakan tanpa alasan
//      memaksa pemanggil menebak, dan operator tidak bisa membedakan bukti
//      rusak dari berkas hilang saat mengaudit.
//   3. GAGAL-TERTUTUP ADALAH TUGAS PEMANGGIL. Modul ini menjawab; ia tidak
//      menghentikan job. Worker yang tidak mendapat referensi tersetujui wajib
//      berhenti SEBELUM langkah berbayar mana pun.
//
// MODUL INI TIDAK PERNAH MENULIS. Ia membaca sidecar dan bytes untuk
// memverifikasi, tapi tidak pernah menerbitkan bukti. Bukti yang dicetak di
// tengah jalur render tidak pernah dilihat siapa pun, tidak punya rantai
// kustodi, dan menempel pada bytes apa pun yang kebetulan ada di storage detik
// itu. Penerbitan bukti hanya boleh terjadi di jalur ingestion/revalidasi yang
// terbukti punya binernya.

import crypto from "node:crypto";
import { KEBIJAKAN_KLASIFIKASI, type JenisGambar } from "./media/klasifikasi-gambar";
import { relMeta } from "./product-images";
import { mediaStorage } from "./storage";

/**
 * Reason code penolakan. Seluruhnya berasal dari
 * `docs/evidence/P0-03/PATH-CASE-MATRIX.md`; tidak ada kosakata baru di sini.
 */
export const ALASAN_TOLAK = {
  /** Sidecar hilang, korup, bentuknya salah, versinya tidak sah, atau isinya
   *  bertentangan dengan dirinya sendiri. Bukti tidak bisa dibaca sebagai vonis. */
  BUKTI_TIDAK_SAH: "EVIDENCE_INVALID",
  /** Sidecar ada dan sah, tapi bytes gambarnya tidak ada di storage. */
  BERKAS_HILANG: "REF_MISSING",
  /** sha256 di sidecar tidak sama dengan sha256 bytes yang tersimpan. */
  HASH_BEDA: "REF_HASH_MISMATCH",
  /** Diperiksa, dan memang materi promosi. STATUS FOTO, bukan penolakan produk. */
  PROMOSI: "REF_PROMOTIONAL",
  /** Bukti JUJUR menyatakan dirinya belum diperiksa (biner klasifikasi tidak
   *  tersedia/gagal). Bisa direvalidasi — berbeda dari bukti rusak. */
  BELUM_DIPERIKSA: "CLASSIFIER_FAILED",
} as const;

export type AlasanTolak = (typeof ALASAN_TOLAK)[keyof typeof ALASAN_TOLAK];

/**
 * Sub-kategori untuk `EVIDENCE_INVALID`, dipakai AUDIT — bukan gerbang.
 *
 * Gerbangnya tidak peduli bedanya: bukti tidak sah adalah bukti tidak sah.
 * Audit legacy peduli sekali, karena tindakannya berbeda per sebab —
 * sidecar HILANG bisa diterbitkan ulang dari bytes yang masih ada, sidecar
 * KORUP menandakan storage bermasalah, dan VERSI yang tidak cocok berarti
 * seluruh angkatan bukti perlu direvalidasi. Menghitung semuanya sebagai satu
 * angka membuat keputusan itu mustahil diambil.
 *
 * Opsional: penolakan selain EVIDENCE_INVALID sudah punya kode tingkat atas
 * yang cukup spesifik.
 */
export const RINCI_TOLAK = {
  SIDECAR_HILANG: "SIDECAR_MISSING",
  SIDECAR_KORUP: "SIDECAR_CORRUPT",
  BENTUK_SALAH: "SIDECAR_SCHEMA",
  VERSI_TIDAK_COCOK: "SIDECAR_VERSION",
  BERTENTANGAN: "SIDECAR_CONTRADICTORY",
} as const;

export type RinciTolak = (typeof RINCI_TOLAK)[keyof typeof RINCI_TOLAK];

/** Identitas byte yang tersetujui — bukan sekadar nama berkas. */
export interface ReferensiTersetujui {
  rel: string;
  /** sha256 bytes yang BENAR-BENAR tersimpan, sudah diverifikasi ulang. */
  sha256: string;
  /** Revisi aturan yang menerbitkan bukti ini. */
  versiBukti: number;
}

export interface ReferensiDitolak {
  rel: string;
  alasan: AlasanTolak;
  /** Bisa dibaca manusia; dipakai pemanggil untuk pesan yang bisa ditindaklanjuti. */
  pesan: string;
  /** Sub-kategori untuk EVIDENCE_INVALID. Dipakai audit, tidak dipakai gerbang. */
  rinci?: RinciTolak;
}

export interface HasilResolusiReferensi {
  /**
   * Referensi utama, atau `null` kalau tidak ada satu pun yang sah.
   *
   * Sengaja entri PERTAMA dari `tersetujui`, bukan nilai yang dihitung
   * terpisah: dua sumber kebenaran untuk "referensi utama" adalah cara
   * divergensi W1/W2 lahir kembali lewat pintu belakang.
   */
  utama: ReferensiTersetujui | null;
  tersetujui: ReferensiTersetujui[];
  ditolak: ReferensiDitolak[];
}

const HEX64 = /^[0-9a-f]{64}$/;

const JENIS_SAH: readonly JenisGambar[] = ["product_photo", "promotional_graphic", "belum_diperiksa"];

/** Bentuk sidecar yang sudah lolos pemeriksaan tipe. */
interface SidecarSah {
  sha256: string;
  jenis: JenisGambar;
  layakReferensi: boolean;
  rasioAreaTeks: number;
  jumlahKata: number;
  alasan: string;
  versiBukti: number;
}

/**
 * Pemeriksaan BENTUK, bukan sekadar keberadaan field.
 *
 * `JSON.parse` lalu `as MetaGambar` adalah cara sidecar yang tipenya salah
 * dibaca 180 derajat terbalik dari isinya sendiri: string `"false"` itu TRUTHY
 * di JavaScript, jadi `if (meta.layakReferensi)` membaca bukti yang berkata
 * "tidak layak" sebagai "layak". Setiap field karena itu diperiksa tipenya, dan
 * angka-angkanya diperiksa DOMAIN-nya: rasio luas tidak bisa negatif dan tidak
 * bisa melebihi 1; cacahan kata tidak bisa negatif dan tidak bisa pecahan.
 */
function periksaBentuk(
  nilai: unknown
): { ok: true; sidecar: SidecarSah } | { ok: false; sebab: string; rinci: RinciTolak } {
  if (typeof nilai !== "object" || nilai === null) return { ok: false, sebab: "sidecar bukan objek", rinci: RINCI_TOLAK.BENTUK_SALAH };
  const m = nilai as Record<string, unknown>;

  if (typeof m.sha256 !== "string" || !HEX64.test(m.sha256)) {
    return { ok: false, sebab: "sha256 bukan digest sha256 (64 hex)", rinci: RINCI_TOLAK.BENTUK_SALAH };
  }
  if (typeof m.jenis !== "string" || !JENIS_SAH.includes(m.jenis as JenisGambar)) {
    return { ok: false, sebab: `jenis "${String(m.jenis)}" di luar nilai yang dikenal`, rinci: RINCI_TOLAK.BENTUK_SALAH };
  }
  if (typeof m.layakReferensi !== "boolean") {
    return { ok: false, sebab: "layakReferensi bukan boolean", rinci: RINCI_TOLAK.BENTUK_SALAH };
  }
  if (typeof m.rasioAreaTeks !== "number" || !Number.isFinite(m.rasioAreaTeks) || m.rasioAreaTeks < 0 || m.rasioAreaTeks > 1) {
    return { ok: false, sebab: "rasioAreaTeks bukan angka di rentang 0..1", rinci: RINCI_TOLAK.BENTUK_SALAH };
  }
  if (typeof m.jumlahKata !== "number" || !Number.isInteger(m.jumlahKata) || m.jumlahKata < 0) {
    return { ok: false, sebab: "jumlahKata bukan cacahan (integer >= 0)", rinci: RINCI_TOLAK.BENTUK_SALAH };
  }
  if (typeof m.alasan !== "string") {
    return { ok: false, sebab: "alasan bukan string", rinci: RINCI_TOLAK.BENTUK_SALAH };
  }
  // Integer, dan HARUS sama persis dengan revisi aturan yang berlaku. Bukan
  // `>=`: bukti dari aturan lain — lebih lama MAUPUN lebih baru — tidak boleh
  // dinilai dengan aturan yang berlaku sekarang.
  if (typeof m.versiBukti !== "number" || !Number.isInteger(m.versiBukti)) {
    return { ok: false, sebab: "versiBukti bukan integer", rinci: RINCI_TOLAK.BENTUK_SALAH };
  }
  // HANYA DI SINI SIDECAR_VERSION. Sampai baris ini `versiBukti` sudah terbukti
  // integer, jadi yang tersisa memang ketidakcocokan REVISI — bukan kegagalan
  // bentuk. Bedanya menentukan tindakan pemulihan: bukti yang versinya tidak
  // cocok bisa direvalidasi seangkatan, sementara bukti yang bentuknya rusak
  // harus diperiksa satu per satu.
  //
  // Versi pertama menurunkan kategori ini dari TEKS pesan
  // (`sebab.startsWith("versiBukti")`), jadi versiBukti bertipe string, pecahan,
  // atau null — semuanya kegagalan BENTUK — ikut dilaporkan sebagai
  // ketidakcocokan versi. Kategori yang dipakai mengambil keputusan tidak boleh
  // diturunkan dari kalimat.
  if (m.versiBukti !== KEBIJAKAN_KLASIFIKASI.versiBukti) {
    return {
      ok: false,
      sebab: `versiBukti ${m.versiBukti} bukan revisi aturan yang berlaku (${KEBIJAKAN_KLASIFIKASI.versiBukti})`,
      rinci: RINCI_TOLAK.VERSI_TIDAK_COCOK,
    };
  }
  return { ok: true, sidecar: m as unknown as SidecarSah };
}

/**
 * Pemeriksaan KONSISTENSI — bukti wajib cocok dengan aturan yang menerbitkannya.
 *
 * Bentuk yang sah belum berarti isi yang masuk akal. Metrik bukan hiasan:
 * metriklah yang MENENTUKAN vonis di `klasifikasiGambar`. Sidecar yang
 * metriknya membantah vonisnya sendiri tidak mungkin keluar dari classifier
 * revisi ini — ia ditulis pihak lain, dan tidak ada satu pun fieldnya yang bisa
 * dipercaya.
 *
 * Contoh yang bukan hipotetis: blok `catch` lama `saveProductImages` menulis
 * `{jenis: "promotional_graphic", rasioAreaTeks: 0, jumlahKata: 0}` setiap kali
 * biner klasifikasi tidak ada. Metriknya di bawah ambang, vonisnya promosi —
 * mustahil menurut aturan, dan memang begitu: itu KEGAGALAN yang menyamar jadi
 * vonis. Sekarang bentuk itu ditolak, dan penggantinya `belum_diperiksa`.
 */
function periksaKonsistensi(s: SidecarSah): string | null {
  const promosiMenurutMetrik =
    s.rasioAreaTeks >= KEBIJAKAN_KLASIFIKASI.ambangRasio || s.jumlahKata >= KEBIJAKAN_KLASIFIKASI.ambangKata;

  if (s.jenis === "belum_diperiksa") {
    // Metriknya memang tidak bermakna — tidak ada pengukuran yang terjadi. Yang
    // wajib: ia tidak boleh mengaku layak. Kalau layak, berarti ia sudah
    // diperiksa, dan vonisnya membantah statusnya sendiri.
    return s.layakReferensi ? 'jenis "belum_diperiksa" tapi layakReferensi true' : null;
  }
  if (s.jenis === "product_photo") {
    if (!s.layakReferensi) return 'jenis "product_photo" tapi layakReferensi false';
    if (promosiMenurutMetrik) {
      return (
        `jenis "product_photo" tapi metriknya promosi menurut aturan v${KEBIJAKAN_KLASIFIKASI.versiBukti} ` +
        `(rasio ${s.rasioAreaTeks} >= ${KEBIJAKAN_KLASIFIKASI.ambangRasio} atau kata ${s.jumlahKata} >= ${KEBIJAKAN_KLASIFIKASI.ambangKata})`
      );
    }
    return null;
  }
  // promotional_graphic
  if (s.layakReferensi) return 'jenis "promotional_graphic" tapi layakReferensi true';
  if (!promosiMenurutMetrik) {
    return (
      `jenis "promotional_graphic" tapi kedua metriknya di BAWAH ambang aturan v${KEBIJAKAN_KLASIFIKASI.versiBukti} ` +
      `(rasio ${s.rasioAreaTeks} < ${KEBIJAKAN_KLASIFIKASI.ambangRasio} dan kata ${s.jumlahKata} < ${KEBIJAKAN_KLASIFIKASI.ambangKata}) ` +
      "— vonis ini mustahil dihasilkan classifier, jadi ia kegagalan yang menyamar"
    );
  }
  return null;
}

const sha256 = (b: Buffer) => crypto.createHash("sha256").update(b).digest("hex");

/**
 * Menilai SATU gambar. Mengembalikan entri tersetujui atau alasan penolakan.
 *
 * Urutan pemeriksaannya bukan selera: bukti diperiksa lebih dulu, baru
 * bytes-nya. Sidecar sah + bytes hilang adalah `REF_MISSING` (buktinya
 * baik-baik saja, berkasnya yang lenyap); sidecar hilang + bytes ada adalah
 * `EVIDENCE_INVALID` (berkasnya ada, tapi tidak ada yang menyatakan ia layak).
 * Dibalik, keduanya akan dilaporkan dengan alasan yang salah dan audit legacy
 * nanti tidak bisa membedakan keduanya.
 */
async function nilaiSatu(rel: string): Promise<ReferensiTersetujui | ReferensiDitolak> {
  const tolak = (alasan: AlasanTolak, pesan: string, rinci?: RinciTolak): ReferensiDitolak => ({
    rel,
    alasan,
    pesan,
    ...(rinci ? { rinci } : {}),
  });

  const objSidecar = await mediaStorage().get(relMeta(rel));
  if (!objSidecar) {
    return tolak(
      ALASAN_TOLAK.BUKTI_TIDAK_SAH,
      `Tidak ada bukti kelayakan untuk ${rel}. Foto ini belum pernah diperiksa, jadi ia dikarantina.`,
      RINCI_TOLAK.SIDECAR_HILANG
    );
  }

  let mentah: unknown;
  try {
    mentah = JSON.parse(objSidecar.body.toString("utf8"));
  } catch {
    return tolak(
      ALASAN_TOLAK.BUKTI_TIDAK_SAH,
      `Bukti kelayakan ${rel} rusak dan tidak bisa dibaca.`,
      RINCI_TOLAK.SIDECAR_KORUP
    );
  }

  const bentuk = periksaBentuk(mentah);
  if (!bentuk.ok) {
    return tolak(
      ALASAN_TOLAK.BUKTI_TIDAK_SAH,
      `Bukti kelayakan ${rel} tidak sah: ${bentuk.sebab}.`,
      bentuk.rinci
    );
  }
  const sidecar = bentuk.sidecar;

  const bantahan = periksaKonsistensi(sidecar);
  if (bantahan) {
    return tolak(
      ALASAN_TOLAK.BUKTI_TIDAK_SAH,
      `Bukti kelayakan ${rel} bertentangan dengan dirinya sendiri: ${bantahan}.`,
      RINCI_TOLAK.BERTENTANGAN
    );
  }

  const objBerkas = await mediaStorage().get(rel);
  if (!objBerkas) {
    return tolak(ALASAN_TOLAK.BERKAS_HILANG, `Berkas ${rel} tidak ada di storage padahal buktinya ada.`);
  }

  const sha = sha256(objBerkas.body);
  if (sha !== sidecar.sha256) {
    return tolak(
      ALASAN_TOLAK.HASH_BEDA,
      `Isi ${rel} sudah berubah sejak diperiksa (bukti ${sidecar.sha256.slice(0, 12)}…, isi ${sha.slice(0, 12)}…).`
    );
  }

  if (sidecar.jenis === "belum_diperiksa") {
    return tolak(
      ALASAN_TOLAK.BELUM_DIPERIKSA,
      `${rel} belum bisa diperiksa: ${sidecar.alasan} Ia menunggu revalidasi, bukan ditolak.`
    );
  }
  if (!sidecar.layakReferensi) {
    return tolak(ALASAN_TOLAK.PROMOSI, sidecar.alasan);
  }

  return { rel, sha256: sha, versiBukti: sidecar.versiBukti };
}

const adalahDitolak = (x: ReferensiTersetujui | ReferensiDitolak): x is ReferensiDitolak =>
  "alasan" in x;

/**
 * Referensi tersetujui untuk satu daftar foto produk, apa adanya urutannya.
 *
 * Urutan masukan dipertahankan untuk yang LOLOS — jadi "foto pertama yang sah"
 * tetap jadi utama, dan penjual masih bisa mengatur prioritas dengan urutan
 * unggah. Yang berubah: posisi tidak lagi bisa mengalahkan bukti.
 */
export async function resolveApprovedReference(rels: string[]): Promise<HasilResolusiReferensi> {
  const tersetujui: ReferensiTersetujui[] = [];
  const ditolak: ReferensiDitolak[] = [];

  for (const rel of rels) {
    const hasil = await nilaiSatu(rel);
    if (adalahDitolak(hasil)) ditolak.push(hasil);
    else tersetujui.push(hasil);
  }

  return { utama: tersetujui[0] ?? null, tersetujui, ditolak };
}

/**
 * Pesan siap-tampil ketika TIDAK ADA referensi tersetujui.
 *
 * Ada di sini, bukan di masing-masing worker, karena dua worker yang menyusun
 * pesannya sendiri akan menjelaskan hal yang sama dengan dua cara berbeda —
 * dan pengguna yang sama bisa mendapat penjelasan berbeda hanya karena
 * job-nya kebetulan jalan di jalur yang berbeda.
 *
 * Alasan per foto ikut dibawa, bukan diringkas jadi "tidak ada foto yang
 * layak": pengguna yang fotonya ditolak karena banner butuh tindakan berbeda
 * dari yang fotonya belum bisa diperiksa, dan operator yang membaca log butuh
 * bedanya untuk mengaudit.
 */
export function pesanTanpaReferensi(hasil: HasilResolusiReferensi): string {
  if (hasil.ditolak.length === 0) {
    return "Produk ini belum punya foto yang bisa dipakai jadi acuan video.";
  }
  const rincian = hasil.ditolak.map((d) => `${d.rel} [${d.alasan}]: ${d.pesan}`).join(" | ");
  return `Tidak ada foto produk yang bisa dipakai jadi acuan video. ${rincian}`;
}

/**
 * Memastikan BYTES YANG BENAR-BENAR AKAN DIKIRIM sama dengan yang disetujui.
 *
 * Temuan Reviewer 21 Agu, dan celahnya nyata: resolver memverifikasi bytes
 * lewat `get()` lalu mengembalikan sha256-nya, tapi worker membuang hash itu
 * dan `materialize()` MENGAMBIL OBJEKNYA LAGI. Di R2 itu GET kedua ke jaringan.
 * Kalau objeknya berubah di antara dua pembacaan — ditimpa unggahan lain, race
 * dengan penghapusan, replikasi yang belum konsisten — provider menerima bytes
 * yang TIDAK PERNAH disetujui siapa pun, dan seluruh rantai bukti di atasnya
 * jadi hiasan.
 *
 * Jendelanya kecil, tapi konsekuensinya persis yang gelombang ini ada untuk
 * mencegahnya: bahan yang salah sampai ke model, dan baru ketahuan sesudah
 * dibayar.
 *
 * Diperiksa di berkas HASIL materialize, bukan di objek storage-nya lagi:
 * berkas itulah yang dibaca provider, jadi ia satu-satunya yang pemeriksaannya
 * bermakna.
 */
export async function bytesTersetujuiCocok(absLokal: string, ref: ReferensiTersetujui): Promise<boolean> {
  const fsp = await import("node:fs/promises");
  try {
    const isi = await fsp.readFile(absLokal);
    return crypto.createHash("sha256").update(isi).digest("hex") === ref.sha256;
  } catch {
    return false;
  }
}

/** Versi yang MELEMPAR — dipakai untuk referensi utama, yang tidak boleh dilewati. */
export async function pastikanBytesTersetujui(absLokal: string, ref: ReferensiTersetujui): Promise<void> {
  if (await bytesTersetujuiCocok(absLokal, ref)) return;
  throw new Error(
    `REF_HASH_MISMATCH: isi ${ref.rel} berubah antara saat bukti diverifikasi dan saat bytes-nya ` +
      `diambil untuk dikirim (disetujui ${ref.sha256.slice(0, 12)}…). Job dihentikan sebelum ` +
      "langkah berbayar."
  );
}

/**
 * SNAPSHOT PRIVAT PER JOB dari bytes yang sudah disetujui.
 *
 * Kenapa memeriksa hash saja tidak cukup (temuan Reviewer 21 Agu):
 * `materialize()` mengembalikan path BERSAMA yang masih bisa berubah.
 * `FilesystemStorage` mengembalikan berkas storage kanoniknya sendiri;
 * `R2Storage` memakai cache bersama `.object-cache/<key>`. Put berikutnya,
 * materialize kedua atas kunci yang sama, atau job lain yang berjalan
 * bersamaan bisa MENIMPA path itu SESUDAH pemeriksaan hash tapi SEBELUM
 * person-safe/planner/provider membacanya. Pemeriksaan sekali di awal hanya
 * mempersempit jendelanya, tidak menutupnya.
 *
 * Yang menutupnya: menyalin bytes ke path yang hanya milik job ini, lalu
 * MEMVERIFIKASI SALINANNYA. Sesudah itu tidak ada penulis lain yang tahu path
 * tersebut, jadi yang diverifikasi dan yang dikirim dijamin berkas yang sama.
 *
 * Urutannya penting: salin DULU, hash SESUDAHNYA. Kalau sumbernya tertukar di
 * tengah penyalinan, hash salinannya tidak akan cocok dan job berhenti — yang
 * benar. Hash sumber lalu menyalin akan mengulang cacat yang sama.
 */
export async function ambilSnapshotTersetujui(
  absSumber: string,
  ref: ReferensiTersetujui,
  dirTujuan: string
): Promise<string> {
  const fsp = await import("node:fs/promises");
  const nodePath = await import("node:path");
  await fsp.mkdir(dirTujuan, { recursive: true });
  // Nama diturunkan dari sha256 yang disetujui: unik per bytes, dan dua job
  // yang memakai foto sama tidak saling menimpa dengan isi yang berbeda.
  const tujuan = nodePath.join(dirTujuan, `${ref.sha256}${nodePath.extname(ref.rel) || ""}`);
  await fsp.copyFile(absSumber, tujuan);
  if (!(await bytesTersetujuiCocok(tujuan, ref))) {
    throw new Error(
      `REF_HASH_MISMATCH: isi ${ref.rel} berubah saat disalin untuk dikirim ` +
        `(disetujui ${ref.sha256.slice(0, 12)}…). Job dihentikan sebelum langkah berbayar.`
    );
  }
  return tujuan;
}
