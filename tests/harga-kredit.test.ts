// HARGA, COGS, DAN KREDIT — dijaga karena satu angka salah di sini berarti
// menjual di bawah biaya selama berbulan-bulan tanpa ada yang tahu. Itu bukan
// hipotesis: sampai 26 Agu 2026 tier Rp12.000 melakukannya, dan penyebabnya
// tarif yang diturunkan dari asumsinya sendiri.

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-harga-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-harga-storage-${process.pid}`;

const H = await import("../lib/harga-kredit");
const { config } = await import("../lib/config");

test("KURS bayangan tidak boleh menyimpang dari config.usdIdr", () => {
  // harga-kredit.ts wajib bebas impor (dipakai komponen klien), jadi kursnya
  // ditulis ulang di sana. Yang menjaganya sinkron adalah test ini, bukan
  // kedisiplinan orang yang mengubah salah satunya.
  assert.equal(H.KURS_USD_IDR, config.usdIdr);
});

test("TARIF berasal dari tagihan, dan hitungannya bisa diulang", () => {
  const tagihanUsd = 1300;
  const tokenAkun = 295_026_776;
  const dihitung = tagihanUsd / (tokenAkun / 1_000_000);
  assert.ok(
    Math.abs(dihitung - H.TARIF_USD_PER_1M_TOKEN) < 0.01,
    `tarif tertulis $${H.TARIF_USD_PER_1M_TOKEN}/1M tapi tagihan menghasilkan $${dihitung.toFixed(4)}/1M`
  );
});

test("TARIF PUBLIK sudah terbantah dan tidak boleh dipakai lagi", () => {
  // $6,40 dan $10,70 adalah brosur. Tagihan membantahnya (ketinggian 1,5x dan
  // 2,4x). Keduanya pernah ada di MODEL_RATES.
  for (const brosur of [6.4, 10.7, 1.66, 3.51]) {
    assert.notEqual(H.TARIF_USD_PER_1M_TOKEN, brosur);
  }
});

test("COGS dihitung dari TOKEN, dan keempat angkanya sesuai tagihan", () => {
  assert.equal(H.cogsIdr("standar", 8), 12_456);
  assert.equal(H.cogsIdr("standar", 15), 23_355);
  assert.equal(H.cogsIdr("kunciWajah", 8), 24_877);
  assert.equal(H.cogsIdr("kunciWajah", 15), 46_645);
});

test("KUNCI WAJAH dua kali lipat biayanya — di durasi mana pun", () => {
  // Ini temuan yang membuat struktur tier lama keliru secara konsep: mode,
  // bukan model, yang menentukan biaya.
  for (const d of [4, 8, 15]) {
    const rasio = H.cogsIdr("kunciWajah", d) / H.cogsIdr("standar", d);
    assert.ok(rasio > 1.98 && rasio < 2.02, `durasi ${d} dtk: rasio ${rasio.toFixed(3)}, harusnya ~2x`);
  }
});

test("HARGA KREDIT sesuai daftar, dan TIDAK PERNAH di bawah COGS", () => {
  const berdasarLabel = Object.fromEntries(H.TARIF_RENDER.map((t) => [t.label, t.kredit]));
  assert.deepEqual(berdasarLabel, {
    "Standar 8 detik": 143,
    "Standar 15 detik": 267,
    "Kunci wajah 8 detik": 285,
    "Kunci wajah 15 detik": 534,
  });

  // Sifat yang sebenarnya dijaga, bukan cuma empat angka di atas: pembulatan
  // ke BAWAH akan menjual di bawah COGS pada kasus batas. Disapu lintas durasi.
  for (const mode of ["standar", "kunciWajah"] as const) {
    for (let d = 2; d <= 30; d++) {
      const cogs = H.cogsIdr(mode, d);
      const pendapatan = H.kreditKeIdr(H.biayaKredit(cogs));
      assert.ok(pendapatan >= cogs, `${mode} ${d} dtk: dijual Rp${pendapatan} di bawah COGS Rp${cogs}`);
    }
  }
});

test("PAKET: diskon volume HANYA lewat kredit bonus", () => {
  for (const p of H.PAKET_LANGGANAN) {
    assert.equal(p.kreditDasar, p.priceIdr / H.IDR_PER_KREDIT, `${p.label}: kredit dasar bukan harga/Rp250`);
    assert.equal(p.kreditDasar + p.kreditBonus, p.kreditTotal);
    assert.ok(p.kreditBonus >= 0, `${p.label}: bonus negatif`);
  }
  // Paket besar HARUS lebih murah per kredit secara efektif — kalau tidak,
  // tidak ada diskon sama sekali.
  const efektif = H.PAKET_LANGGANAN.map((p) => p.priceIdr / p.kreditTotal);
  for (let i = 1; i < efektif.length; i++) {
    assert.ok(efektif[i] < efektif[i - 1], "paket lebih besar tidak lebih murah per kredit");
  }
});

test("BIAYA RENDER satu angka untuk semua paket — margin tidak bocor di paket besar", () => {
  // Inilah alasan diskon dibuat dari bonus: biaya render tidak boleh
  // bergantung paket. Kalau harga per kredit yang diturunkan, angka di bawah
  // harus dihitung ulang per paket, dan paket terdalam akan menembus COGS.
  const terdalam = H.PAKET_LANGGANAN[H.PAKET_LANGGANAN.length - 1];
  const idrPerKreditEfektif = terdalam.priceIdr / terdalam.kreditTotal;
  for (const t of H.TARIF_RENDER) {
    const pendapatan = t.kredit * idrPerKreditEfektif;
    assert.ok(
      pendapatan > t.cogsIdr,
      `${terdalam.label} + ${t.label}: pendapatan Rp${Math.round(pendapatan)} <= COGS Rp${t.cogsIdr}`
    );
  }
});

test("TIER RUGI tidak bisa didiamkan — dua arah", () => {
  const rugi = Object.entries(config.tiers)
    .filter(([, v]) => v.priceIdr < v.cogsIdr)
    .map(([k]) => k);
  const belumSelesai = H.TIER_RUGI_DISADARI.filter((t) => !t.selesai).map((t) => t.tier);
  const sisaTercatat = H.HARGA_RUPIAH_BELUM_IKUT_KREDIT.map((r) => r.tier);

  // Harga rupiah yang di bawah COGS harus ada di SALAH SATU daftar: kerugian
  // yang masih terbuka, atau sisa jalur rupiah yang penjualannya sudah pindah
  // ke kredit. Menandai "selesai" saja TIDAK cukup untuk mengeluarkannya —
  // itu justru cara termudah membuat kerugian menghilang.
  for (const t of rugi) {
    assert.ok(
      belumSelesai.includes(t) || sisaTercatat.includes(t),
      `tier "${t}" dijual di bawah COGS tapi tidak terdaftar di mana pun — ` +
        "kerugian tidak boleh lolos tanpa keputusan tertulis"
    );
  }
  for (const t of belumSelesai) {
    assert.ok(
      rugi.includes(t),
      `tier "${t}" terdaftar rugi padahal sudah untung — tandai selesai atau hapus barisnya`
    );
  }

  // "SELESAI" ADALAH KLAIM, DAN KLAIM DIPERIKSA. Tanpa ini, kerugian bisa
  // ditutup dengan menambahkan satu kata alih-alih mengubah apa pun.
  //
  // Klaimnya di sini bukan "harganya sudah naik" melainkan "penjualannya
  // pindah ke kredit". Yang diperiksa: tier itu punya harga kredit yang
  // MEMENUHI target margin, DAN sisa harga rupiahnya tercatat terbuka —
  // bukan ikut dianggap beres.
  const sisaRupiah = new Map(H.HARGA_RUPIAH_BELUM_IKUT_KREDIT.map((r) => [r.tier, r]));
  for (const baris of H.TIER_RUGI_DISADARI) {
    if (!baris.selesai) continue;
    const tier = (config.tiers as Record<string, { priceIdr: number; cogsIdr: number }>)[baris.tier];
    assert.ok(tier, `tier "${baris.tier}" bertanda selesai tapi tidak ada di config`);

    const kredit = H.biayaKredit(tier.cogsIdr);
    const marginKredit = 1 - tier.cogsIdr / H.kreditKeIdr(kredit);
    assert.ok(
      marginKredit >= H.MARGIN_TARGET,
      `tier "${baris.tier}" bertanda SELESAI tapi harga kreditnya cuma bermargin ${(marginKredit * 100).toFixed(1)}%`
    );

    if (tier.priceIdr < tier.cogsIdr) {
      const sisa = sisaRupiah.get(baris.tier);
      assert.ok(
        sisa,
        `tier "${baris.tier}" bertanda SELESAI padahal harga rupiahnya Rp${tier.priceIdr} masih di bawah COGS ` +
          `Rp${tier.cogsIdr} dan sisanya tidak tercatat di HARGA_RUPIAH_BELUM_IKUT_KREDIT`
      );
      assert.equal(sisa.priceIdr, tier.priceIdr, `sisa rupiah "${baris.tier}" tidak lagi cocok dengan config`);
    }
    assert.match(baris.selesai.tanggal, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(baris.selesai.alasan.length > 40, "alasan penutupan wajib menjelaskan caranya, bukan menyatakan selesai");
  }
  for (const baris of H.TIER_RUGI_DISADARI) {
    assert.match(baris.sejak, /^\d{4}-\d{2}-\d{2}$/, "tanggal wajib, supaya umur keputusan tertunda kelihatan");
    assert.ok(baris.alasan.length > 40, "alasan wajib menjelaskan, bukan sekadar menandai");
  }
});

test("COGS config diturunkan dari tagihan, bukan diketik ulang", () => {
  assert.equal(config.tiers.high_quality.cogsIdr, H.cogsIdr("standar", 15));
  assert.equal(config.tiers.super_hq.cogsIdr, H.cogsIdr("kunciWajah", 15));
  // Angka BRD lama tidak boleh hidup lagi di jalur mana pun.
  assert.notEqual(config.tiers.high_quality.cogsIdr, 8802);
  assert.notEqual(config.tiers.super_hq.cogsIdr, 37164);
});

test("MARGIN 65% — alasannya diperiksa ulang, bukan dipercaya", () => {
  assert.equal(H.MARGIN_TARGET, 0.65);

  // Tabel keputusan di komentar MARGIN_TARGET dihitung ulang di sini. Kalau
  // seseorang menggeser targetnya, yang gagal bukan "konstanta berubah" —
  // melainkan alasan yang membuat 65% dipilih.
  const cogs8 = H.cogsIdr("standar", 8);
  const video = (m: number) => Math.floor(1000 / Math.ceil(cogs8 / (H.IDR_PER_KREDIT * (1 - m))));

  assert.equal(video(0.65), 6, "Starter tidak lagi dapat 6 video standar 8 detik");
  assert.equal(video(0.70), 5, "naik ke 70% harusnya memotong 1 dari 6 video");
  assert.equal(
    video(0.75), video(0.70),
    "75% harusnya TIDAK mengubah jumlah video — itu alasan pokok berhenti sebelum sana"
  );

  // Bantalan: tarif kita baru diketahui dari SATU tagihan.
  const naik20 = cogs8 * 1.2;
  const marginSetelahNaik = 1 - naik20 / (H.biayaKredit(cogs8) * H.IDR_PER_KREDIT);
  assert.ok(
    marginSetelahNaik > 0.55,
    `kenaikan tarif 20% menjatuhkan margin ke ${(marginSetelahNaik * 100).toFixed(1)}% — bantalannya hilang`
  );
});

test("TIER DI BAWAH TARGET MARGIN juga dijaga dua arah", () => {
  const dibawah = Object.entries(config.tiers)
    .filter(([, v]) => v.priceIdr > v.cogsIdr && 1 - v.cogsIdr / v.priceIdr < H.MARGIN_TARGET)
    .map(([k]) => k);
  const terdaftar = H.TIER_DI_BAWAH_TARGET_MARGIN.map((t) => t.tier);
  for (const t of dibawah) {
    assert.ok(terdaftar.includes(t), `tier "${t}" di bawah target margin tapi tidak terdaftar`);
  }
  for (const t of terdaftar) {
    assert.ok(dibawah.includes(t), `tier "${t}" terdaftar di bawah target padahal sudah memenuhi — hapus barisnya`);
  }
});

test("SISA HARGA RUPIAH dipatok, dan hilang sendiri kalau sudah beres", () => {
  // Angka Rp12.000 dipatok supaya perubahan diam-diam ketahuan — ke arah mana
  // pun. Dan begitu harga rupiahnya benar-benar disamakan dengan kredit,
  // barisnya WAJIB dihapus; kalau tidak, test ini yang mengingatkan.
  const tiers = config.tiers as Record<string, { priceIdr: number; cogsIdr: number }>;
  for (const sisa of H.HARGA_RUPIAH_BELUM_IKUT_KREDIT) {
    const tier = tiers[sisa.tier];
    assert.ok(tier, `sisa "${sisa.tier}" tidak ada di config`);
    assert.equal(sisa.priceIdr, tier.priceIdr, `sisa "${sisa.tier}" tidak cocok dengan config.tiers`);
    assert.ok(
      tier.priceIdr < H.kreditKeIdr(H.biayaKredit(tier.cogsIdr)),
      `sisa "${sisa.tier}" sudah setara harga kredit — hapus barisnya, jangan biarkan jadi arsip mati`
    );
    assert.ok(sisa.catatan.length > 40, "catatan wajib menyebut apa yang harus diputuskan");
  }
});
