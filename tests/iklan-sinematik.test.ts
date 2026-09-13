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
const fs = await import("node:fs");
const { susunTimeline, buatAss } = await import("../lib/iklan/susun");
type NaskahIklan = import("../lib/iklan/naskah").NaskahIklan;
type ShotIklan = import("../lib/iklan/naskah").ShotIklan;

const UKURAN: ShotIklan["ukuran"][] = ["wide", "close_up", "medium", "macro", "insert"];

function naskahContoh(ubah: Partial<NaskahIklan> = {}): NaskahIklan {
  const shots: ShotIklan[] = Array.from({ length: 10 }, (_, i) => ({
    beat: i === 0 ? "HOOK" : i === 9 ? "LOCKUP" : i < 3 ? "KONTEKS" : i < 5 ? "REVEAL" : i < 8 ? "NILAI" : "BUKTI",
    durasi: i === 9 ? 4 : 3,
    ukuran: UKURAN[i % UKURAN.length],
    kamera: "slow push-in",
    visual_en: "a mechanic wipes his forehead beside an old motorbike engine",
    gerak_en: "he exhales and looks down",
    pemeran: i < 3 ? ["montir"] : [],
    produk: i === 9 ? "pahlawan" : i < 3 ? "tidak_tampil" : "jelas",
    vo: [0, 2, 4, 6, 8].includes(i) ? "Mesin yang dirawat bercerita tentang pemiliknya." : "",
    teks_layar: i === 5 ? "Bersih tanpa bongkar" : "",
  }));
  return {
    merek: "Faza Auto Care",
    nama_produk_pendek: "Engine Degreaser",
    ide_besar: "Mesin yang bersih mengembalikan rasa bangga.",
    alasan_hook: "Wajah lelah montir langsung dikenali.",
    tagline: "Rawat yang membawamu pulang.",
    gaya_visual_en: "warm late-afternoon light, shallow depth of field, teal-orange grade",
    suara_en: "male narrator, 35, warm and calm",
    pemeran: [{ id: "montir", deskripsi_en: "Indonesian man, 30s, short black hair, navy work shirt" }],
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

test("berkas ASS memuat teks kinetik per kata, subtitle VO, dan lockup merek + tagline + kontak", () => {
  const n = naskahContoh();
  const kalimat = [{ shot: 0, path: "a.wav", detik: 2.5 }, { shot: 9, path: "z.wav", detik: 2 }];
  const { slot, total } = susunTimeline(n, kalimat);
  const ass = buatAss(n, slot, kalimat, total, "WA 0812-0000-0000");
  assert.match(ass, /Style: Kinetik,Poppins SemiBold/);
  assert.match(ass, /\\t\(110,330,\\alpha&H00&\)\}TANPA/, "kata kedua teks kinetik tidak ditunda");
  assert.match(ass, /,Sub,,.*Mesin yang dirawat/);
  assert.match(ass, /,Merek,,.*FAZA AUTO CARE/);
  assert.match(ass, /,Tagline,,.*Rawat yang membawamu pulang\./);
  assert.match(ass, /,Kontak,,.*WA 0812-0000-0000/);
  // VO di shot LOCKUP tidak ditampilkan sebagai subtitle: lockup milik merek.
  assert.equal((ass.match(/,Sub,,/g) ?? []).length, 1);
});

test("hook tidak dibengkakkan lebih dulu: kalimat dipercepat, shot hanya diperpanjang ≤ 0,8 dtk", () => {
  // Render uji Faza: hook 3 dtk jadi 5 dtk. Kalimat 3,3 dtk di hook 3 dtk yang
  // langsung disusul kalimat berikutnya.
  const n = naskahContoh();
  n.shots[1].vo = "Kalimat kedua.";
  const kalimat = [{ shot: 0, path: "a.wav", detik: 3.3 }, { shot: 1, path: "b.wav", detik: 1.5 }];
  const { slot } = susunTimeline(n, kalimat);
  assert.ok((slot[0].voTempo ?? 1) > 1.001, "kalimat tidak dipercepat sebelum shot diperpanjang");
  assert.ok(slot[0].durasi <= n.shots[0].durasi + 0.8 + 1e-9, `hook jadi ${slot[0].durasi} dtk`);
  assert.ok(slot[0].voMulai! + 3.3 / slot[0].voTempo! <= slot[1].voMulai! - 0.1, "kalimat hook terpotong kalimat kedua");
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
