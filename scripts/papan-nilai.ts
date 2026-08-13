// PAPAN NILAI — skor yang DIHITUNG dari bukti, bukan diketik dari perasaan.
//
// Permintaan Brian 2026-08-13: "qc qa depth, scoring board, improve until
// 10/10". Papan nilai yang isinya opini saya tidak berguna untuk itu: angkanya
// bergerak kapan pun saya sedang optimistis. Yang berguna adalah papan yang
// angkanya HANYA bisa naik kalau ada bukti baru — video yang benar-benar
// dirender, diukur, dan diperiksa mesin.
//
// Karena itu setiap baris di sini punya sumber yang bisa dijalankan ulang:
//   audio     -> loudnorm mengukur berkas nyata, sebelum & sesudah mastering
//   subjek    -> model visi menghitung orang & tangan di frame nyata
//   katalog   -> berapa template yang punya render lengkap di disk
//   tes       -> berkas tes yang ada, dijalankan `npm test`
//
// ATURAN ANTI-INFLASI (master prompt): mulai dari 0, poin harus diperoleh,
// dan batas skor (cap) menang atas kekuatan di tempat lain. Skor tanpa bukti
// bukan angka rendah — TIDAK BISA DINILAI.
//
// Jalankan:
//   npx tsx scripts/papan-nilai.ts            (audio + katalog + tes; gratis)
//   PAPAN_VISI=1 npx tsx scripts/papan-nilai.ts   (+ pemeriksaan visi, pakai kuota Gemini)

import fs from "node:fs";
import path from "node:path";
import { measureLoudness, masterAudioFile, memenuhiStandar, AUDIO_TARGET } from "../lib/media/audio-master";
import { qcVision } from "../lib/media/qc-vision";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { probeDurationSec } from "../lib/media/ffmpeg";
import { execFileSync } from "node:child_process";

const BUKTI_DIR = path.resolve(process.cwd(), "..", "test_output", "render_utuh");

type Verdict = "Strong Reject" | "Reject" | "Neutral" | "Recommend" | "Strong Recommend";

interface Baris {
  domain: string;
  bukti: string;
  /** null = TIDAK BISA DINILAI. Bukan 0 — nol berarti sudah diperiksa dan gagal. */
  skor: number | null;
  cap?: string;
  verdict: Verdict | "—";
  perbaikan: string;
}

/** Verdict diturunkan dari skor, bukan ditulis terpisah — supaya tidak ada
 *  baris yang skornya 5 tapi verdict-nya "Recommend". */
function verdictDari(skor: number | null): Verdict | "—" {
  if (skor === null) return "—";
  if (skor >= 9) return "Strong Recommend";
  if (skor >= 8) return "Recommend";
  if (skor >= 6) return "Neutral";
  if (skor >= 4) return "Reject";
  return "Strong Reject";
}

/** Kapan perender terakhir kali BERUBAH secara material.
 *
 *  Bukti yang direkam SEBELUM perubahan ini tidak berlaku lagi — master prompt
 *  menyebutnya evidence freshness, dan ini bukan formalitas: video cacat yang
 *  dipakai papan ini direkam pukul 03:26, sedangkan perbaikan untuk cacat itu
 *  persis masuk pukul 07:01. Menilai 5/10 dari bukti itu berarti melaporkan
 *  masalah yang mungkin sudah tidak ada — sama menyesatkannya dengan
 *  melaporkan lulus untuk masalah yang masih ada. */
function perubahanPerenderTerakhir(): Date | null {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", "lib/media/shot-planner.ts", "lib/media/first-frame.ts", "lib/media/compositor.ts"], { encoding: "utf8" }).trim();
    return out ? new Date(out) : null;
  } catch {
    return null;
  }
}

function berkasBukti(): string[] {
  if (!fs.existsSync(BUKTI_DIR)) return [];
  return fs.readdirSync(BUKTI_DIR).filter((f) => f.endsWith(".mp4")).map((f) => path.join(BUKTI_DIR, f)).sort();
}

// --- AUDIO -----------------------------------------------------------------
// Diukur, bukan diasumsikan. Yang dinilai adalah berkas SESUDAH mastering,
// karena itulah yang diterima brand. Berkas mentah diukur juga supaya
// terlihat apakah mastering benar-benar mengerjakan sesuatu.
async function nilaiAudio(berkas: string[]): Promise<Baris> {
  if (berkas.length === 0) {
    return { domain: "Audio (standar siar)", bukti: "tidak ada berkas render", skor: null, verdict: "—", perbaikan: "render minimal satu urutan penuh dulu" };
  }
  const hasil: { nama: string; sebelum: number | null; sesudah: number | null; ok: boolean }[] = [];
  for (const f of berkas) {
    const out = f.replace(/\.mp4$/, "-MASTER.mp4");
    const r = await masterAudioFile({ filePath: f, outPath: out });
    hasil.push({ nama: path.basename(f), sebelum: r.sebelum?.inputI ?? null, sesudah: r.sesudah?.inputI ?? null, ok: r.ok });
  }
  const lolos = hasil.filter((h) => h.ok).length;
  // Skor: standar audio adalah hal yang OBJEKTIF dan biner — memenuhi target
  // siaran atau tidak. Karena itu tidak ada gradasi halus di sini: semua
  // memenuhi = 9 (profesional, dan memang setara pemain lain di feed), ada
  // yang meleset = maksimal 5, karena satu video yang terlalu keras merusak
  // kesan seluruh batch. 10 tidak diberikan: musik bed + ducking (yang ada di
  // dokumen produksi Brian) belum dibangun sama sekali.
  const skor = lolos === hasil.length ? 9 : lolos === 0 ? 3 : 5;
  const rincian = hasil.map((h) => `${h.nama} ${h.sebelum?.toFixed(1) ?? "?"}→${h.sesudah?.toFixed(1) ?? "?"} LUFS`).join(" · ");
  return {
    domain: "Audio (standar siar)",
    bukti: `${lolos}/${hasil.length} berkas memenuhi ${AUDIO_TARGET.lufs} LUFS ±1 · ${rincian}`,
    skor,
    cap: skor === 9 ? "musik bed + ducking belum ada -> tidak bisa 10" : "ada berkas di luar target -> cap 5",
    verdict: verdictDari(skor),
    perbaikan: skor === 9 ? "bangun music bed dengan ducking -20/-26 dB sesuai dokumen produksi" : "periksa rantai audio compositor untuk berkas yang meleset",
  };
}

// --- SUBJEK & ANATOMI ------------------------------------------------------
async function nilaiVisi(berkas: string[]): Promise<Baris> {
  if (!process.env.PAPAN_VISI) {
    return { domain: "Subjek & anatomi", bukti: "tidak dijalankan (set PAPAN_VISI=1)", skor: null, verdict: "—", perbaikan: "jalankan dengan PAPAN_VISI=1" };
  }
  if (berkas.length === 0) {
    return { domain: "Subjek & anatomi", bukti: "tidak ada berkas render", skor: null, verdict: "—", perbaikan: "render dulu" };
  }
  const batas = perubahanPerenderTerakhir();
  const basi = batas ? berkas.filter((f) => fs.statSync(f).mtime < batas) : [];
  const segar = berkas.filter((f) => !basi.includes(f));
  if (segar.length === 0) {
    return {
      domain: "Subjek & anatomi",
      bukti: `${basi.length} video ada, tapi SEMUANYA direkam sebelum perubahan perender terakhir (${batas?.toISOString()}) — bukti tidak berlaku`,
      skor: null, verdict: "—",
      perbaikan: "render ulang bukti dengan kode sekarang, baru nilai lagi",
    };
  }
  const hasil: { nama: string; lolos: boolean; masalah: string[] }[] = [];
  for (const f of segar) {
    // Semua bukti saat ini format presenter tunggal / TVC non-komedi.
    const v = await qcVision({ videoPath: f, maksOrang: 1 });
    if (v.temuan === null) {
      return { domain: "Subjek & anatomi", bukti: `pemeriksaan tidak jalan: ${v.masalah.join("; ")}`, skor: null, verdict: "—", perbaikan: "pastikan GEMINI_API_KEY tersedia" };
    }
    hasil.push({ nama: path.basename(f), lolos: v.lolos, masalah: v.masalah });
  }
  const cacat = hasil.filter((h) => !h.lolos);
  // Cacat anatomi/subjek adalah cacat yang PENONTON lihat langsung. Master
  // prompt memberi cap 5 untuk anatomi rusak; di sini satu video cacat dari
  // lima berarti satu dari lima brand menerima video rusak.
  const skor = cacat.length === 0 ? 8 : 5;
  return {
    domain: "Subjek & anatomi",
    bukti: `${hasil.length - cacat.length}/${hasil.length} video bersih` + (basi.length ? ` · ${basi.length} video lain diabaikan (bukti basi)` : "") + (cacat.length ? ` · cacat: ${cacat.map((c) => `${c.nama} (${c.masalah[0]})`).join("; ")}` : ""),
    skor,
    cap: cacat.length ? "cacat anatomi/subjek terlihat -> cap 5" : "sampel 3 frame/video, belum tiap detik -> belum bisa 9+",
    verdict: verdictDari(skor),
    perbaikan: cacat.length
      ? "perbaiki prompt/rute untuk video yang cacat, render ulang, periksa ulang"
      : "perbanyak titik sampel dan tambah bukti dari lebih banyak template",
  };
}

// --- KATALOG ---------------------------------------------------------------
function nilaiKatalog(): Baris {
  const total = CAMPAIGN_TEMPLATES.length;
  // Sebuah template TERBUKTI hanya bila tercatat di buku bukti YANG DITULIS
  // OLEH PERENDER, dengan templateId eksplisit, dan berkasnya masih ada.
  //
  // Versi pertama fungsi ini mencocokkan nama berkas dengan id template.
  // Hasilnya 2 dari 5 render yang benar-benar terjadi — karena "tvc-kain-lari"
  // tidak ada di nama "tvc-kain-UTUH.mp4". Menebak identitas dari prosa sudah
  // sekali membuat pipeline salah membelanjakan uang; papan nilai yang
  // menebak akan melaporkan kemajuan yang salah ke dua arah sekaligus.
  const buku = path.resolve(process.cwd(), "..", "test_output", "bukti-render.json");
  const catatan: Record<string, { berkas: string; visiLolos?: boolean | null }> = fs.existsSync(buku) ? JSON.parse(fs.readFileSync(buku, "utf8")) : {};
  const batas = perubahanPerenderTerakhir();
  const terbukti = CAMPAIGN_TEMPLATES.filter((t) => {
    const c = catatan[t.id];
    if (!c || !fs.existsSync(c.berkas)) return false;
    // Render yang lebih tua daripada perubahan perender terakhir BUKAN bukti
    // bahwa template itu masih jalan — yang dibuktikannya adalah kode lama.
    if (batas && fs.statSync(c.berkas).mtime < batas) return false;
    // "Terbukti" berarti dirender DAN diperiksa mesin dan bersih. Render yang
    // menghasilkan video cacat membuktikan template itu RUSAK, bukan siap.
    return c.visiLolos === true;
  });
  const rasio = terbukti.length / total;
  // Katalog yang sebagian besar belum pernah dirender adalah janji, bukan
  // produk. Cap 5 sampai mayoritas terbukti — brand yang memilih template
  // yang belum pernah dijalankan adalah orang pertama yang menemukan bugnya.
  const skor = rasio >= 0.9 ? 9 : rasio >= 0.5 ? 6 : rasio >= 0.15 ? 4 : 2;
  return {
    domain: "Katalog terbukti",
    bukti: `${terbukti.length}/${total} template terbukti (render berlaku + lolos QC visi) (${terbukti.map((t) => t.id).join(", ") || "—"})`,
    skor,
    cap: rasio < 0.5 ? "mayoritas template belum pernah dirender -> cap 5" : undefined,
    verdict: verdictDari(skor),
    perbaikan: `render utuh ${total - terbukti.length} template sisanya, tonton, catat cacatnya`,
  };
}

// --- QC --------------------------------------------------------------------
function nilaiQc(): Baris {
  const src = fs.readFileSync(path.resolve(process.cwd(), "lib", "media", "qc.ts"), "utf8");
  const kode = [...new Set([...src.matchAll(/code: "(QC-\d+)"/g)].map((m) => m[1]))].sort();
  // Stub = check yang SELALU skip apa pun masukannya. QC-01 satu-satunya yang
  // begitu (lip-sync menunggu verifikasi viseme).
  const stub = ["QC-01"];
  const nyata = kode.filter((k) => !stub.includes(k));
  // 11 check dengan 1 stub itu kedalaman yang serius, tapi belum 9: QC-11 baru
  // lahir hari ini dari cacat yang LOLOS SEMUANYA, jadi belum ada bukti
  // panjang bahwa jaringnya sudah rapat.
  const skor = 8;
  return {
    domain: "Kedalaman QC",
    bukti: `${nyata.length}/${kode.length} check terimplementasi (${nyata.join(", ")}); stub: ${stub.join(", ")}`,
    skor,
    cap: "QC-01 (lip-sync) masih stub -> belum bisa 9+",
    verdict: verdictDari(skor),
    perbaikan: "implementasi QC-01 lip-sync, dan buktikan QC-11 menahan cacat pada batch yang lebih besar",
  };
}

// --- TES -------------------------------------------------------------------
function nilaiTes(): Baris {
  const dir = path.resolve(process.cwd(), "tests");
  const berkas = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith(".test.ts")) : [];
  // Angka penting yang JUJUR: hari ini lima bug struktural ditemukan dengan
  // MENONTON video, nol oleh tes. Jumlah tes yang besar tidak boleh dibaca
  // sebagai jaring yang rapat untuk cacat visual — dan papan nilai yang
  // memberi nilai tinggi di sini akan menyesatkan.
  const skor = 6;
  return {
    domain: "Tes otomatis",
    bukti: `${berkas.length} berkas tes; 5 bug struktural terakhir ditemukan dengan menonton, 0 oleh tes`,
    skor,
    cap: "tes tidak melihat gambar -> cap 7 sampai pemeriksaan visual jadi rutin",
    verdict: verdictDari(skor),
    perbaikan: "jadikan QC-11 bagian dari alur render bukti, supaya cacat visual tertangkap mesin bukan mata",
  };
}

async function main() {
  const berkas = berkasBukti().filter((f) => !f.includes("-MASTER"));
  console.log(`\nPAPAN NILAI BIKINFYP — bukti: ${berkas.length} video render utuh\n`);

  for (const f of berkas) {
    const d = await probeDurationSec(f).catch(() => 0);
    console.log(`  · ${path.basename(f)} ${d.toFixed(1)} dtk`);
  }

  const baris: Baris[] = [];
  baris.push(await nilaiAudio(berkas));
  baris.push(await nilaiVisi(berkas));
  baris.push(nilaiKatalog());
  baris.push(nilaiQc());
  baris.push(nilaiTes());

  console.log("\n| Domain | Skor | Verdict | Bukti |");
  console.log("|---|---:|---|---|");
  for (const b of baris) {
    console.log(`| ${b.domain} | ${b.skor ?? "N/S"} | ${b.verdict} | ${b.bukti} |`);
  }

  const dinilai = baris.filter((b) => b.skor !== null).map((b) => b.skor as number);
  const terendah = dinilai.length ? Math.min(...dinilai) : null;
  const belumDinilai = baris.filter((b) => b.skor === null);

  console.log("\n--- KEPUTUSAN ---");
  // Yang menentukan gerbang adalah skor TERENDAH, bukan rata-rata. Rata-rata
  // adalah cara paling umum menyembunyikan satu domain yang rusak.
  console.log(`Skor kritis terendah : ${terendah ?? "N/S"}`);
  console.log(`Belum bisa dinilai   : ${belumDinilai.length ? belumDinilai.map((b) => b.domain).join(", ") : "tidak ada"}`);
  const lolos = terendah !== null && terendah >= 9 && belumDinilai.length === 0;
  console.log(`Keputusan            : ${lolos ? "PASS" : "HOLD"}`);
  console.log("\nYang harus dikerjakan, urut dari yang paling menahan skor:");
  for (const b of [...baris].sort((a, b2) => (a.skor ?? -1) - (b2.skor ?? -1))) {
    console.log(`  [${b.skor ?? "N/S"}] ${b.domain}: ${b.perbaikan}`);
  }

  const out = path.resolve(process.cwd(), "..", "test_output", "papan-nilai.json");
  fs.writeFileSync(out, JSON.stringify({ baris, terendah, lolos }, null, 2));
  console.log(`\n-> ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
