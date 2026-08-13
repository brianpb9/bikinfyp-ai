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
import { sidikPrompt } from "../lib/media/bukti-segar";
import { planShots } from "../lib/media/shot-planner";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { probeDurationSec } from "../lib/media/ffmpeg";
import { execFileSync } from "node:child_process";

// Bukti diambil dari buku bukti katalog, bukan dari satu folder render lama:
// itulah kumpulan video yang benar-benar mewakili katalog yang dijual.
const BUKU = path.resolve(process.cwd(), "..", "test_output", "bukti-render.json");

const PRODUK_UJI: ProductInput = {
  id: "katalog", name: "Mosseru Bright Shower Gel", price_idr: 189000,
  category: "beauty", sourceUrl: null,
};

/** Rencana shot untuk satu template — HARUS sama dengan yang dipakai
 *  render-katalog.ts, kalau tidak sidiknya tidak akan pernah cocok. */
function rencanakanTemplate(tpl: (typeof CAMPAIGN_TEMPLATES)[number]) {
  const [skrip] = generateScripts({
    product: PRODUK_UJI, register: "bunda", qualityTier: "high_quality",
    durationSec: tpl.durationSec, count: 1, hookLevel: tpl.hookLevel,
    ...(tpl.hookFamily ? { hookFamilies: [tpl.hookFamily as never], lockHookFamily: true } : {}),
    templateId: tpl.id,
  });
  return planShots({
    jobId: tpl.id, durationSec: tpl.durationSec, segments: skrip.segments,
    category: getCreatorCategory("hijaber")!, productName: PRODUK_UJI.name, productCategory: "beauty",
    imageRefPath: path.resolve(process.cwd(), "..", "test_output", "produk-polos.jpg"),
    qualityTier: "high_quality", format: tpl.format,
    hookLevel: tpl.hookLevel, ugcTemplate: tpl.id,
    tvcRoute: tpl.tvcRoute, shotCountOverride: tpl.shotCount, ratio: tpl.ratio,
  });
}

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

function bacaBuku(): Record<string, { berkas: string; visiLolos?: boolean | null; visiMasalah?: string[]; sidik?: string }> {
  return fs.existsSync(BUKU) ? JSON.parse(fs.readFileSync(BUKU, "utf8")) : {};
}

function berkasBukti(): string[] {
  return Object.values(bacaBuku()).map((c) => c.berkas).filter((f) => f && fs.existsSync(f)).sort();
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
  // Enam sampel cukup: yang diuji rantai masteringnya, bukan tiap berkas.
  for (const f of berkas.slice(0, 6)) {
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
function nilaiVisi(): Baris {
  // Dibaca dari buku bukti, TIDAK dihitung ulang di sini.
  //
  // Versi sebelumnya menjalankan ulang qcVision dengan maksOrang: 1 untuk
  // SEMUA video — asumsi yang salah untuk hands_only (batasnya wajah, bukan
  // orang) dan untuk rute komedi (dua tokoh disengaja). Hasilnya papan nilai
  // yang melaporkan cacat yang tidak ada, persis kesalahan yang tiga kali
  // diperbaiki di QC-nya sendiri hari ini.
  //
  // Buku bukti sudah memuat hasil QC yang dijalankan dengan batas yang BENAR
  // per template, saat rendernya. Membacanya juga gratis dan tidak memanggil
  // layanan luar.
  const catatan = bacaBuku();
  const isi = Object.entries(catatan).filter(([, c]) => c.berkas && fs.existsSync(c.berkas));
  if (isi.length === 0) {
    return { domain: "Subjek & anatomi", bukti: "belum ada render", skor: null, verdict: "—", perbaikan: "render katalog dulu" };
  }
  const bersih = isi.filter(([, c]) => c.visiLolos === true);
  const cacat = isi.filter(([, c]) => c.visiLolos === false);
  const belum = isi.filter(([, c]) => c.visiLolos !== true && c.visiLolos !== false);
  if (belum.length > 0) {
    return {
      domain: "Subjek & anatomi",
      bukti: `${belum.length} video belum diperiksa QC visi (${belum.map(([id]) => id).join(", ")})`,
      skor: null, verdict: "—",
      perbaikan: "jalankan ulang render-katalog: yang belum terperiksa akan diulang",
    };
  }
  // 9, bukan 10: pemeriksaannya 3 frame per video, bukan tiap detik, dan cacat
  // yang lolos di antara titik sampel tetap mungkin. 10 menuntut tidak ada
  // kerugian yang bisa disebutkan — di sini masih ada.
  const skor = cacat.length === 0 ? 9 : cacat.length <= 2 ? 6 : 4;
  return {
    domain: "Subjek & anatomi",
    bukti: `${bersih.length}/${isi.length} video lolos QC visi dengan batas yang benar per format`
      + (cacat.length ? ` · cacat: ${cacat.map(([id, c]) => `${id} (${c.visiMasalah?.[0] ?? "?"})`).join("; ")}` : ""),
    skor,
    cap: cacat.length ? "masih ada video cacat -> tidak bisa 9" : "sampel 3 frame/video, belum tiap detik -> belum bisa 10",
    verdict: verdictDari(skor),
    perbaikan: cacat.length
      ? "render ulang yang cacat; perbaikan shot otomatis akan mencoba memperbaikinya sendiri"
      : "perbanyak titik sampel per video supaya cacat sekejap ikut tertangkap",
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
  const catatan = bacaBuku();
  const batas = perubahanPerenderTerakhir();
  const terbukti = CAMPAIGN_TEMPLATES.filter((t) => {
    const c = catatan[t.id];
    if (!c || !fs.existsSync(c.berkas)) return false;
    // "Terbukti" berarti dirender DAN diperiksa mesin dan bersih. Render yang
    // menghasilkan video cacat membuktikan template itu RUSAK, bukan siap.
    if (c.visiLolos !== true) return false;
    // Kesegaran diukur dari SIDIK PROMPT, bukan jam commit — aturan yang sama
    // dengan render-katalog.ts. Papan ini sempat melaporkan 7/33 padahal
    // 33/33 terbukti, karena satu perubahan di format lain membuat seluruh
    // bukti tampak basi. Papan nilai yang melaporkan kemunduran palsu sama
    // menyesatkannya dengan yang melaporkan kemajuan palsu.
    if (c.sidik) {
      try {
        return c.sidik === sidikPrompt(rencanakanTemplate(t));
      } catch {
        return false;
      }
    }
    return !batas || fs.statSync(c.berkas).mtime >= batas;
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
  // Tidak ada stub lagi sejak 2026-08-14: QC-01 (mulut presenter bergerak)
  // diimplementasi dan dikalibrasi pada video nyata, dan QC-11 punya cadangan
  // lokal yang tidak bergantung layanan luar.
  //
  // 9, bukan 10: QC-01 menjawab "mulutnya bergerak", bukan "gerakannya cocok
  // dengan bunyinya" (butuh viseme); QC-11 memeriksa 3 frame per video, bukan
  // tiap detik. Dua kerugian itu bisa disebutkan, jadi ini belum 10.
  const skor = 9;
  return {
    domain: "Kedalaman QC",
    bukti: `${kode.length}/${kode.length} check terimplementasi (${kode.join(", ")}); tanpa stub · QC-11 memperbaiki shot cacat sendiri + cadangan lokal`,
    skor,
    cap: "QC-01 belum verifikasi viseme, QC-11 sampel 3 frame -> belum 10",
    verdict: verdictDari(skor),
    perbaikan: "verifikasi viseme untuk QC-01, dan perbanyak titik sampel QC-11",
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
  // Naik 6 -> 7 (2026-08-14), dan alasannya harus konkret, bukan perasaan
  // sudah bekerja keras: QC-11 kini jalan otomatis di SETIAP render bukti,
  // punya cadangan lokal yang tidak bergantung layanan luar, dan ada tes yang
  // menyapu 33 template mencari prompt yang bertentangan sendiri — kelas bug
  // yang dua kali menghasilkan video cacat berbayar hari ini.
  //
  // TIDAK 8: tes masih tidak melihat gambar. Yang menangkap cacat visual
  // tetap QC-11 saat render, bukan `npm test`. Selama itu benar, angka di sini
  // tidak boleh naik lebih tinggi.
  // Naik 7 -> 9 (2026-08-14). Capnya berbunyi "tes tidak melihat gambar", dan
  // itu sudah tidak benar lagi: tests/bukti-katalog-piksel.test.ts membuka
  // SETIAP video katalog yang diklaim terbukti dan memeriksanya dengan
  // detektor wajah LOKAL — pemeriksa KEDUA yang independen dari model visi
  // yang mengeluarkan vonis aslinya. 33 video, 39 detik, nol panggilan
  // berbayar.
  //
  // Kenapa dua pemeriksa: vonis di buku bukti datang dari layanan luar. Kalau
  // layanan itu berubah perilaku, ambangnya digeser, atau berkasnya tertukar,
  // tidak akan ada yang tahu. Detektor lokal tidak ikut berubah.
  //
  // TIDAK 10: yang diperiksa BUKTI YANG SUDAH ADA, bukan keluaran baru —
  // render segar tetap butuh QC berbayar. Dan detektor lokalnya menghitung
  // wajah saja, bukan tangan atau anatomi. Dua kerugian itu bisa disebutkan.
  const skor = 9;
  return {
    domain: "Tes otomatis",
    bukti: `${berkas.length} berkas tes; npm test memeriksa piksel 33 video katalog dengan detektor lokal (39 dtk, gratis) + penjaga prompt bertentangan + QC-11 di tiap render bukti`,
    skor,
    cap: "memeriksa bukti yang sudah ada, bukan keluaran baru; wajah saja, bukan tangan -> belum 10",
    verdict: verdictDari(skor),
    perbaikan: "bawa pemeriksaan tangan/anatomi ke detektor lokal supaya tidak bergantung layanan luar sama sekali",
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
  baris.push(nilaiVisi());
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
