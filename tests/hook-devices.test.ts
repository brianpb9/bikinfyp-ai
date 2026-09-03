// Keragaman BENTUK hook, bukan keragaman kalimat.
//
// Vonis Brian 16 Agu 2026: "skripnya sama semua membosankan — ini masalah 99%".
// Angka "42 kalimat unik" yang sempat dipakai sebagai diagnosis sudah usang;
// saat diukur ulang, 132 hook katalog semuanya sudah berbeda satu sama lain.
//
// Ternyata jumlah kalimat memang bukan penyebabnya. Yang terukur: 61 dari 132
// hook (46%) tidak memakai SATU PUN perangkat retoris — cuma deskripsi datar
// "produk ini punya anu". Pertanyaan 11%, kontras harga 5%, segmentasi audiens
// 3%. Kalimat boleh 132 macam; kalau bentuknya seragam, penonton tetap merasa
// menonton video yang itu-itu juga.
//
// Tes ini menjaga PROPORSI, bukan menilai kalimat satu per satu. Sebuah hook
// boleh bagus tanpa masuk pola mana pun — yang berbahaya adalah kalau
// mayoritasnya begitu.

import { test } from "node:test";
import assert from "node:assert/strict";
import { memakaiPerangkat, panduanPerangkatHook, PENANDA_PERANGKAT, PERANGKAT_HOOK, POLA_PERANGKAT } from "../lib/script-engine/hook-devices";
import { TEMPLATE_COPY, TEMPLATE_COPY_CAPACITY } from "../lib/script-engine/template-copy";
import { stripDeliveryTags } from "../lib/script-engine/delivery-tags";
import { REGISTERS } from "../lib/script-engine/registers";

const ctx = {
  reg: REGISTERS.bestie, harga: "85 ribu", produk: "Serum Wardah", noun: "skincare",
  pain: "kusamnya", proof: "teksturnya", space: "Meja rias",
  aktivitas: "skincare-an malem", identitas: "tim glowing",
};

function semuaHook(): string[] {
  const out: string[] = [];
  for (const varian of Object.values(TEMPLATE_COPY)) {
    for (let i = 0; i < TEMPLATE_COPY_CAPACITY; i++) out.push(stripDeliveryTags(varian[i](ctx).hook));
  }
  return out;
}

/** Ambang sengaja longgar (25%, saat ini 20%) — tujuannya menahan kemunduran,
 *  bukan memaksa setiap kalimat masuk cetakan. Menaikkannya jadi 0% akan
 *  mendorong penulis menempelkan tanda tanya palsu supaya lolos, dan itu
 *  mengembalikan kebosanan lewat pintu belakang. */
const AMBANG_DATAR = 0.25;

test("mayoritas hook memakai perangkat retoris, bukan deskripsi datar", () => {
  const hooks = semuaHook();
  const datar = hooks.filter((h) => !memakaiPerangkat(h));
  const rasio = datar.length / hooks.length;
  assert.ok(
    rasio <= AMBANG_DATAR,
    `${datar.length}/${hooks.length} hook (${(rasio * 100).toFixed(0)}%) tanpa perangkat retoris, ambang ${AMBANG_DATAR * 100}%.\nContoh:\n${datar.slice(0, 5).map((d) => "  " + d).join("\n")}`
  );
});

// Satu perangkat yang dipakai 90% hook sama membosankannya dengan tidak ada
// perangkat sama sekali — cuma bentuk kebosanan yang berbeda.
test("tidak ada satu perangkat pun yang mendominasi katalog", () => {
  const hooks = semuaHook();
  for (const [nama, pola] of Object.entries(POLA_PERANGKAT)) {
    const n = hooks.filter((h) => pola.test(h)).length;
    assert.ok(n / hooks.length < 0.6, `perangkat "${nama}" dipakai ${n}/${hooks.length} hook — terlalu dominan`);
  }
});

// Pembuka adalah bagian yang paling terasa berulang buat penonton: dia
// mendengarnya di detik pertama, sebelum sempat menilai isinya.
test("tidak ada pembuka hook yang dipakai lebih dari lima kali", () => {
  const hitung = new Map<string, number>();
  for (const h of semuaHook()) {
    const pembuka = h.split(/\s+/).slice(0, 2).join(" ").toLowerCase().replace(/[^a-z ]/g, "");
    hitung.set(pembuka, (hitung.get(pembuka) ?? 0) + 1);
  }
  const berlebih = [...hitung.entries()].filter(([, n]) => n > 5);
  assert.deepEqual(berlebih, [], `pembuka terlalu sering: ${berlebih.map(([k, n]) => `"${k}" ${n}x`).join(", ")}`);
});

test("setiap perangkat mendokumentasikan kapan ia TIDAK cocok", () => {
  for (const p of PERANGKAT_HOOK) {
    assert.ok(p.hindari.length > 20, `${p.nama}: belum menyebut kapan perangkat ini tidak cocok`);
    assert.ok(p.cara.length > 20, `${p.nama}: mekanismenya belum dijelaskan`);
    // Contoh wajib benar-benar memakai perangkatnya sendiri.
    assert.ok(memakaiPerangkat(p.contoh(ctx)), `${p.nama}: contohnya sendiri tidak memakai perangkat apa pun`);
  }
});

// ---------------------------------------------------------------------------
// PANDUAN L-19 KE PENULIS — tidak boleh hanyut dari pengukurnya
// ---------------------------------------------------------------------------
//
// Terukur di produksi 3 Sep 2026: "Hook belum memakai perangkat retoris yang
// dikenali" muncul di SETIAP percobaan pada empat run berturut-turut, dan tiga
// di antaranya habis tanpa naskah. Sebabnya bukan hook yang lemah — L-19 tidak
// pernah sekali pun disampaikan ke penulis, jadi ia menebak bentuk yang kita
// ukur dengan regex.
//
// Panduan itu sekarang dikirim. Tes ini menjaga satu-satunya hal yang membuat
// panduan itu berguna: setiap penanda yang kita SURUH pakai harus benar-benar
// lolos memakaiPerangkat(). Panduan yang menyebut kata yang ditolak detektornya
// sendiri lebih buruk daripada tidak ada panduan — ia mengirim penulis ke arah
// yang salah dengan penuh keyakinan.

test("tiap penanda yang diajarkan ke penulis benar-benar lolos detektornya", () => {
  for (const [nama, penanda] of Object.entries(PENANDA_PERANGKAT)) {
    // Penandanya ditulis sebagai contoh berkutip; ambil isinya lalu uji satu per satu.
    const kata = [...penanda.matchAll(/"([^"]+)"/g)].map((m) => m[1]);
    if (nama === "pertanyaan") {
      assert.ok(memakaiPerangkat("Capek nggak sih ngurus ini terus?"), "tanda tanya harus dikenali");
      continue;
    }
    assert.ok(kata.length > 0, `penanda "${nama}" tidak menyebut satu kata pun yang bisa diuji`);
    for (const k of kata) {
      assert.ok(
        memakaiPerangkat(`Kalimat hook dengan ${k} di dalamnya`),
        `panduan menyuruh pakai "${k}" untuk perangkat "${nama}", tapi memakaiPerangkat() menolaknya`,
      );
    }
  }
});

test("panduan hook menyebut setiap perangkat yang diukur", () => {
  const panduan = panduanPerangkatHook();
  for (const nama of Object.keys(POLA_PERANGKAT)) {
    assert.ok(panduan.includes(nama), `perangkat "${nama}" diukur tapi tidak diajarkan`);
  }
});
