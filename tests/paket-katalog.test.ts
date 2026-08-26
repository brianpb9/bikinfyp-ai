// KATALOG PAKET — satu sumber, dan dijaga tetap satu.
//
// Cacat nyata yang ditutup 26 Agu 2026: CreditPlans.tsx MENGIMPOR PAKET_TOKEN
// sekaligus menyimpan salinan harganya sendiri, dan yang dirender adalah
// salinannya. Jadi katalog "satu sumber" hanya dipakai mengisi harga_idr saat
// mengirim — pembeli melihat satu angka, sistem mencatat angka lain. Test
// pertama di bawah ada supaya itu tidak bisa terjadi lagi tanpa ketahuan.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-paket-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-paket-storage-${process.pid}`;

const { PAKET_TOKEN, paketById } = await import("../lib/paket-token");
const H = await import("../lib/harga-kredit");

const KOMPONEN = path.join(process.cwd(), "app/dashboard/_components/CreditPlans.tsx");

test("KOMPONEN HARGA tidak boleh memuat angka harga sendiri", () => {
  const src = fs.readFileSync(KOMPONEN, "utf8");
  // Buang komentar: catatan sejarah BOLEH menyebut angka lama, yang dilarang
  // adalah angka yang ikut dirender.
  const kode = src
    .split("\n")
    .filter((b) => !b.trim().startsWith("//") && !b.trim().startsWith("*") && !b.trim().startsWith("/*"))
    .join("\n");
  const angkaHarga = kode.match(/\b\d{1,3}_\d{3}\b/g) ?? [];
  assert.deepEqual(
    angkaHarga,
    [],
    `CreditPlans.tsx memuat literal harga ${angkaHarga.join(", ")} — layar dan katalog bisa berbeda lagi`
  );
  assert.match(kode, /PAKET_TOKEN/, "komponen tidak membaca katalog sama sekali");
});

test("setiap paket: rupiah ledger = kredit x Rp250", () => {
  for (const p of PAKET_TOKEN) {
    assert.equal(p.tokenIdr, H.kreditKeIdr(p.kredit), `${p.label}: tokenIdr tidak sepadan kreditnya`);
    assert.ok(p.kredit > 0 && Number.isInteger(p.kredit), `${p.label}: kredit bukan bilangan bulat positif`);
  }
});

test("DISKON hanya lewat bonus — harga per kredit dasar SATU angka untuk semua", () => {
  for (const p of PAKET_TOKEN) {
    const kreditDasar = p.kredit - p.kreditBonus;
    assert.equal(
      kreditDasar,
      p.priceIdr / H.IDR_PER_KREDIT,
      `${p.label}: kredit dasar tidak sama dengan harga/Rp${H.IDR_PER_KREDIT} — ` +
        "berarti harga per kredit diturunkan, dan biaya render harus dihitung ulang per paket"
    );
    assert.ok(p.kreditBonus >= 0, `${p.label}: bonus negatif`);
  }
});

test("LANGGANAN sama persis dengan PAKET_LANGGANAN, tidak diketik ulang", () => {
  const langganan = PAKET_TOKEN.filter((p) => p.jenis === "subscription");
  assert.equal(langganan.length, H.PAKET_LANGGANAN.length);
  for (const sumber of H.PAKET_LANGGANAN) {
    const p = paketById(sumber.id);
    assert.ok(p, `paket ${sumber.id} hilang dari katalog`);
    assert.equal(p.priceIdr, sumber.priceIdr);
    assert.equal(p.kredit, sumber.kreditTotal);
    assert.equal(p.hangusBulanan, true, "langganan wajib bertanda hangus bulanan");
  }
});

test("JANJI DI KARTU: Rp250.000 = 10 video 8 detik", () => {
  // Angka jual utama. Kalau ia bergeser, seluruh alasan pindah ke 8 detik
  // ikut bergeser dan kartunya menjanjikan sesuatu yang lain.
  const starter = paketById("starter");
  assert.ok(starter);
  assert.equal(starter.priceIdr, 250_000);
  assert.equal(H.jumlahVideo(starter.kredit, "standar", 8), 10);
  // Dan pembandingnya, yang jadi alasan pindah dari 15 detik:
  assert.equal(H.jumlahVideo(starter.kredit, "kunciWajah", 15), 2);
});

test("jumlahVideo membulatkan KE BAWAH — tidak menjanjikan video yang tak terbayar", () => {
  assert.equal(H.jumlahVideo(199, "standar", 8), 1);
  assert.equal(H.jumlahVideo(99, "standar", 8), 0);
});
