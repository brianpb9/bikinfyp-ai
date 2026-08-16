/**
 * Operational admission gate.  Closing intake rejects only *new* POST /jobs
 * requests; queued/in-flight BullMQ jobs remain owned by the worker and can
 * drain safely.  It is deliberately an env-controlled, deploy-time switch:
 * no unprotected HTTP endpoint can change it.
 */
import { config } from "./config";
import { ApiError } from "./errors";

export type JobIntakeMode = "open" | "closed";

export function jobIntakeMode(value = config.jobIntakeMode): JobIntakeMode {
  if (value === "open" || value === "closed") return value;
  throw new Error("JOB_INTAKE_MODE harus bernilai open atau closed.");
}

/**
 * Migrasi yang menegakkan INVARIAN UANG. Selama salah satunya belum terpasang,
 * kode yang bergantung padanya berjalan tanpa jaring.
 *
 * 0030 memberi biaya regenerate jenis ledger sendiri (tanpanya biaya
 * regenerate merebut slot terminal job induk: capture final menyerah, refund
 * menolak, hold tertahan selamanya). 0031 memasang indeks unik yang membuat
 * capture/release ganda mustahil.
 *
 * Produksi sempat MENERIMA JOB BARU sementara keduanya masih pending, dan
 * health tetap 200 sehingga platform menganggap semuanya sehat. Menerima uang
 * dengan invarian yang belum ada adalah risiko yang tidak perlu diambil siapa
 * pun.
 */
export const MIGRASI_INVARIAN_UANG = [
  "0030_regen_ledger_type.sql",
  "0031_terminal_ledger_unique.sql",
];

/** Ada migrasi uang yang belum terpasang? */
export function invarianUangBelumTerpasang(pending: string[]): string[] {
  return MIGRASI_INVARIAN_UANG.filter((m) => pending.includes(m));
}

export function assertJobIntakeOpen(value = config.jobIntakeMode): void {
  if (jobIntakeMode(value) === "open") return;
  throw new ApiError(503, {
    code: "JOB_INTAKE_PAUSED",
    message_id: "Pembuatan video sedang dijeda sebentar untuk perawatan. Job yang sudah masuk tetap aman.",
    message_en: "New render jobs are temporarily paused for maintenance. Existing jobs continue to run.",
    retryable: true,
  });
}

/**
 * Tolak pekerjaan BERBAYAR selama invarian uang belum terpasang di database.
 *
 * Health boleh melaporkan; yang menentukan adalah penolakan di sini. Produksi
 * sempat terus menerima job berbayar sementara migrasi 0030/0031 masih pending
 * — kode baru berjalan di atas database yang belum punya jaringnya, dan tidak
 * ada satu pun sinyal karena health tetap 200.
 *
 * 503 + retryable: ini keadaan sementara yang HILANG SENDIRI begitu migrasinya
 * dipasang. Pengguna tidak perlu mengubah apa pun, cukup mencoba lagi nanti.
 */
export async function assertInvarianUangSiap(): Promise<void> {
  const { invarianUangTerpasang } = await import("./migrasi-status");

  // Memeriksa ARTEFAKNYA, bukan catatan migrasi.
  //
  // Versi pertama memakai pendingMigrations() dan itu fail-OPEN dalam dua cara
  // sekaligus: ia mengembalikan [] (= "aman") ketika runtime bukan PostgreSQL
  // atau DATABASE_URL kosong — sukses secara logis, sehingga try/catch tidak
  // pernah jalan — dan ia mempercayai isi schema_migrations, yaitu CATATAN,
  // bukan KENYATAAN. Baris migrasi yang tercatat sementara indeksnya hilang
  // tetap membuka intake.
  const status = await invarianUangTerpasang();
  if (status.siap) return;

  console.error(`[intake] DITOLAK — ${status.alasan}`);
  throw new ApiError(503, {
    code: "MONEY_INVARIANT_NOT_READY",
    message_id: "Pembuatan video dijeda sebentar sampai perawatan database selesai. Saldo dan video lamamu aman.",
    message_en: `Paid intake refused: ${status.alasan}`,
    retryable: true,
  });
}

/**
 * SATU gerbang untuk semua yang memakan uang.
 *
 * Sebelumnya tiap jalur memilih sendiri penjaganya, dan pilihannya tidak
 * pernah sama:
 *
 *   /api/jobs           maintenance + migrasi
 *   campaign/confirm    migrasi saja
 *   matrix              migrasi saja
 *   scene regenerate    tidak ada
 *   /api/promo/jobs     tidak ada
 *
 * Akibatnya health bisa mengumumkan intake "closed" sementara promo masih
 * menerima job dan regenerate masih memanggil provider — status yang memberi
 * rasa aman palsu justru lebih berbahaya daripada tidak punya status.
 *
 * Aturannya sekarang satu kalimat: apa pun yang MEMBUAT pekerjaan baru,
 * MEMANGGIL provider, MENAHAN saldo, atau MEMOTONG saldo memanggil ini.
 */
export async function assertPaidAdmission(): Promise<void> {
  assertJobIntakeOpen();
  await assertInvarianUangSiap();
}
