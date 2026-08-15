// QC VISUAL — mata mesin untuk cacat yang hanya bisa dilihat.
//
// KENAPA ADA. Pada 2026-08-13 sebuah video 30 detik keluar dengan DUA
// perempuan dan EMPAT tangan di shot PENUTUP — hal terakhir yang dilihat
// penonton. Video itu LOLOS SEMUA QC yang ada dan sampai ke output. Ketahuan
// hanya karena saya kebetulan menontonnya.
//
// Sebabnya: QC-02 (silhouette) tidak pernah diimplementasi — komentarnya
// sendiri menulis "stub, butuh model CV". Selama itu stub, setiap cacat yang
// bentuknya "videonya valid tapi salah" akan lolos, dan yang menemukannya
// adalah brand yang membayar.
//
// Hari ini semua cacat besar ditemukan dengan MENONTON, bukan oleh tes. Lima
// bug struktural, nol ditemukan tes. Jarak menuju kualitas yang bisa
// dipertanggungjawabkan sebagian besar adalah membangun mata mesin, bukan
// menambah fitur.
//
// CARANYA: ambil beberapa frame dari video jadi, kirim ke model visi dengan
// pertanyaan TERSTRUKTUR, bukan "menurutmu bagus tidak". Pertanyaan terbuka
// menghasilkan jawaban yang menyenangkan; pertanyaan berupa hitungan
// menghasilkan angka yang bisa dibandingkan dengan aturan.
//
// BIAYA: beberapa frame per video, jauh di bawah satu render ulang. QC yang
// lebih mahal daripada cacat yang dicegahnya tidak layak dijalankan.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { config } from "../config";
import { runFfmpeg, probeDurationSec } from "./ffmpeg";

// Model TEKS-VISI, bukan model gambar. Percobaan pertama memakai model
// gambar dan timeout: itu model untuk MEMBUAT gambar, sedangkan tugas di sini
// MEMBACA gambar. Salah alat, bukan salah ukuran.
const MODEL = "gemini-flash-latest";
const ENDPOINT = "https://generativelanguage.googleapis.com/v1beta/models";

/** Berapa frame yang diperiksa per video, sebagai fraksi durasi.
 *
 *  DINAIKKAN 3 -> 8 pada 2026-08-14. Angka tiga dipilih dengan alasan hemat
 *  kuota, dan alasan itu tidak bertahan begitu dibandingkan dengan yang
 *  dijaganya: satu klip video berbiaya Rp2.771-8.313, sementara satu frame
 *  pemeriksaan berbiaya pecahan sen. Menghemat di sisi yang salah.
 *
 *  Biayanya nyata dan terukur: tvc-seharian tercatat "terbukti" dengan tiga
 *  frame, lalu pemeriksa rapat menemukan DUA PEREMPUAN BERWAJAH IDENTIK yang
 *  duduk persis di antara titik sampel. Untuk video 30 detik, tiga titik
 *  berarti 27 detik tidak pernah dilihat siapa pun.
 *
 *  Delapan titik menyebar rata dari 8% sampai 92%. Tidak dari detik 0 (masih
 *  transisi) dan tidak sampai 100% (frame terakhir sering hitam). 92% menjaga
 *  shot PENUTUP tetap terperiksa — cacat dua-orang yang pertama ada di sana.
 *
 *  Pemeriksa lokal tetap jauh lebih rapat (2 frame/detik) karena ia gratis;
 *  yang di sini adalah pemeriksa yang bisa menghitung TANGAN dan anatomi,
 *  sesuatu yang belum bisa dilakukan detektor lokal. */
export const POSISI_SAMPEL = [0.08, 0.2, 0.32, 0.45, 0.58, 0.7, 0.82, 0.92];

/** Jarak antar sampel dalam DETIK, bukan dalam fraksi durasi.
 *
 *  Delapan titik tetap membuat liputannya bergantung durasi: video 30 detik
 *  dapat satu sampel tiap 3,75 detik, yang 15 detik dapat tiap 1,9 detik.
 *  Lubangnya dua kali lebih lebar justru di video yang paling mahal dan paling
 *  panjang — kebalikan dari yang masuk akal.
 *
 *  2,5 detik dipilih karena cacat yang kita temui semuanya bertahan minimal
 *  satu shot penuh (shot terpendek kita 4 detik), jadi jarak ini menjamin
 *  setiap shot kena minimal satu sampel. */
const JARAK_SAMPEL_DETIK = 2.5;
/** Batas bawah dan atas, supaya video sangat pendek tetap diperiksa cukup dan
 *  video panjang tidak meledakkan kuota. */
const MIN_SAMPEL = 6;
const MAKS_SAMPEL = 14;

/** Titik sampel untuk durasi tertentu — merata, tidak dari detik 0 (masih
 *  transisi) dan tidak sampai ujung (frame terakhir sering hitam). */
export function posisiSampel(durasiDetik: number): number[] {
  const n = Math.max(MIN_SAMPEL, Math.min(MAKS_SAMPEL, Math.round(durasiDetik / JARAK_SAMPEL_DETIK)));
  return Array.from({ length: n }, (_, i) => 0.08 + ((0.92 - 0.08) * i) / (n - 1));
}

export interface TemuanFrame {
  /** Detik ke berapa frame ini diambil. */
  detik: number;
  /** Jumlah orang yang terlihat. 0 sah untuk shot tanpa orang.
   *  CATATAN: tangan tanpa wajah TETAP dihitung sebagai satu orang. */
  jumlahOrang: number;
  /** Berapa orang yang benar-benar JADI SUBJEK: tajam, di depan, atau
   *  berinteraksi dengan produk. INI yang dipakai memblokir.
   *
   *  Dipisah dari jumlahOrang setelah dua positif palsu berturut-turut
   *  2026-08-13: template "liputan event" (produk di depan, pengunjung buram di
   *  belakang) dan "waktu berhenti" (orang di pasar, pejalan kaki di latar)
   *  ditolak padahal keduanya justru persis seperti yang diminta. Orang di
   *  latar adalah PREMIS template itu, bukan cacat.
   *
   *  Cacat yang sesungguhnya tetap tertangkap: dua perempuan yang sama-sama
   *  di depan memegang botol dihitung dua subjek utama. */
  jumlahOrangUtama: number;
  /** Jumlah WAJAH yang terlihat. Dipisah dari jumlahOrang dengan sengaja:
   *  format hands_only melarang WAJAH, bukan melarang manusia — tangan yang
   *  memegang produk jelas milik seseorang. Menyamakan keduanya membuat QC
   *  menolak shot hands_only yang justru sempurna (terjadi 2026-08-13 pada
   *  racun-checkout: dua tangan memegang botol, tanpa wajah, ditolak). */
  jumlahWajah: number;
  /** Jumlah tangan manusia yang terlihat. */
  jumlahTangan: number;
  /** Ada tulisan yang tidak terbaca / huruf acak? */
  teksAcak: boolean;
  /** Ada anggota badan yang salah — jari berlebih, tangan tanpa pemilik,
   *  anggota badan berlipat. */
  anatomiRusak: boolean;
  /** Produk terlihat di frame ini? */
  produkTerlihat: boolean;
  /** Fisika PRODUK yang mustahil — cairan keluar bukan dari lubangnya, tutup
   *  masih terpasang saat menuang, cairan mengalir ke atas.
   *
   *  HANYA produk. Dinding jebol, atap runtuh, pintu didobrak, waktu membeku —
   *  semua itu perangkat kreatif yang DISENGAJA di template pattern-interrupt
   *  kita, dan beberapa di antaranya justru termasuk yang disetujui Brian.
   *  Pemeriksa yang menilai fisika lingkungan akan menolak template terbaik
   *  kita sendiri.
   *
   *  Ditambahkan setelah Brian menonton 33 video dan menyebut "cairan keluar
   *  ga dari ujung botol" sebagai salah satu dari tiga cacat utama. Nol dari
   *  12 check menanyakannya: semuanya memeriksa apakah gambarnya CACAT, tidak
   *  ada yang menanyakan apakah yang terjadi MASUK AKAL. */
  fisikaJanggal: boolean;
  /** Catatan singkat model, untuk ditunjukkan ke manusia saat gagal. */
  catatan: string;
}

export interface QcVisionInput {
  videoPath: string;
  /** Batas orang yang boleh tampil. 1 untuk format presenter tunggal, 2 untuk
   *  rute komedi. DIABAIKAN bila tanpaWajah — lihat di bawah. */
  maksOrang: number;
  /** Format hands_only: yang dilarang adalah WAJAH, bukan manusia. Tangan yang
   *  memegang produk tentu ada pemiliknya, jadi jumlah orang tidak diperiksa
   *  di format ini — yang diperiksa jumlah wajah (harus 0) dan jumlah tangan
   *  (satu orang). */
  tanpaWajah?: boolean;
}

export interface QcVisionResult {
  /** null = pemeriksaan tidak bisa dijalankan (kunci tidak ada, model gagal).
   *  BUKAN lulus — pemanggil wajib memperlakukannya sebagai "tidak diperiksa". */
  temuan: TemuanFrame[] | null;
  lolos: boolean;
  /** PENGHALANG — menolak video. Hanya yang OBJEKTIF dan bisa dihitung. */
  masalah: string[];
  /** PERINGATAN — dicatat, tidak menolak. Yang subjektif atau yang memang
   *  batasan model yang sudah kita ketahui. */
  peringatan: string[];
  /** Detik-detik yang menyebabkan penolakan.
   *
   *  Ada supaya pemanggil bisa MEMPERBAIKI, bukan cuma menolak: dari detiknya
   *  ketahuan shot mana yang cacat, dan shot itu saja yang perlu digenerate
   *  ulang. Tanpa ini, satu-satunya pilihan adalah menggagalkan seluruh job
   *  atau membayar ulang seluruh video. */
  detikGagal: number[];
}

const SKEMA = `Answer ONLY with a JSON object, no markdown fence:
{"jumlahOrang": <int>, "jumlahOrangUtama": <int>, "jumlahWajah": <int>, "jumlahTangan": <int>, "teksAcak": <bool>,
 "anatomiRusak": <bool>, "produkTerlihat": <bool>, "fisikaJanggal": <bool>, "catatan": "<max 15 words>"}

Definitions, be literal and count what you actually see:
- jumlahOrang: how many DISTINCT human beings are visible, including partly
  visible ones and reflections of a different person. A single person seen in
  a mirror alongside themselves counts as 2.
- jumlahOrangUtama: of those people, how many are actually the SUBJECT of the
  shot — sharply in focus, in the foreground, or touching/holding/using the
  product. People who are blurred background, passers-by, or crowd do NOT
  count here. A shot of one presenter in a busy street has jumlahOrang 5 but
  jumlahOrangUtama 1.
- jumlahWajah: how many human FACES are visible. A shot showing only hands or
  only a body from behind has 0 faces but is still 1 person. Count a face even
  if partly turned away, but not if it is fully out of frame.
- jumlahTangan: how many human hands are visible in total.
- teksAcak: true if any visible writing is malformed, misspelled, or
  unreadable gibberish (common on product labels).
- anatomiRusak: true if there are extra fingers, hands not attached to a
  visible arm, duplicated or bent-wrong limbs.
- produkTerlihat: true if a consumer product package is clearly visible.
- fisikaJanggal: judge ONLY the product container and its contents. Set true
  only for: liquid or cream emerging from somewhere other than the actual
  opening (through the side, the base, or thin air); the cap still sealed while
  product pours out; liquid flowing upward out of the container; the container
  passing through a hand or surface.
  IGNORE EVERYTHING ELSE IN THE SCENE. Walls breaking, ceilings collapsing,
  doors bursting open, objects flying, time freezing, people appearing
  suddenly — these are deliberate creative devices in our ads and are NEVER
  fisikaJanggal. Also ignore stylistic choices, unusual lighting, and fast
  camera motion. If the impossible thing is not the product itself, answer
  false.`;

/** Jeda antar percobaan, dalam milidetik.
 *
 *  Percobaan ulang SEKETIKA tidak berguna untuk 503 "sedang kelebihan beban,
 *  coba lagi nanti" — dan itu persis yang terjadi 2026-08-14: dua template
 *  hands_only dirender dan dibayar, lalu QC-nya mengembalikan "tidak satu pun
 *  frame bisa diperiksa" karena Gemini menjawab 503 dua kali dalam sedetik.
 *
 *  Naik bertahap supaya gangguan sesaat lewat sendiri, tapi tetap berhenti
 *  sebelum satu job menggantung menit-menitan. */
const JEDA_MS = [0, 4_000, 15_000];

const tidur = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function periksaFrame(framePath: string, detik: number, percobaan = 0): Promise<TemuanFrame | null> {
  if (percobaan > 0) await tidur(JEDA_MS[Math.min(percobaan, JEDA_MS.length - 1)]);
  const buf = fs.readFileSync(framePath);
  let res: Response;
  try {
    res = await fetch(`${ENDPOINT}/${MODEL}:generateContent`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-goog-api-key": config.geminiApiKey },
      body: JSON.stringify({
        contents: [{ parts: [{ text: SKEMA }, { inline_data: { mime_type: "image/jpeg", data: buf.toString("base64") } }] }],
      }),
      signal: AbortSignal.timeout(45_000),
    });
  } catch {
    // Timeout dan galat jaringan MELEMPAR, tidak mengembalikan respons — jadi
    // tanpa tangkapan ini satu panggilan lambat membatalkan seluruh
    // pemeriksaan. Terjadi sungguhan saat menjalankan papan nilai: satu frame
    // timeout, empat video sisanya tidak pernah diperiksa.
    if (percobaan < JEDA_MS.length - 1) return periksaFrame(framePath, detik, percobaan + 1);
    return null;
  }
  if (!res.ok) {
    // 503/429 = layanan sibuk, bukan permintaan kita yang salah. Itu layak
    // ditunggu. Galat lain (400 permintaan salah, 403 kunci ditolak) tidak
    // akan membaik dengan menunggu — jangan buang waktu job untuk itu.
    const layakDiulang = res.status === 503 || res.status === 429 || res.status >= 500;
    if (layakDiulang && percobaan < JEDA_MS.length - 1) return periksaFrame(framePath, detik, percobaan + 1);
    return null;
  }
  const d = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const teks = d.candidates?.[0]?.content?.parts?.map((p) => p.text ?? "").join("") ?? "";
  const m = teks.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try {
    const j = JSON.parse(m[0]);
    return {
      detik,
      jumlahOrang: Number(j.jumlahOrang ?? 0),
      jumlahOrangUtama: Number(j.jumlahOrangUtama ?? j.jumlahOrang ?? 0),
      jumlahWajah: Number(j.jumlahWajah ?? 0),
      jumlahTangan: Number(j.jumlahTangan ?? 0),
      teksAcak: Boolean(j.teksAcak),
      anatomiRusak: Boolean(j.anatomiRusak),
      produkTerlihat: Boolean(j.produkTerlihat),
      fisikaJanggal: Boolean(j.fisikaJanggal),
      catatan: String(j.catatan ?? "").slice(0, 120),
    };
  } catch {
    if (percobaan < JEDA_MS.length - 1) return periksaFrame(framePath, detik, percobaan + 1);
    return null;
  }
}

/** Periksa video jadi. Tidak melempar — kegagalan pemeriksaan dilaporkan
 *  sebagai "tidak diperiksa", bukan sebagai lulus. */
export async function qcVision(input: QcVisionInput): Promise<QcVisionResult> {
  if (!config.geminiApiKey) return { temuan: null, lolos: false, masalah: ["QC visual tidak jalan: GEMINI_API_KEY belum di-set"], peringatan: [], detikGagal: [] };
  if (!fs.existsSync(input.videoPath)) return { temuan: null, lolos: false, masalah: ["berkas video tidak ada"], peringatan: [], detikGagal: [] };

  const durasi = await probeDurationSec(input.videoPath).catch(() => 0);
  if (!durasi) return { temuan: null, lolos: false, masalah: ["durasi video tidak terbaca"], peringatan: [], detikGagal: [] };

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qcvision-"));
  try {
    // Frame diperiksa BERSAMAAN, bukan satu per satu.
    //
    // Terukur 2026-08-16 pada video 15 detik: pemeriksaan berurutan memakan
    // 120,8 detik — 90% dari SELURUH waktu QC sebuah job. Sebabnya sederhana
    // dan memalukan: 8-12 panggilan model, masing-masing ~10-15 detik, saling
    // menunggu padahal tidak satu pun bergantung pada hasil yang lain.
    //
    // Ini biaya yang saya tambahkan sendiri saat menaikkan kerapatan sampel
    // dari 3 ke 8-12 frame, dan tidak pernah saya ukur sampai e2e menolak
    // jalan karena job-nya kelamaan. Menaikkan mutu memang membayar waktu —
    // yang salah adalah tidak menghitung berapa.
    //
    // Ekstraksi frame tetap berurutan: ffmpeg lokal cepat (milidetik) dan
    // menjalankan belasan proses ffmpeg sekaligus justru merebut CPU dari
    // compositing yang berjalan di worker yang sama.
    const berkasFrame: { f: string; detik: number }[] = [];
    for (const p of posisiSampel(durasi)) {
      const detik = Math.max(0.1, durasi * p);
      const f = path.join(dir, `f${Math.round(detik * 10)}.jpg`);
      await runFfmpeg(["-y", "-ss", String(detik), "-i", input.videoPath, "-frames:v", "1", "-q:v", "3", f]);
      if (fs.existsSync(f)) berkasFrame.push({ f, detik: Math.round(detik * 10) / 10 });
    }
    // Semua frame dikirim BERSAMAAN.
    //
    // Sempat dicoba bergelombang 4-sekaligus dengan hipotesis bahwa frame yang
    // hilang (5 dari 6) disebabkan pembatasan laju. Diukur, dan hipotesisnya
    // SALAH: bergelombang kembali ke 119,2 detik DAN tetap kehilangan frame
    // yang sama. Jadi 67 detik dibayar untuk nol perbaikan, dan hipotesisnya
    // dibuang — bukan dipertahankan karena terdengar masuk akal.
    //
    // Penyebab frame ke-6 belum diketahui dan sengaja tidak ditebak lagi.
    // Yang pasti: jumlahnya masih di atas ambang minimal, jadi vonisnya sah.
    const hasil = await Promise.all(berkasFrame.map(({ f, detik }) => periksaFrame(f, detik)));
    const temuan: TemuanFrame[] = hasil.filter((t): t is TemuanFrame => t !== null);
    if (temuan.length === 0) return { temuan: null, lolos: false, masalah: ["tidak satu pun frame bisa diperiksa"], peringatan: [], detikGagal: [] };

    // PENGHALANG vs PERINGATAN, dan pembagiannya diuji pada video nyata.
    //
    // Penghalang hanya yang OBJEKTIF DAN BISA DIHITUNG: jumlah orang, jumlah
    // tangan. Cacat yang menghancurkan video kemarin — dua perempuan di shot
    // penutup — masuk ke sini, dan memang tertangkap.
    //
    // Peringatan untuk yang SUBJEKTIF atau yang memang batasan model yang
    // sudah kita ketahui:
    //   - teksAcak menyala di HAMPIR SEMUA video kita, karena teks kecil di
    //     label memang tidak pernah dirender presisi oleh model video (sudah
    //     didokumentasikan di IDENTITY_INSTRUCTION). Menjadikannya penghalang
    //     berarti menolak seluruh keluaran.
    //   - anatomiRusak terbukti terlalu galak: ia menolak video yang saya
    //     periksa sendiri dan jarinya ambigu, tidak jelas rusak bagi penonton
    //     biasa. QC yang mengada-ada lebih buruk daripada tidak ada — sekali
    //     orang berhenti memercayainya, ia berhenti berguna.
    const masalah: string[] = [];
    const peringatan: string[] = [];
    const detikGagal: number[] = [];
    for (const t of temuan) {
      if (input.tanpaWajah) {
        // hands_only melarang WAJAH, bukan manusia. Jumlah orang TIDAK diperiksa
        // di sini: shot yang benar pun selalu punya pemilik tangan.
        if (t.jumlahWajah > 0) {
          masalah.push(`detik ${t.detik}: ada ${t.jumlahWajah} wajah, padahal format ini tanpa wajah`);
          detikGagal.push(t.detik);
        }
      } else if (t.jumlahOrangUtama > input.maksOrang) {
        masalah.push(`detik ${t.detik}: ${t.jumlahOrangUtama} orang jadi subjek utama, maksimal ${input.maksOrang}`);
        detikGagal.push(t.detik);
      } else if (t.jumlahOrang > input.maksOrang) {
        // Orang di latar dicatat, tidak menolak. Banyak template memang
        // mengambil tempat ramai, dan keramaian itu yang membuatnya terasa
        // nyata.
        peringatan.push(`detik ${t.detik}: ${t.jumlahOrang} orang di frame (${t.jumlahOrangUtama} subjek utama, sisanya latar)`);
      }
      // Dua tangan per orang, longgar satu — tangan yang terpotong tepi frame
      // kadang terhitung ganda oleh model.
      //
      // Untuk hands_only yang dihitung adalah SATU orang pemilik tangan, bukan
      // jumlah orang laporan model (yang di format ini tidak bisa dipercaya:
      // tanpa wajah, model kadang menebak dua orang dari dua tangan).
      //
      // hands_only DIPERKETAT (2026-08-13, tanpa toleransi): frame template
      // "unboxing" melaporkan 3 tangan dan LOLOS karena toleransi +1. Saya
      // periksa framenya sendiri — memang ada tiga telapak: satu menekan pompa,
      // dua menadah di bawah. Itu cacat yang akan dilihat brand yang membayar.
      //
      // Di format ini premisnya justru DUA TANGAN SATU ORANG, jadi tidak ada
      // alasan melonggarkan. Toleransi tetap dipertahankan untuk format lain,
      // yang komposisinya lebih ramai dan tangan terpotong tepi frame memang
      // sering terhitung ganda.
      //
      // Kalau ini ternyata menolak video hands_only yang bersih, angkanya
      // dilonggarkan lagi — dengan bukti, bukan dengan firasat.
      const orangEfektif = input.tanpaWajah ? 1 : t.jumlahOrang;
      const batasTangan = input.tanpaWajah ? 2 : Math.max(2, orangEfektif * 2) + 1;
      if (t.jumlahTangan > batasTangan) {
        masalah.push(`detik ${t.detik}: ${t.jumlahTangan} tangan untuk ${t.jumlahOrang} orang`);
        detikGagal.push(t.detik);
      }
      // FISIKA MUSTAHIL = PENGHALANG, bukan peringatan.
      //
      // Berbeda dari anatomiRusak yang sengaja jadi peringatan karena ambigu:
      // cairan yang keluar dari sisi botol bukan soal selera atau sudut
      // pandang — ia salah, terlihat jelas oleh penonton awam, dan langsung
      // memberi tahu bahwa videonya buatan mesin. Untuk iklan yang tugasnya
      // membuat orang percaya pada produk, itu menghancurkan seluruh gunanya.
      if (t.fisikaJanggal) {
        masalah.push(`detik ${t.detik}: fisika produk mustahil — ${t.catatan}`);
        detikGagal.push(t.detik);
      }
      if (t.anatomiRusak) peringatan.push(`detik ${t.detik}: kemungkinan anatomi janggal — ${t.catatan}`);
      if (t.teksAcak) peringatan.push(`detik ${t.detik}: teks di layar tidak terbaca (batasan model, bukan cacat baru)`);
    }
    return { temuan, lolos: masalah.length === 0, masalah, peringatan, detikGagal: [...new Set(detikGagal)] };
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch { /* abaikan */ }
  }
}

/** Shot mana yang berisi detik ini?
 *
 *  Dipakai memperbaiki cacat secara TERARAH: QC menolak di detik 13,8, dan
 *  yang perlu digenerate ulang cuma shot yang memuat detik itu — bukan seluruh
 *  video. Untuk video 6 shot, ini beda antara membayar satu klip dan enam.
 *
 *  Mengembalikan -1 kalau detiknya di luar total durasi (tidak menebak shot
 *  terakhir: menebak berarti membayar generate ulang shot yang mungkin
 *  baik-baik saja). */
export function shotUntukDetik(durasiShot: number[], detik: number): number {
  if (detik < 0) return -1;
  let batas = 0;
  for (let i = 0; i < durasiShot.length; i++) {
    batas += durasiShot[i];
    if (detik < batas) return i;
  }
  return -1;
}
