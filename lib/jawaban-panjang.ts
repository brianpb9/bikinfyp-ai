/**
 * Jawaban JSON untuk pekerjaan yang LEBIH LAMA dari batas gerbang di depan kita.
 *
 * ---------------------------------------------------------------------------
 * MASALAHNYA
 * ---------------------------------------------------------------------------
 * Cloudflare memutus permintaan yang origin-nya belum menjawab dalam 100 detik
 * (galat 524). Batas itu TETAP di paket Free — bukan setelan yang bisa
 * dinaikkan, dan token DNS yang kita punya tidak bisa menyentuh setelan zona
 * sama sekali (diuji 6 Sep 2026: galat 9109 untuk baca, 10000 untuk tulis).
 *
 * Menulis dua naskah kampanye brand memakan 137-224 detik. Jadi setiap
 * permintaan generate berakhir 524 — dan yang paling berbahaya BUKAN galatnya:
 * pekerjaannya TETAP SELESAI di server. Pengguna melihat kegagalan, mengulang,
 * dan menghasilkan naskah duplikat yang sudah dibayar dua kali.
 *
 * ---------------------------------------------------------------------------
 * KENAPA CARA INI, BUKAN ANTREAN LATAR
 * ---------------------------------------------------------------------------
 * Batas 100 detik itu berlaku pada JEDA SEBELUM BYTE PERTAMA, bukan pada durasi
 * total. Begitu badan jawaban mulai mengalir, sambungannya dibiarkan hidup.
 *
 * Jadi jawabannya dikirim sebagai aliran: spasi kosong setiap beberapa detik
 * selama pekerjaan berjalan, lalu JSON-nya di ujung. Pemanggil TIDAK PERLU
 * DIUBAH SATU BARIS PUN — JSON.parse dan Response.json() sama-sama memaafkan
 * spasi di depan. Antrean latar menuntut endpoint status, penyimpanan keadaan,
 * dan perubahan di sisi klien; ini menyelesaikan hal yang sama tanpa satu pun
 * dari itu.
 *
 * Yang TIDAK diselesaikan cara ini: pengguna yang menutup tab tetap kehilangan
 * hasilnya. Kalau itu jadi masalah nyata, barulah antrean latar sepadan.
 */

/** Jeda antar denyut. Jauh di bawah 100 detik supaya ada ruang untuk lambatnya jaringan. */
export const JEDA_DENYUT_MS = 15_000;

export function jawabanPanjang<T>(kerja: () => Promise<T>, opsi: { jedaMs?: number } = {}): Response {
  const jeda = opsi.jedaMs ?? JEDA_DENYUT_MS;
  const enc = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      // Byte pertama dikirim SEKARANG, bukan setelah pekerjaan selesai. Inilah
      // yang membuat gerbang di depan berhenti menghitung mundur.
      controller.enqueue(enc.encode(" "));

      const denyut = setInterval(() => {
        // Spasi, bukan komentar atau karakter lain: apa pun selain ruang putih
        // di depan akan merusak JSON.parse di sisi pemanggil.
        try { controller.enqueue(enc.encode(" ")); } catch { /* aliran sudah ditutup */ }
      }, jeda);

      // SETIAP penulisan dijaga. Kalau pemanggil menutup sambungannya lebih
      // dulu — tab ditutup, jaringan putus, atau pembacanya dibatalkan —
      // controller sudah mati dan enqueue/close melempar. Tanpa penjagaan ini
      // lemparannya jadi penolakan yang tidak tertangani, dan pada worker Node
      // itu MENJATUHKAN PROSES, bukan cuma menggagalkan satu permintaan.
      const tutup = (badan: string) => {
        clearInterval(denyut);
        try {
          controller.enqueue(enc.encode(badan));
          controller.close();
        } catch {
          /* sambungan sudah ditutup pemanggil — tidak ada yang bisa dikirim */
        }
      };

      kerja()
        .then((hasil) => tutup("\n" + JSON.stringify(hasil)))
        .catch((err: unknown) => {
          // Galat pun dikirim sebagai JSON di badan yang sama. Status HTTP sudah
          // terlanjur 200 karena header dikirim di awal — itu harga yang dibayar
          // untuk tidak kena 524, dan pemanggil kita memang membaca `code` di
          // badan, bukan status HTTP-nya.
          const pesan = err instanceof Error ? err.message : String(err);
          const kode = (err as { code?: string } | null)?.code ?? "INTERNAL";
          const untukPengguna = (err as { message_id?: string } | null)?.message_id ?? null;
          tutup("\n" + JSON.stringify({
            code: kode,
            message_id: untukPengguna ?? "Prosesnya gagal di tengah jalan. Coba lagi ya.",
            message_en: pesan,
            retryable: true,
          }));
        });
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "application/json; charset=utf-8",
      // Denyut tidak boleh ditahan penyangga mana pun di jalan.
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}
