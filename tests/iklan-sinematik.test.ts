// IKLAN SINEMATIK — bagian yang bisa diuji tanpa membayar render.
//
// Standar: knowledge/rules/REFERENSI-IKLAN-SINEMATIK-v1.md (Brian, 14 Sep 2026).

import { test } from "node:test";
import assert from "node:assert/strict";

process.env.RACUN_NO_DOTENV = "1";
process.env.DB_PATH = `/tmp/racun-test-iklan-${process.pid}.db`;
process.env.STORAGE_DIR = `/tmp/racun-test-iklan-storage-${process.pid}`;

const { periksaNaskah } = await import("../lib/iklan/naskah");
const { adaPitaBlur } = await import("../lib/iklan/gerbang");
const R = await import("../lib/iklan/realitas");
const { promptKeyframe, negatifShot } = await import("../lib/iklan/keyframe");
const { promptGerak } = await import("../lib/iklan/klip");
const fs = await import("node:fs");
const { susunTimeline, buatAss, titikMelenceng, BATAS_BAWAH } = await import("../lib/iklan/susun");
type NaskahIklan = import("../lib/iklan/naskah").NaskahIklan;
type ShotIklan = import("../lib/iklan/naskah").ShotIklan;

const UKURAN: ShotIklan["ukuran"][] = ["wide", "close_up", "medium", "macro", "insert"];

function naskahContoh(ubah: Partial<NaskahIklan> = {}): NaskahIklan {
  const beat: ShotIklan["beat"][] = ["HOOK", "KONTEKS", "REVEAL", "BUKTI", "NILAI", "NILAI", "NILAI", "MAKNA", "MAKNA", "LOCKUP"];
  const durasi = [2, 3, 3, 3.5, 3, 3, 3, 3, 3, 4];
  const shots: ShotIklan[] = beat.map((b, i) => ({
    beat: b,
    durasi: durasi[i],
    ukuran: UKURAN[i % UKURAN.length],
    kamera: "slow push-in",
    visual_en: "a mechanic wipes his forehead beside an automatic scooter engine",
    gerak_en: "he exhales and looks down",
    aset: i < 3 ? ["montir", "skuter"] : [],
    produk: b === "LOCKUP" ? "pahlawan" : b === "REVEAL" ? "asli" : i < 2 ? "tidak_tampil" : "dipakai",
    transformasi_en: b === "BUKTI" ? "the same engine casing now clean bright silver" : "",
    hindari_en: ["engine inside the footboard", "motorcycle moving sideways", "helmet missing"],
    vo: ["Kerak tak hilang.", "Mesin terawat, perjalanan tenang.", "Mesin terawat, perjalanan tenang.", "", "Mesin terawat, perjalanan tenang.", "", "Mesin terawat, perjalanan tenang.", "", "Mesin terawat, perjalanan tenang.", "Mesin terawat, perjalanan tenang."][i],
    teks_layar: ["DILAP TAK HILANG", "", "PEMBERSIH KERAK|untuk mesin motor", "BERSIH", "", "SELA SEMPIT", "", "TENANG BERANGKAT", "", ""][i],
  }));
  return {
    merek: "Faza Auto Care",
    kategori_realitas: ["otomotif_motor"],
    klaim_sumber: ["Pembersih Kerak Mesin"],
    lafal: [{ tulisan: "Degreaser", ucapan: "di-gri-ser" }],
    nama_produk_pendek: "Engine Degreaser",
    ide_besar: "Mesin yang bersih mengembalikan rasa bangga.",
    alasan_hook: "Wajah lelah montir langsung dikenali.",
    tagline: "Rawat yang membawamu pulang.",
    ajakan: "Cari: Faza Engine Degreaser",
    gaya_visual_en: "bright morning light, shallow depth of field, clean natural grade",
    suara_en: "male narrator, 35, warm and calm",
    aset: [
      { id: "montir", jenis: "pemeran", deskripsi_en: "Indonesian man, 30s, short black hair, navy work shirt" },
      { id: "skuter", jenis: "properti", deskripsi_en: "white automatic scooter, 125cc, black seat" },
    ],
    shots,
    ...ubah,
  };
}

const produk = { nama: "Faza Engine Degreaser", merek: "Faza Engine Degreaser" };

test("naskah yang memenuhi standar lolos pemeriksaan", () => {
  assert.deepEqual(periksaNaskah(naskahContoh(), produk), []);
});

test("pola tiga video produksi 14 Sep ditolak: frasa keranjang, 'Eh', 'Sumpah'", () => {
  const n = naskahContoh();
  n.shots[2].vo = "Eh sumpah ini bagus, cek keranjang ya.";
  const galat = periksaNaskah(n, produk).join(" ");
  assert.match(galat, /"eh"/);
  assert.match(galat, /"sumpah"/);
  assert.match(galat, /"cek keranjang"/);
});

test("hook yang menyebut merek ditolak", () => {
  const n = naskahContoh();
  n.shots[0].vo = "Faza membersihkan mesinmu.";
  assert.match(periksaNaskah(n, produk).join(" "), /Hook menyebut nama produk/);
});

test("video pendek satu-dua shot ala afiliasi ditolak", () => {
  const n = naskahContoh({ shots: naskahContoh().shots.slice(7) });
  const galat = periksaNaskah(n, produk).join(" ");
  assert.match(galat, /Jumlah shot 3/);
  assert.match(galat, /Total durasi/);
  assert.match(galat, /HOOK/);
});

test("ukuran shot identik berurutan ditolak", () => {
  const n = naskahContoh();
  n.shots[4].ukuran = n.shots[3].ukuran;
  assert.match(periksaNaskah(n, produk).join(" "), /ukuran shot sama berurutan/);
});

test("timeline memperpanjang shot supaya kalimat VO tidak terpotong kalimat berikutnya", () => {
  const n = naskahContoh();
  // Kalimat di shot 1 panjangnya 5,2 dtk; kalimat berikutnya di shot 3 (indeks 2).
  const kalimat = [
    { shot: 0, path: "a.wav", detik: 5.2 },
    { shot: 2, path: "b.wav", detik: 2 },
    { shot: 4, path: "c.wav", detik: 2 },
    { shot: 6, path: "d.wav", detik: 2 },
    { shot: 8, path: "e.wav", detik: 2 },
  ];
  const { slot, total } = susunTimeline(n, kalimat);
  const akhirKalimat1 = slot[0].voMulai! + 5.2 / (slot[0].voTempo ?? 1);
  assert.ok(akhirKalimat1 <= slot[2].voMulai! - 0.1, `kalimat 1 berakhir ${akhirKalimat1} setelah kalimat 2 mulai ${slot[2].voMulai}`);
  assert.ok(slot.every((s) => s.durasi <= 5.75), "shot melebihi panjang klip 6 dtk");
  assert.ok(total >= 29 && total <= 37, `total ${total}`);
  // Shot tanpa suara yang tidak perlu diperpanjang tetap sesuai rencana.
  assert.equal(slot[5].durasi, 3);
});

test("kalimat yang tetap tidak muat dipercepat, maksimal 1,15x", () => {
  const n = naskahContoh();
  const kalimat = [{ shot: 0, path: "a.wav", detik: 14 }, { shot: 2, path: "b.wav", detik: 2 }];
  const { slot } = susunTimeline(n, kalimat);
  assert.ok((slot[0].voTempo ?? 1) <= 1.15 + 1e-9);
  assert.ok((slot[0].voTempo ?? 1) > 1);
});

test("berkas ASS: frasa kunci dua ketebalan, subtitle di atas zona aman, lockup lengkap dengan ajakan", () => {
  const n = naskahContoh();
  const kalimat = [{ shot: 0, path: "a.wav", detik: 1.2 }, { shot: 1, path: "b.wav", detik: 2 }, { shot: 9, path: "z.wav", detik: 2 }];
  const { slot, total } = susunTimeline(n, kalimat);
  const ass = buatAss({ naskah: n, slot, kalimat, total, kontak: "WA 0812-0000-0000" });
  assert.match(ass, /Style: Kunci,Poppins ExtraBold/);
  assert.match(ass, /,Kunci,,.*PEMBERSIH.*KERAK/);
  assert.match(ass, /,Dukung,,.*untuk.*mesin.*motor/, "teks pendukung tidak ditampilkan");
  // Hook tampil UTUH sejak frame 0 — tanpa animasi per kata.
  assert.match(ass, /Dialogue: 2,0:00:00\.00,[^\n]*Kunci,,0,0,0,,\{\\an5\\blur3\\pos\(360,\d+\)\}DILAP TAK HILANG/);
  // Shot BUKTI diberi label ilustrasi.
  assert.match(ass, /,Ilustrasi,,.*\}Ilustrasi/);
  // Subtitle berakhir tepat di batas aman bawah (MarginV dari bawah).
  assert.match(ass, new RegExp(`,Sub,,0,0,${1280 - BATAS_BAWAH},,.*Mesin terawat`));
  assert.ok(BATAS_BAWAH <= 1280 * 0.8, "subtitle masuk ke 20% bawah");
  assert.match(ass, /,Merek,,.*FAZA AUTO CARE/);
  assert.match(ass, /,NamaProduk,,.*Engine Degreaser/);
  assert.match(ass, /,Tagline,,.*Rawat yang membawamu pulang\./);
  assert.match(ass, /,Ajakan,,.*Cari: Faza Engine Degreaser/);
  assert.match(ass, /,Kontak,,.*WA 0812-0000-0000/);
  // Satu lapis teks: VO shot 1 bertabrakan dengan frasa hook → tidak jadi subtitle;
  // VO shot 2 (shot tanpa teks layar) tampil; VO lockup tidak pernah jadi subtitle.
  assert.equal((ass.match(/,Sub,,/g) ?? []).length, 1, `jumlah subtitle salah:\n${ass}`);
});

test("hook tidak dibengkakkan lebih dulu: kalimat dipercepat, shot hanya diperpanjang ≤ 0,8 dtk", () => {
  // Render uji Faza: hook 3 dtk jadi 5 dtk. Kalimat 2,3 dtk di hook 2 dtk yang
  // langsung disusul kalimat berikutnya.
  const n = naskahContoh();
  n.shots[1].vo = "Kalimat kedua.";
  const kalimat = [{ shot: 0, path: "a.wav", detik: 2.3 }, { shot: 1, path: "b.wav", detik: 1.5 }];
  const { slot } = susunTimeline(n, kalimat);
  assert.ok((slot[0].voTempo ?? 1) > 1.001, "kalimat tidak dipercepat sebelum shot diperpanjang");
  assert.ok(slot[0].durasi <= n.shots[0].durasi + 0.8 + 1e-9, `hook jadi ${slot[0].durasi} dtk`);
  assert.ok(slot[0].voMulai! + 2.3 / slot[0].voTempo! <= slot[1].voMulai! - 0.1, "kalimat hook terpotong kalimat kedua");
});

test("VO yang tidak muat sebelum VO berikutnya ditolak naskah (tempo narator 2,3 kata/dtk)", () => {
  const n = naskahContoh();
  n.shots[0].vo = "Di balik kerak yang menumpuk lama sekali, mesin kehilangan wujud aslinya.";
  n.shots[1].vo = "Kalimat berikutnya.";
  assert.match(periksaNaskah(n, produk).join(" "), /Shot 1: VO \d+ kata tidak muat/);
});

test("teks layar yang hanya spesifikasi ditolak", () => {
  const n = naskahContoh();
  n.shots[5].teks_layar = "250 ml";
  assert.match(periksaNaskah(n, produk).join(" "), /hanya spesifikasi/);
});

// Frame NYATA: dua dari video produksi yang berpita (9789aa55 kiri-kanan,
// 49286d9f atas-bawah), lima dari iklan uji Faza — termasuk dua makro berlatar
// gelap-bokeh yang dituduh detektor versi pertama.
test("detektor pita blur: menangkap pita nyata, tidak menuduh bokeh", async () => {
  const f = (n: string) => fs.readFileSync(new URL(`./fixtures/pita/${n}.jpg`, import.meta.url));
  for (const n of ["pita-lr", "pita-tb"]) assert.equal((await adaPitaBlur(f(n))).pita, true, `${n} lolos`);
  for (const n of ["bersih-kaos", "bokeh-01", "bokeh-06", "iklan-02", "iklan-12"]) {
    assert.equal((await adaPitaBlur(f(n))).pita, false, `${n} dituduh berpita`);
  }
});

test("naskah tanpa adegan bukti, hook tanpa teks, atau produk terlambat ditolak", () => {
  const n = naskahContoh();
  n.shots[3].beat = "NILAI";
  n.shots[3].transformasi_en = "";
  n.shots[0].teks_layar = "";
  n.shots[2].produk = "tidak_tampil";
  n.shots[3].produk = "tidak_tampil";
  const galat = periksaNaskah(n, produk).join(" ");
  assert.match(galat, /tepat satu shot BUKTI/);
  assert.match(galat, /HOOK wajib punya teks_layar/);
  assert.match(galat, /Produk baru terlihat di detik/);
  assert.match(galat, /tepat satu shot produk = asli/);
});

test("naskah yang hampir tanpa teks layar ditolak — iklan ditonton tanpa suara", () => {
  const n = naskahContoh();
  n.shots.forEach((s, i) => { if (i > 0) s.teks_layar = ""; });
  assert.match(periksaNaskah(n, produk).join(" "), /shot bertulisan; minimal separuh/);
});

test("frasa keranjang boleh di LOCKUP, tidak di shot lain", () => {
  const n = naskahContoh();
  n.shots[9].vo = "Sekarang ada di keranjang kuning.";
  assert.doesNotMatch(periksaNaskah(n, produk).join(" "), /keranjang kuning/);
  n.shots[4].vo = "Cek keranjang kuning.";
  assert.match(periksaNaskah(n, produk).join(" "), /Frasa terlarang dipakai di luar LOCKUP: "keranjang kuning"/);
});

test("klip yang melenceng ke adegan lain dipotong sebelum melenceng (profil nyata Faza)", () => {
  // Jarak grid warna per frame (6 fps) dari dua klip render uji Faza, 14 Sep 2026.
  const pushIn = [4, 3, 1, 0, 1, 3, 4, 6, 8, 10, 11, 13, 15, 17, 19, 20, 21, 22, 24, 25, 26, 28, 29, 31, 31, 32, 33, 33, 34, 34, 34, 35, 35, 35, 35, 35];
  const keGarasi = [16, 12, 8, 3, 8, 12, 14, 17, 22, 25, 28, 31, 35, 42, 49, 56, 65, 72, 81, 86, 86, 84, 83, 82, 81, 79, 74, 72, 73, 76, 77, 77, 76, 76, 76, 77];
  assert.equal(titikMelenceng(pushIn), null, "push-in makro dituduh melenceng");
  const t = titikMelenceng(keGarasi)!;
  assert.ok(t > 2 && t < 2.8, `titik melenceng ${t}`);
});

test("timeline tidak memakai klip melewati batas stabilnya", () => {
  const n = naskahContoh();
  const { slot } = susunTimeline(n, [], [undefined, 1.8]);
  assert.ok(slot[1].durasi <= 1.8 + 1e-9, `shot 2 memakai ${slot[1].durasi} dtk dari klip yang stabil 1,8 dtk`);
});

test("klaim tanpa dasar dari penjual ditolak (temuan review Faza v3)", () => {
  for (const kalimat of ["Kerak bertahun-tahun luntur.", "Standar bengkel di rumah.", "Kerak luruh sendiri.", "Dijamin bersih.", "Pembersih terbaik."]) {
    const n = naskahContoh();
    n.shots[4].vo = kalimat;
    assert.match(periksaNaskah(n, produk).join(" "), /Klaim berisiko/, `"${kalimat}" lolos`);
  }
  // Klaim yang ada di data penjual boleh.
  const n = naskahContoh();
  n.shots[4].vo = "Pembersih kerak mesin.";
  assert.doesNotMatch(periksaNaskah(n, produk).join(" "), /Klaim berisiko/);
});

test("shot kosong tanpa VO dan teks ditolak; harga penjual wajib di ajakan", () => {
  const n = naskahContoh();
  n.shots[5].teks_layar = "";
  n.shots[5].vo = "";
  const galat = periksaNaskah(n, { ...produk, harga_idr: 24900 }).join(" ");
  assert.match(galat, /Shot 6: shot kosong/);
  assert.match(galat, /Harga dari penjual wajib tampil di ajakan/);
});

// ── REALITAS (Brian 14 Sep 2026: "posisi mesin di dalam jok motor", "alur motor berjalan") ──

test("kategori realitas dikenali dari data produk", () => {
  assert.ok(R.tebakKategori("Faza Engine Degreaser pembersih kerak mesin motor").includes("otomotif_motor"));
  assert.ok(R.tebakKategori("BOUSH Shift kaos boxy oversize cotton combed").includes("fashion_pakaian"));
  assert.ok(R.tebakKategori("Speaker portable bluetooth karaoke 18 inch").includes("elektronik_audio"));
  assert.deepEqual(R.tebakKategori("barang misterius"), ["umum"]);
});

test("fakta motor menyebut letak mesin skuter yang benar dan melarang letak yang dihalusinasikan", () => {
  const f = R.faktaUntuk(["otomotif_motor"]);
  assert.match(f, /LOWER REAR/);
  assert.match(f, /NO engine in the flat footboard/);
  assert.match(f, /moves forward in the direction it faces/);
  const neg = R.negatifUntuk(["otomotif_motor"]);
  for (const h of ["engine inside the footboard", "engine under the seat", "motorcycle moving sideways or backwards", "rider without helmet"]) {
    assert.ok(neg.includes(h), `negative prompt tanpa "${h}"`);
  }
  assert.equal(new Set(neg).size, neg.length, "negative prompt berduplikat");
});

test("prompt gambar dan gerak membawa fakta dunia nyata + AVOID dari naskah, kategori, dan global", () => {
  const n = naskahContoh();
  const shot = n.shots[1];
  shot.hindari_en = ["rider standing on the footboard"];
  const pg = promptKeyframe(n, shot, { produk: false, aset: [] }, undefined, ["otomotif_motor"]);
  assert.match(pg, /REAL-WORLD FACTS/);
  assert.match(pg, /AVOID \(negative prompt\): rider standing on the footboard, /, "hindari dari naskah tidak didahulukan");
  assert.match(pg, /engine inside the footboard/);
  assert.match(pg, /extra fingers/);
  const pv = promptGerak(n, shot, ["otomotif_motor"]);
  assert.match(pv, /REAL-WORLD MOTION: .*forward/);
  assert.match(pv, /AVOID: rider standing on the footboard/);
  // Latar lockup/reveal wajib menolak produk dan orang.
  assert.ok(negatifShot(n.shots[9], ["otomotif_motor"]).includes("product"));
});

test("naskah tanpa negative prompt per shot ditolak", () => {
  const n = naskahContoh();
  n.shots[4].hindari_en = ["only one"];
  assert.match(periksaNaskah(n, produk).join(" "), /Shot 5: hindari_en/);
});
