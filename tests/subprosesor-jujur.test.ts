import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

// Kebijakan privasi menjanjikan daftar pihak ketiga yang menerima data
// pengguna. Daftar itu sempat SALAH, bukan sekadar kurang lengkap: ia menyebut
// ElevenLabs sebagai pemroses suara sementara suara semua video sudah lama
// dihasilkan Google Gemini, dan tidak menyebut Gemini sama sekali padahal
// Gemini menerima foto produk dan isi halaman web toko.
//
// Tes ini tidak bisa membuktikan daftarnya lengkap secara hukum. Yang ia jaga
// sempit dan bisa diukur: kalau kode memanggil sebuah penyedia, nama penyedia
// itu HARUS muncul di halaman privasi.
//
// Setiap "jejak" di bawah diperiksa benar-benar cocok dengan kode (tes terakhir
// di berkas ini). Pola yang tidak pernah cocok membuat penjaganya lulus
// cuma-cuma — persis cara penjaga palsu lahir.

const akar = process.cwd();
const privasi = fs.readFileSync(path.join(akar, "app/legal/privacy/page.tsx"), "utf8");

function sumberKode(): string {
  const potongan: string[] = [];
  const telusuri = (d: string) => {
    for (const nama of fs.readdirSync(d)) {
      if (nama === "node_modules" || nama === "stubs") continue;
      const f = path.join(d, nama);
      if (fs.statSync(f).isDirectory()) telusuri(f);
      else if (f.endsWith(".ts")) potongan.push(fs.readFileSync(f, "utf8"));
    }
  };
  telusuri(path.join(akar, "lib"));
  return potongan.join("\n");
}

const kode = sumberKode();

// jejak = bukti bahwa kode benar-benar memanggil layanan itu (host API-nya),
// bukan sekadar menyebut namanya di komentar.
const PENYEDIA: { nama: string; jejak: RegExp; disebut: RegExp }[] = [
  { nama: "Google Gemini", jejak: /generativelanguage\.googleapis\.com/, disebut: /Gemini/ },
  { nama: "BytePlus ModelArk", jejak: /bytepluses\.com/, disebut: /BytePlus/ },
  { nama: "ElevenLabs", jejak: /api\.elevenlabs\.io/, disebut: /ElevenLabs/ },
  { nama: "Resend", jejak: /api\.resend\.com/, disebut: /Resend/ },
  { nama: "Cloudflare R2", jejak: /r2Endpoint/, disebut: /Cloudflare/ },
];

for (const p of PENYEDIA) {
  test(`privasi menyebut ${p.nama} selama kode masih memanggilnya`, () => {
    if (!p.jejak.test(kode)) return; // penyedia sudah dilepas — tidak wajib disebut
    assert.match(privasi, p.disebut, `${p.nama} dipanggil kode tapi tidak ada di kebijakan privasi`);
  });
}

test("privasi tidak lagi mengklaim ElevenLabs sebagai pemroses suara semua video", () => {
  assert.ok(
    !/ElevenLabs:<\/strong> teks skrip dikirim untuk menghasilkan suara AI \(voice-over\), khusus format VO\+Foto/.test(privasi),
    "klaim lama ini keliru sejak suara pindah ke Gemini pada 31 Jul 2026",
  );
});

test("privasi menyebutkan foto produk dan isi halaman web ikut dikirim ke Gemini", () => {
  const bagianGemini = privasi.split("Google (Gemini)")[1]?.split("</li>")[0] ?? "";
  assert.match(bagianGemini, /foto produk/i, "pengiriman foto produk ke Gemini harus disebut");
  assert.match(bagianGemini, /halaman web/i, "pengambilan isi halaman web untuk analisis brand harus disebut");
});

test("setiap jejak penyedia benar-benar cocok dengan kode", () => {
  const kosong = PENYEDIA.filter((p) => !p.jejak.test(kode)).map((p) => p.nama);
  assert.deepEqual(kosong, [], "pola ini tidak cocok apa pun — penjaganya lulus tanpa memeriksa apa-apa");
});
