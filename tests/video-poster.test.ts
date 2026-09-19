// SETIAP VIDEO HARUS PUNYA GAMBAR DI BELAKANGNYA.
//
// ---------------------------------------------------------------------------
// APA YANG TERJADI
// ---------------------------------------------------------------------------
// Audit UI 19 Sep 2026: 20 tag <video> di aplikasi, NOL punya `poster`. Di
// browser penguji, kelimanya di /onboarding berhenti di readyState 0 — jadi
// yang dilihat pengunjung bukan contoh video melainkan kotak kosong setinggi
// 341px di hero halaman daftar, dan empat kotak abu di strip contohnya.
// /mulai, /bikin/jenis, dan /bikin/gaya sama saja.
//
// Berkasnya tidak hilang: semuanya melayani 200. Video memang tidak dijamin
// diputar — autoplay ditolak saat hemat daya, hemat data, atau jaringan
// lambat — dan tanpa poster tidak ada apa pun di belakangnya. Untuk produk
// yang menjual video, itu kehilangan satu-satunya bukti yang ia punya.
//
// ---------------------------------------------------------------------------
// YANG DIJAGA
// ---------------------------------------------------------------------------
// 1. Klip statis di public/ dipasang lewat <KlipContoh>, yang menurunkan
//    poster dari nama berkasnya — jadi tidak ada call site yang bisa lupa.
// 2. Setiap mp4 yang dirujuk kode benar-benar punya berkas posternya.
// 3. Video milik pengguna (URL bertanda tangan, tidak bisa punya poster
//    statis) memakai #t=0.1 supaya browser menggambar frame pertamanya.

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const AKAR = process.cwd();

function berkasTsx(dir: string, keluar: string[] = []): string[] {
  for (const e of fs.readdirSync(path.join(AKAR, dir), { withFileTypes: true })) {
    const rel = path.join(dir, e.name);
    if (e.isDirectory()) berkasTsx(rel, keluar);
    else if (e.name.endsWith(".tsx")) keluar.push(rel);
  }
  return keluar;
}

/** Semua tag <video ...> beserta isinya, dari seluruh app/. */
function tagVideo(): { berkas: string; tag: string }[] {
  const hasil: { berkas: string; tag: string }[] = [];
  for (const f of berkasTsx("app")) {
    const isi = fs.readFileSync(path.join(AKAR, f), "utf8");
    for (const m of isi.matchAll(/<video\b[\s\S]*?\/?>/g)) hasil.push({ berkas: f, tag: m[0] });
  }
  return hasil;
}

test("klip statis dari public/ dipasang lewat KlipContoh, bukan <video> telanjang", () => {
  // KlipContoh-lah yang memasang poster + penundaan unduh. <video> yang
  // menunjuk langsung ke /previews, /demo, atau /showcase berarti seseorang
  // melewatinya — dan poster hilang lagi tanpa satu pun kegagalan terlihat.
  const pelanggar = tagVideo()
    .filter((v) => /src=["'`]?\/(previews|demo|showcase)\//.test(v.tag))
    .map((v) => v.berkas);
  assert.deepEqual([...new Set(pelanggar)], [], "pakai <KlipContoh src=... /> untuk klip statis");
});

test("setiap mp4 yang dirujuk kode punya berkas posternya", () => {
  const dirujuk = new Set<string>();
  for (const f of berkasTsx("app")) {
    const isi = fs.readFileSync(path.join(AKAR, f), "utf8");
    for (const m of isi.matchAll(/["'`](\/(?:previews|demo|showcase)\/[a-z0-9-]+\.mp4)["'`]/g)) dirujuk.add(m[1]);
  }
  // Daftar template (lib/) ikut menunjuk berkas di folder yang sama.
  for (const f of ["lib/templates.ts", "lib/templates-kampanye.ts"]) {
    const p = path.join(AKAR, f);
    if (!fs.existsSync(p)) continue;
    for (const m of fs.readFileSync(p, "utf8").matchAll(/["'`](\/(?:previews|demo|showcase)\/[a-z0-9-]+\.mp4)["'`]/g)) dirujuk.add(m[1]);
  }
  assert.ok(dirujuk.size > 0, "tidak menemukan satu pun rujukan mp4 — pola pencariannya rusak");

  const hilang = [...dirujuk].filter((mp4) => {
    // Video yang berkasnya memang belum ada (template tanpa pratinjau) tidak
    // dituntut punya poster — yang dituntut: kalau videonya ada, posternya ada.
    if (!fs.existsSync(path.join(AKAR, "public", mp4))) return false;
    return !fs.existsSync(path.join(AKAR, "public", mp4.replace(/\.mp4$/, ".poster.webp")));
  });
  assert.deepEqual(hilang, [], "jalankan: npx tsx scripts/buat-poster.ts");
});

test("video milik pengguna menggambar frame pertamanya", () => {
  // URL bertanda tangan tidak bisa punya poster statis. Gantinya #t=0.1:
  // tanpa itu iOS Safari menggambar kotak HITAM sampai videonya disentuh.
  const pelanggar = tagVideo()
    .filter((v) => /src=\{/.test(v.tag) && !/\/(previews|demo|showcase)\//.test(v.tag))
    // `controls` = pemutar penuh yang memang dibuka sengaja; frame pertamanya
    // bukan pengganti gambar diam di daftar.
    .filter((v) => !/\bcontrols\b/.test(v.tag))
    .filter((v) => !/#t=0\.1/.test(v.tag) && !/poster=/.test(v.tag))
    .map((v) => v.berkas);
  assert.deepEqual([...new Set(pelanggar)], [], "tambahkan `#t=0.1` pada src (atau poster) agar frame pertama tergambar");
});
