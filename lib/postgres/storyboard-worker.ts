/**
 * Prosesor antrean storyboard — menggenerate gambar per scene.
 *
 * Berjalan di container worker. Web hanya membuat baris dan mengantrekan;
 * lihat lib/storyboard-queue.ts untuk alasan pemisahannya.
 */
import { config } from "../config";
import { mediaStorage } from "../storage";
import { generateGambarStoryboard, SeedreamError } from "../media/seedream";
import { PgStoryboardRepository, type BarisScene } from "./storyboard";

/** Kunci objek gambar storyboard. Bukan di bawah prefiks job — storyboard bisa
 *  dihapus tanpa job pernah ada, dan sampahnya harus bisa ditemukan. */
export function kunciGambarStoryboard(storyboardId: string, idx: number, versi: number): string {
  return `storyboard/${storyboardId}/${idx}-v${versi}.jpg`;
}

async function gambarSatuScene(
  repo: PgStoryboardRepository,
  storyboardId: string,
  scene: BarisScene,
  fotoProduk: Buffer | null
): Promise<void> {
  const gambar = await generateGambarStoryboard({
    prompt: scene.prompt,
    startState: scene.start_state,
    // Scene yang WAJIB menahan produk tidak menerima acuannya: menyertakannya
    // di situ justru memunculkan produk di shot yang seharusnya belum
    // memperlihatkannya.
    fotoProduk: scene.withhold_product ? null : fotoProduk,
  });
  // Versi memakai regen_count supaya gambar lama TIDAK ditimpa. Browser sudah
  // memegang URL lama di cache; menulis ke kunci yang sama membuat kartu
  // menampilkan gambar lama setelah pengguna menekan "ganti" dan yakin fiturnya
  // rusak.
  const kunci = kunciGambarStoryboard(storyboardId, scene.idx, scene.regen_count);
  await mediaStorage().put(kunci, gambar.bytes, gambar.contentType);
  await repo.setImage(storyboardId, scene.idx, kunci);
}

/**
 * Bangun seluruh kartu, atau satu kartu bila `idx` diberikan.
 *
 * KEGAGALAN SEBAGIAN TIDAK MENGGAGALKAN SELURUHNYA. Kalau 2 dari 3 scene jadi,
 * storyboard tetap FAILED — tapi kartu yang berhasil tetap tersimpan, jadi
 * percobaan ulang hanya menggenerate yang kurang dan pengguna tidak menunggu
 * dari nol untuk kedua kalinya.
 */
export async function prosesStoryboard(storyboardId: string, idx?: number): Promise<void> {
  const repo = new PgStoryboardRepository(config.databaseUrl);
  try {
    const sb = await repo.get(storyboardId);
    if (!sb) return;
    // Storyboard yang sudah disetujui tidak boleh berubah: ia catatan apa yang
    // pengguna setujui saat uangnya ditahan.
    if (sb.status === "APPROVED") return;

    const semua = await repo.scenes(storyboardId);
    const target = idx === undefined
      // Yang SUDAH punya gambar dilewati — percobaan ulang tidak membayar dua
      // kali untuk kartu yang sudah jadi.
      ? semua.filter((s) => !s.image_key)
      : semua.filter((s) => s.idx === idx);

    if (target.length === 0) {
      await repo.setStatus(storyboardId, "READY", null);
      return;
    }

    if (idx === undefined) await repo.setStatus(storyboardId, "BUILDING", null);

    // Foto produk diambil SEKALI untuk seluruh storyboard, bukan per scene:
    // isinya sama dan materialize() menyentuh storage tiap kali dipanggil.
    let fotoProduk: Buffer | null = null;
    const kunciFoto = await repo.kunciFotoProduk(storyboardId);
    if (kunciFoto) {
      const obj = await mediaStorage().get(kunciFoto).catch(() => null);
      fotoProduk = obj?.body ?? null;
      if (!fotoProduk) console.warn(`[storyboard] ${storyboardId}: foto produk ${kunciFoto} tidak terbaca — kartu digambar tanpa acuan`);
    }

    const hasil = await Promise.allSettled(target.map((s) => gambarSatuScene(repo, storyboardId, s, fotoProduk)));
    const gagal = hasil.filter((h) => h.status === "rejected") as PromiseRejectedResult[];

    if (gagal.length > 0) {
      // Kuota dikembalikan bila yang gagal adalah permintaan ganti: pengguna
      // tidak boleh kehilangan jatah karena kesalahan kita.
      if (idx !== undefined) await repo.kembalikanKuotaRegen(storyboardId, idx);
      const sebab = gagal[0]!.reason;
      const pesan = sebab instanceof SeedreamError || sebab instanceof Error ? sebab.message : String(sebab);
      await repo.setStatus(storyboardId, "FAILED", pesan.slice(0, 500));
      throw sebab;
    }

    const setelah = await repo.scenes(storyboardId);
    await repo.setStatus(storyboardId, setelah.every((s) => s.image_key) ? "READY" : "BUILDING", null);
  } finally {
    await repo.close();
  }
}
