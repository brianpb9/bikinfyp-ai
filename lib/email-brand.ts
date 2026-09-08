/**
 * Email siklus pendaftaran brand.
 *
 * ---------------------------------------------------------------------------
 * KENAPA ADA
 * ---------------------------------------------------------------------------
 * Layar /dashboard/menunggu berbunyi "Kami kabari lewat email begitu selesai",
 * dan pesan API mengulanginya. Sampai 8 Sep 2026 tidak ada satu baris kode pun
 * yang mengirim email itu: sistem cuma punya email OTP, order dibuat, dan
 * pembayaran lunas.
 *
 * Jadi brand yang mendaftar menunggu kabar yang tidak akan pernah datang, dan
 * satu-satunya cara ia tahu sudah disetujui adalah menebak lalu mencoba login
 * lagi. Janji yang tidak ditepati di layar pertama adalah cara termahal memulai
 * hubungan dengan pelanggan B2B.
 *
 * ---------------------------------------------------------------------------
 * KEGAGALAN EMAIL TIDAK PERNAH MEMBATALKAN PERSETUJUAN
 * ---------------------------------------------------------------------------
 * Sama seperti email pembayaran: fungsi di sini menelan galatnya sendiri.
 * Organisasi sudah berstatus active di database sebelum email disusun;
 * melempar di sini membuat persetujuan yang SUDAH BERHASIL terlihat gagal di
 * layar admin, dan admin akan menekan tombolnya lagi.
 */
import { config } from "./config";
import { NAMA_PLATFORM_PANJANG } from "./identitas-platform";
import { hasEmailKey, isProduction } from "./email-otp";

function bungkus(judul: string, isi: string): string {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;padding:24px;color:#18181b">
    <h2 style="margin:0 0 4px;font-size:18px">${NAMA_PLATFORM_PANJANG} <span style="color:#f59e0b">Brands</span></h2>
    <h3 style="margin:0 0 16px;font-size:15px;color:#52525b;font-weight:500">${judul}</h3>
    ${isi}
    <hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0" />
    <p style="font-size:12px;color:#71717a;margin:0">
      Butuh bantuan? Balas email ini atau hubungi kami lewat WhatsApp +${config.supportWhatsapp}.
    </p>
  </div>`;
}

async function kirim(ke: string, subjek: string, html: string, jenis: string): Promise<void> {
  if (!hasEmailKey()) {
    if (isProduction()) console.error(`[email] ${jenis} TIDAK terkirim ke ${ke} — RESEND_API_KEY kosong`);
    else console.log(`[email] ${jenis} (mock) untuk ${ke}: ${subjek}`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.resendFromEmail, to: [ke], subject: subjek, html }),
    });
    if (!res.ok) console.error(`[email] ${jenis} ditolak Resend (HTTP ${res.status}) untuk ${ke}`);
  } catch (err) {
    console.error(`[email] ${jenis} gagal terkirim:`, err);
  }
}

/** Brand disetujui — aksesnya sudah terbuka. */
export async function emailBrandDisetujui(opts: { ke: string; namaBrand: string; url: string }): Promise<void> {
  await kirim(
    opts.ke,
    `Pendaftaran ${opts.namaBrand} disetujui`,
    bungkus("Pendaftaranmu disetujui", `
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px">
        Halo, pendaftaran <b>${opts.namaBrand}</b> sudah kami tinjau dan <b>disetujui</b>.
        Kamu sudah bisa masuk ke dashboard.
      </p>
      <p style="margin:0 0 16px">
        <a href="${opts.url}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;
           padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600">Buka dashboard</a>
      </p>
      <p style="font-size:13px;line-height:1.6;color:#52525b;margin:0">
        Saldo token akun brand dimulai dari nol. Hubungi kami untuk pengisian token pertama —
        kami bantu sampai video pertamamu jadi.
      </p>`),
    "brand_disetujui"
  );
}

/** Brand ditangguhkan. Dikirim juga supaya orang tidak menemukan akses hilang
 *  tanpa penjelasan dan mengira sistemnya rusak. */
export async function emailBrandDitangguhkan(opts: { ke: string; namaBrand: string }): Promise<void> {
  await kirim(
    opts.ke,
    `Akses ${opts.namaBrand} ditangguhkan sementara`,
    bungkus("Akses ditangguhkan sementara", `
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px">
        Akses dashboard untuk <b>${opts.namaBrand}</b> kami tangguhkan sementara.
        Datamu tetap aman dan tidak ada yang dihapus.
      </p>
      <p style="font-size:13px;line-height:1.6;color:#52525b;margin:0">
        Balas email ini kalau menurutmu ini keliru — kami cek lagi.
      </p>`),
    "brand_ditangguhkan"
  );
}

/**
 * Jatah video masuk ke dompet organisasi.
 *
 * Menyebut JUMLAH VIDEO, bukan rupiah (Brian 9 Sep 2026). "5 video standard"
 * menjawab pertanyaan yang sebenarnya dipunyai penerimanya; "Rp75.000" memaksa
 * ia membagi sendiri dengan harga yang mungkin tidak ia hafal.
 */
export async function emailTokenMasuk(opts: {
  ke: string; namaBrand: string; jenis: string; jumlah: number;
  sisa: Record<string, number>; url: string;
}): Promise<void> {
  const rincian = Object.entries(opts.sisa)
    .filter(([, n]) => n > 0)
    .map(([j, n]) => `${n} video ${j}`)
    .join(" · ") || "belum ada sisa";
  await kirim(
    opts.ke,
    `${opts.jumlah} video ${opts.jenis} untuk ${opts.namaBrand}`,
    bungkus("Jatah video sudah masuk", `
      <p style="font-size:14px;line-height:1.6;margin:0 0 12px">
        Kami menambahkan <b>${opts.jumlah} video ${opts.jenis}</b> ke akun <b>${opts.namaBrand}</b>.
        Sisa sekarang: <b>${rincian}</b>.
      </p>
      <p style="margin:0">
        <a href="${opts.url}" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;
           padding:12px 20px;border-radius:12px;font-size:14px;font-weight:600">Mulai bikin video</a>
      </p>`),
    "brand_jatah_masuk"
  );
}
