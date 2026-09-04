/**
 * Email pembayaran — dikirim saat order dibuat dan saat pembayaran lunas.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KENAPA EMAIL, BUKAN CUKUP LAYAR
 * ────────────────────────────────────────────────────────────────────────────
 * Nomor Virtual Account hanya berguna kalau ia ADA saat orang membuka aplikasi
 * banknya — dan itu terjadi di ponsel lain, beberapa menit kemudian, setelah
 * tab kita ditutup. Menampilkannya di layar saja berarti menaruh nomor yang
 * dibutuhkan nanti di tempat yang sudah hilang saat dibutuhkan.
 *
 * ────────────────────────────────────────────────────────────────────────────
 * KEGAGALAN EMAIL TIDAK PERNAH MEMBATALKAN PEMBAYARAN
 * ────────────────────────────────────────────────────────────────────────────
 * Semua fungsi di sini menelan galatnya sendiri dan hanya mencatat ke log.
 * Order sudah terbentuk di Duitku sebelum email disusun; melempar di sini akan
 * membuat checkout yang SUDAH BERHASIL terlihat gagal di layar pembeli, dan
 * ia akan membayar dua kali.
 */

import { config } from "./config";
import { NAMA_PLATFORM_PANJANG } from "./identitas-platform";
import { hasEmailKey, isProduction } from "./email-otp";

const rupiah = (n: number) => `Rp${n.toLocaleString("id-ID")}`;

/** Pembungkus HTML yang sama untuk semua email pembayaran. */
function bungkus(judul: string, isi: string): string {
  return `
  <div style="font-family:system-ui,-apple-system,sans-serif;max-width:520px;margin:auto;padding:24px;color:#18181b">
    <h2 style="margin:0 0 4px;font-size:18px">${NAMA_PLATFORM_PANJANG}</h2>
    <h3 style="margin:0 0 16px;font-size:15px;color:#52525b;font-weight:500">${judul}</h3>
    ${isi}
    <hr style="border:0;border-top:1px solid #e4e4e7;margin:24px 0" />
    <p style="font-size:12px;color:#71717a;margin:0">
      Butuh bantuan? Balas email ini atau hubungi kami lewat WhatsApp
      +${config.supportWhatsapp}.
    </p>
  </div>`;
}

async function kirim(ke: string, subjek: string, html: string, jenis: string): Promise<void> {
  if (!hasEmailKey()) {
    // Di luar production, ketiadaan kunci adalah keadaan normal — cukup catat.
    if (!isProduction()) console.log(`[email-mock] ${jenis} untuk ${ke}: ${subjek}`);
    else console.error(`[email] ${jenis} TIDAK terkirim ke ${ke} — RESEND_API_KEY kosong`);
    return;
  }
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { authorization: `Bearer ${config.resendApiKey}`, "content-type": "application/json" },
      body: JSON.stringify({ from: config.resendFromEmail, to: [ke], subject: subjek, html }),
    });
    if (!res.ok) console.error(`[email] ${jenis} gagal HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
  } catch (err) {
    console.error(`[email] ${jenis} gagal terkirim:`, err);
  }
}

/* ── panduan per kanal ─────────────────────────────────────────────────── */

/**
 * Panduan bayar yang BERBEDA per kanal, bukan satu kalimat untuk semuanya.
 *
 * Orang yang menerima nomor VA butuh tahu ke bank mana, dan orang yang memilih
 * QRIS butuh tahu bahwa nomor VA memang tidak ada untuknya. Panduan generik
 * membuat keduanya ragu apakah mereka salah langkah.
 */
function panduan(namaKanal: string, vaNumber?: string, redirectUrl?: string): string {
  if (vaNumber) {
    return `
    <p style="margin:0 0 8px">Transfer ke <b>${namaKanal}</b> berikut:</p>
    <p style="font-size:24px;font-weight:700;letter-spacing:2px;margin:8px 0;padding:12px;background:#fafafa;border:1px solid #e4e4e7;border-radius:8px;text-align:center">${vaNumber}</p>
    <ol style="margin:12px 0;padding-left:18px;color:#3f3f46;font-size:14px;line-height:1.7">
      <li>Buka aplikasi mobile banking atau ATM.</li>
      <li>Pilih <b>Transfer → Virtual Account</b>.</li>
      <li>Masukkan nomor di atas, lalu pastikan nominalnya sama persis.</li>
      <li>Kredit masuk otomatis, biasanya dalam hitungan menit.</li>
    </ol>`;
  }
  return `
    <p style="margin:0 0 12px">Selesaikan pembayaran <b>${namaKanal}</b> lewat tautan di bawah, lalu scan kodenya dari aplikasi apa pun yang mendukung QRIS.</p>
    ${redirectUrl ? `<p style="margin:12px 0"><a href="${redirectUrl}" style="display:inline-block;background:#f59e0b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Buka halaman pembayaran</a></p>` : ""}
    <p style="font-size:13px;color:#71717a;margin:8px 0 0">Kredit masuk otomatis setelah pembayaran terkonfirmasi.</p>`;
}

/* ── email ─────────────────────────────────────────────────────────────── */

export async function emailOrderDibuat(opts: {
  ke: string;
  orderId: string;
  namaPaket: string;
  jumlahIdr: number;
  namaKanal: string;
  vaNumber?: string;
  redirectUrl?: string;
  kedaluwarsaMenit: number;
}): Promise<void> {
  const html = bungkus(
    "Tinggal satu langkah — selesaikan pembayaranmu",
    `
    <p style="margin:0 0 4px">Paket: <b>${opts.namaPaket}</b></p>
    <p style="margin:0 0 16px">Total: <b>${rupiah(opts.jumlahIdr)}</b></p>
    ${panduan(opts.namaKanal, opts.vaNumber, opts.redirectUrl)}
    <p style="font-size:13px;color:#71717a;margin:16px 0 0">
      Berlaku ${opts.kedaluwarsaMenit} menit. Nomor pesanan <code>${opts.orderId}</code> —
      sebutkan ini kalau kamu menghubungi kami.
    </p>`,
  );
  await kirim(opts.ke, `Selesaikan pembayaran ${rupiah(opts.jumlahIdr)} — ${NAMA_PLATFORM_PANJANG}`, html, "order-dibuat");
}

export async function emailPembayaranLunas(opts: {
  ke: string;
  orderId: string;
  namaPaket: string;
  jumlahIdr: number;
  saldoSesudah?: number;
}): Promise<void> {
  const html = bungkus(
    "Pembayaran diterima — kreditmu sudah masuk",
    `
    <p style="margin:0 0 4px">Paket: <b>${opts.namaPaket}</b></p>
    <p style="margin:0 0 16px">Dibayar: <b>${rupiah(opts.jumlahIdr)}</b></p>
    ${opts.saldoSesudah !== undefined ? `<p style="margin:0 0 16px">Saldo sekarang: <b>${rupiah(opts.saldoSesudah)}</b></p>` : ""}
    <p style="margin:16px 0"><a href="${config.appBaseUrl}/kredit" style="display:inline-block;background:#18181b;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:700">Mulai bikin video</a></p>
    <p style="font-size:13px;color:#71717a;margin:8px 0 0">Nomor pesanan <code>${opts.orderId}</code>.</p>`,
  );
  await kirim(opts.ke, `Pembayaran diterima — ${NAMA_PLATFORM_PANJANG}`, html, "pembayaran-lunas");
}
