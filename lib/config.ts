import fs from "node:fs";
import path from "node:path";

// Muat .env.local secara manual agar skrip di luar Next (seed, tes, worker) ikut terbaca.
// Next.js memuatnya otomatis untuk route handler; di sini kita pastikan juga untuk proses lain.
function loadDotEnvLocal() {
  if (process.env.RACUN_NO_DOTENV === "1") return; // untuk tes yang mengontrol env sendiri
  try {
    const file = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(file)) return;
    for (const line of fs.readFileSync(file, "utf8").split("\n")) {
      const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
      if (!m || line.trim().startsWith("#")) continue;
      if (process.env[m[1]] === undefined) process.env[m[1]] = m[2];
    }
  } catch {
    /* abaikan — config punya default dev */
  }
}
loadDotEnvLocal();

function env(key: string, fallback: string): string {
  const v = process.env[key];
  return v === undefined || v === "" ? fallback : v;
}

export const config = {
  authSecret: env("AUTH_SECRET", "dev-secret-racun-ai-jangan-dipakai-produksi"),
  // Disiapkan pada checkpoint 1A. Adapter runtime masih SQLite hingga checkpoint 1C.
  databaseUrl: env("DATABASE_URL", ""),
  // Cutover is explicit and reversible.  SQLite remains available until the
  // PostgreSQL runtime has been proven in staging; production must select pg.
  dbRuntime: env("RACUN_DB_RUNTIME", process.env.NODE_ENV === "production" ? "postgres" : "sqlite"),
  // Antrean lintas-proses. `inline` dipertahankan hanya sebagai jalur rollback
  // SQLite lokal; `redis` wajib memakai endpoint Redis-compatible (Render KV).
  queueMode: env("RACUN_QUEUE_MODE", "inline"),
  redisUrl: env("REDIS_URL", ""),
  redisQueueName: env("REDIS_QUEUE_NAME", "racun-jobs"),
  workerConcurrency: parseInt(env("WORKER_CONCURRENCY", "1"), 10),
  dbPath: path.resolve(process.cwd(), env("DB_PATH", "./data/racun.db")),
  storageDir: path.resolve(process.cwd(), env("STORAGE_DIR", "./storage")),
  // Filesystem tetap tersedia sebagai rollback lokal. Pada deployment gunakan
  // R2/S3 dan jangan pernah menyajikan URL bucket secara langsung.
  storageMode: env("STORAGE_MODE", "filesystem"),
  r2Endpoint: env("R2_ENDPOINT", ""),
  r2Bucket: env("R2_BUCKET", ""),
  r2AccessKeyId: env("R2_ACCESS_KEY_ID", ""),
  r2SecretAccessKey: env("R2_SECRET_ACCESS_KEY", ""),
  r2Region: env("R2_REGION", "auto"),
  ffmpegPath: env("FFMPEG_PATH", "/opt/homebrew/bin/ffmpeg"),
  ffprobePath: env("FFPROBE_PATH", "/opt/homebrew/bin/ffprobe"),
  providerVideo: env("PROVIDER_VIDEO", "mock"),
  providerVoice: env("PROVIDER_VOICE", "mock"),
  llmApiKey: env("LLM_API_KEY", ""),
  // Saklar uji failover
  mockAFail: env("MOCK_A_FAIL", "0") === "1",
  mockVoiceAFail: env("MOCK_VOICE_A_FAIL", "0") === "1",
  // Kunci provider nyata (stub — throw ProviderNotConfigured bila kosong)
  byteplusApiKey: env("BYTEPLUS_ARK_API_KEY", ""),
  dashscopeApiKey: env("DASHSCOPE_API_KEY", ""),
  googleTtsApiKey: env("GOOGLE_TTS_API_KEY", ""),
  azureTtsKey: env("AZURE_TTS_KEY", ""),
  azureTtsRegion: env("AZURE_TTS_REGION", ""),
  // OTP WhatsApp (fonnte | watzap) — kosong = mode mock (kode ke log server)
  waOtpProvider: env("WA_OTP_PROVIDER", "fonnte"),
  fonnteApiKey: env("FONNTE_API_KEY", ""),
  watzapApiKey: env("WATZAP_API_KEY", ""),
  watzapNumberKey: env("WATZAP_NUMBER_KEY", ""),
  // OTP Email via Resend — kosong = mode mock (kode ke log server)
  resendApiKey: env("RESEND_API_KEY", ""),
  resendFromEmail: env("RESEND_FROM_EMAIL", "onboarding@resend.dev"),
  // Monitoring operasional berjalan di proses worker, tanpa vendor monitoring
  // tambahan. Penerima dipisahkan dari alamat pengirim agar alert tidak salah
  // kirim ke inbox/domain Resend default.
  operationalMonitoringEnabled: env("OPERATIONAL_MONITORING_ENABLED", "false") === "true",
  operationalAlertToEmail: env("OPERATIONAL_ALERT_TO_EMAIL", ""),
  operationalMonitoringIntervalMin: parseInt(env("OPERATIONAL_MONITORING_INTERVAL_MIN", "5"), 10),
  operationalAlertCooldownMin: parseInt(env("OPERATIONAL_ALERT_COOLDOWN_MIN", "60"), 10),
  operationalErrorWindowMin: parseInt(env("OPERATIONAL_ERROR_WINDOW_MIN", "60"), 10),
  operationalErrorMinJobs: parseInt(env("OPERATIONAL_ERROR_MIN_JOBS", "3"), 10),
  operationalErrorRatePercent: parseInt(env("OPERATIONAL_ERROR_RATE_PERCENT", "20"), 10),
  // Origin publik yang dikelola deploy, bukan Host dari request. Dipakai untuk
  // callback pembayaran agar webhook tidak bisa diarahkan oleh header klien.
  appBaseUrl: env("APP_BASE_URL", ""),
  // Midtrans — kosong = checkout 503 jelas
  midtransServerKey: env("MIDTRANS_SERVER_KEY", ""),
  midtransClientKey: env("MIDTRANS_CLIENT_KEY", ""),
  midtransIsProduction: env("MIDTRANS_IS_PRODUCTION", "false") === "true",
  // Jalur dev (dev-login, dev topup, webhook stub) — hanya non-production ATAU flag eksplisit
  allowDevLogin: env("ALLOW_DEV_LOGIN", "0") === "1",
  // Saklar operasional untuk menghentikan penerimaan render baru tanpa
  // menghentikan worker. Nilai selain open/closed ditolak pada boundary.
  jobIntakeMode: env("JOB_INTAKE_MODE", "open"),
  // OTP
  otpExpiryMin: 5,
  otpMaxAttempts: 5,
  otpRateLimitPer15Min: 3,
  // BytePlus ModelArk (docs: https://docs.byteplus.com/en/docs/ModelArk/Video_Generation_API)
  byteplusBaseUrl: env("BYTEPLUS_ARK_BASE_URL", "https://ark.ap-southeast.bytepluses.com/api/v3"),
  byteplusModel: env("BYTEPLUS_ARK_MODEL", "seedance-1-0-pro-fast-251015"), // 480p murah, i2v (lite sudah Retiring → 404)
  byteplusResolution: env("BYTEPLUS_ARK_RESOLUTION", "480p"),
  // Voice nyata
  googleTtsVoice: env("GOOGLE_TTS_VOICE", "id-ID-Chirp3-HD-Aoede"),
  azureTtsVoice: env("AZURE_TTS_VOICE", "id-ID-GadisNeural"),
  // Kurs & tarif (USD -> IDR)
  usdIdr: parseInt(env("USD_IDR", "16300"), 10),
  // TIER HARGA FINAL (BRD §5.2, 31 Jul 2026) — harga jual & COGS referensi per video
  tiers: {
    silent_caption: {
      priceIdr: 5000,
      cogsIdr: 2445,
      byteplusModel: env("BYTEPLUS_MODEL_SILENT", "seedance-1-0-pro-fast-251015"),
      resolution: "480p",
      generateAudio: false,
    },
    high_quality: {
      priceIdr: 12000,
      cogsIdr: 8802,
      byteplusModel: env("BYTEPLUS_MODEL_HQ", "dreamina-seedance-2-0-mini-260615"),
      resolution: "720p",
      generateAudio: true,
    },
    super_hq: {
      priceIdr: 49000,
      cogsIdr: 37164,
      byteplusModel: env("BYTEPLUS_MODEL_SUPER", "dreamina-seedance-2-0-260128"),
      resolution: "720p",
      generateAudio: true,
    },
  } as Record<
    string,
    { priceIdr: number; cogsIdr: number; byteplusModel: string; resolution: string; generateAudio: boolean }
  >,
  signupBonusIdr: 5000, // bonus user baru: cukup 1 video Senyap+Teks
  // Parameter bisnis
  signedUrlTtlSec: 3600, // SRS NF-SEC04: TTL <= 1 jam
  queuedTimeoutMin: 30, // BR-06.3: job QUEUED >30 menit -> FAILED + refund
  jobCostCredits: 1, // DEPRECATED (diganti harga tier) — dipertahankan untuk kompatibilitas
  mockVideoCostIdr: 2400, // biaya mock per video, setara 480p API langsung (BRD 5.3)
  // Batas waktu per state (menit) — render nyata bisa 4–45 mnt, jadi state render
  // diberi allowance panjang; QUEUED tetap 30 (antrian kita sendiri).
  stateTimeoutsMin: {
    QUEUED: parseInt(env("TIMEOUT_QUEUED_MIN", "30"), 10),
    GENERATING_VISUAL: parseInt(env("TIMEOUT_VISUAL_MIN", "90"), 10),
    GENERATING_VOICE: parseInt(env("TIMEOUT_VOICE_MIN", "30"), 10),
    COMPOSITING: parseInt(env("TIMEOUT_COMPOSITING_MIN", "20"), 10),
    QC_CHECK: parseInt(env("TIMEOUT_QC_MIN", "10"), 10),
    LABELING: parseInt(env("TIMEOUT_LABELING_MIN", "10"), 10),
  } as Record<string, number>,
};

export function ensureDirs() {
  for (const d of [
    path.dirname(config.dbPath),
    config.storageDir,
    path.join(config.storageDir, "uploads"),
    path.join(config.storageDir, "jobs"),
  ]) {
    fs.mkdirSync(d, { recursive: true });
  }
}
