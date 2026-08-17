// Format error standar API (SRS §6.1): {code, message_id, message_en, retryable}
// message_id WAJIB Bahasa Indonesia, actionable, dari daftar pesan FSD.

export interface ApiErrorBody {
  code: string;
  message_id: string;
  message_en: string;
  retryable: boolean;
}

export class ApiError extends Error {
  status: number;
  body: ApiErrorBody;
  constructor(status: number, body: ApiErrorBody) {
    super(body.message_en);
    this.status = status;
    this.body = body;
  }
}

export const ERR = {
  UNAUTHORIZED: () =>
    new ApiError(401, {
      code: "UNAUTHORIZED",
      message_id: "Kamu belum masuk. Login dulu ya, pakai nomor HP.",
      message_en: "Not authenticated. Please log in first.",
      retryable: false,
    }),
  SCRIPT_NOT_APPROVED: () =>
    new ApiError(422, {
      code: "SCRIPT_NOT_APPROVED",
      message_id:
        "Skripnya belum kamu setujui. Buka skripnya, cek dulu, terus tekan 'Setuju & Lanjut' ya.",
      message_en: "Script has not been approved by the user (HITL gate).",
      retryable: false,
    }),
  INSUFFICIENT_CREDITS: () =>
    new ApiError(402, {
      code: "INSUFFICIENT_CREDITS",
      message_id: "Kredit kamu habis. Draft-nya aman kok, tinggal top-up terus lanjut.",
      message_en: "Insufficient credits. Please top up to continue.",
      retryable: false,
    }),
  NOT_FOUND: (what = "Data") =>
    new ApiError(404, {
      code: "NOT_FOUND",
      message_id: `${what} tidak ketemu. Coba muat ulang halamannya ya.`,
      message_en: `${what} not found.`,
      retryable: false,
    }),
  BAD_REQUEST: (msgId: string, msgEn = "Bad request.") =>
    new ApiError(400, { code: "BAD_REQUEST", message_id: msgId, message_en: msgEn, retryable: false }),
  PAYLOAD_TOO_LARGE: (msgId: string, msgEn = "Payload too large.") =>
    new ApiError(413, { code: "PAYLOAD_TOO_LARGE", message_id: msgId, message_en: msgEn, retryable: false }),
  // 403, BUKAN 401: penggunanya sudah masuk dan identitasnya jelas — yang
  // kurang wewenangnya. Membalas 401 akan membuat klien mengira sesinya habis
  // lalu menyuruh login ulang, dan login ulang tidak akan pernah menolong.
  FORBIDDEN: (msgId: string, msgEn = "Forbidden.") =>
    new ApiError(403, { code: "FORBIDDEN", message_id: msgId, message_en: msgEn, retryable: false }),
  EXTRACT_UNSUPPORTED: () =>
    new ApiError(400, {
      code: "EXTRACT_UNSUPPORTED_URL",
      message_id:
        "Link-nya belum bisa kami baca. Cuma link TikTok Shop, Shopee, atau Tokopedia yang bisa. Isi manual aja ya, cuma 3 kolom kok.",
      message_en: "Unsupported or unsafe URL. Only whitelisted marketplace domains are allowed.",
      retryable: false,
    }),
  VALIDATION_FAILED: (detailId: string) =>
    new ApiError(422, {
      code: "SCRIPT_VALIDATION_FAILED",
      message_id: `Bagian ini perlu kamu ubah dulu ya — ${detailId}`,
      message_en: "Script failed validation.",
      retryable: false,
    }),
  JOB_NOT_READY: () =>
    new ApiError(409, {
      code: "JOB_NOT_READY",
      message_id:
        "Videonya lagi dibikin — sekitar beberapa menit lagi. Kamu boleh tutup halaman ini, nanti kami kabarin.",
      message_en: "Job is not finished yet.",
      retryable: true,
    }),
  RENDER_FAILED: () =>
    new ApiError(500, {
      code: "RENDER_FAILED",
      message_id:
        "Hasilnya belum bagus, jadi kredit kamu sudah kami balikin. Coba ganti fotonya ya.",
      message_en: "Render failed; credits were refunded.",
      retryable: true,
    }),
  FORBIDDEN_WORDS: () =>
    new ApiError(422, {
      code: "FORBIDDEN_WORDS",
      message_id:
        "Bagian ini perlu kamu ubah dulu ya — ada kata yang bisa bikin kena teguran TikTok.",
      message_en: "Script contains forbidden words (overclaim/medical).",
      retryable: false,
    }),
  INTERNAL: () =>
    new ApiError(500, {
      code: "INTERNAL",
      message_id: "Ada gangguan di sisi kami. Coba lagi sebentar lagi ya.",
      message_en: "Internal server error.",
      retryable: true,
    }),
};

export function errorResponse(err: unknown): Response {
  if (err instanceof ApiError) {
    return Response.json(err.body, { status: err.status });
  }
  console.error("[api] unexpected error:", err);
  const e = ERR.INTERNAL();
  return Response.json(e.body, { status: e.status });
}
