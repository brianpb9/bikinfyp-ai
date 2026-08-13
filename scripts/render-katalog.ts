// RENDER KATALOG — buktikan SELURUH 33 template, satu per satu.
//
// Persetujuan Brian 2026-08-13: "ya jalanin aja, ya semuanya pelan2".
// 33 template, 124 klip, ±Rp358.562 dengan tarif terukur hari ini.
//
// KENAPA PERLU. Papan nilai menolak bukti yang lebih tua daripada perubahan
// perender terakhir, dan setelah perbaikan penutup TVC itu berarti NOL dari 33
// template punya bukti yang masih berlaku. Katalog yang sebagian besar belum
// pernah dijalankan dengan kode sekarang adalah janji, bukan produk — brand
// yang memilih template yang belum pernah dirender adalah orang pertama yang
// menemukan bugnya.
//
// TIGA SIFAT YANG WAJIB, karena ini uang sungguhan:
//
// 1. BISA DILANJUT. Buku bukti ditulis SETIAP SELESAI SATU TEMPLATE, bukan di
//    akhir. Kalau mati di template ke-20, sembilan belas yang sudah dibayar
//    tetap tercatat dan tidak dibayar dua kali.
// 2. MELEWATI YANG SUDAH TERBUKTI. Template yang buktinya masih berlaku DAN
//    lolos QC visi dilewati begitu saja.
// 3. MEMERIKSA SENDIRI. Tiap hasil langsung dilewatkan QC-11 dengan batas
//    orang dari spec-nya sendiri. Tanpa ini, 33 render cuma jadi 33 video yang
//    harus ditonton manusia — dan cacat terakhir lolos justru karena tidak ada
//    yang sempat menonton bagian itu.
//
// Jalankan (bertahap — inti dari "pelan2"):
//   RENDER_CONFIRM=YA RENDER_BATCH=5 npx tsx scripts/render-katalog.ts
// Tanpa RENDER_BATCH, seluruh sisa katalog dikerjakan dalam satu jalan.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { planShots } from "../lib/media/shot-planner";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { runFfmpeg } from "../lib/media/ffmpeg";
import { qcVision } from "../lib/media/qc-vision";
import { sidikPrompt } from "../lib/media/bukti-segar";

const FOTO = path.resolve(process.cwd(), "..", "test_output", "produk-polos.jpg");
const OUT = path.resolve(process.cwd(), "..", "test_output", "katalog");
const BUKU = path.resolve(process.cwd(), "..", "test_output", "bukti-render.json");

interface Catatan {
  berkas: string;
  klip: number;
  dirender: string;
  biaya?: number;
  visiLolos?: boolean | null;
  visiMasalah?: string[];
  /** Sidik jari prompt yang dipakai. Bukti berlaku selama sidiknya masih
   *  sama — lihat lib/media/bukti-segar.ts. */
  sidik?: string;
}

function bacaBuku(): Record<string, Catatan> {
  return fs.existsSync(BUKU) ? JSON.parse(fs.readFileSync(BUKU, "utf8")) : {};
}

/** Kapan perender terakhir berubah. Bukti yang lebih tua tidak berlaku —
 *  yang dibuktikannya adalah kode lama, bukan kode yang akan dipakai brand. */
function batasKesegaran(): Date | null {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--",
      "lib/media/shot-planner.ts", "lib/media/first-frame.ts", "lib/media/compositor.ts"], { encoding: "utf8" }).trim();
    return out ? new Date(out) : null;
  } catch {
    return null;
  }
}

function sudahTerbukti(c: Catatan | undefined, batas: Date | null, sidikKini?: string): boolean {
  if (!c || !fs.existsSync(c.berkas)) return false;
  if (c.visiLolos !== true) return false;
  // Sidik prompt lebih presisi daripada waktu: perubahan di format LAIN tidak
  // membatalkan bukti template ini.
  if (c.sidik && sidikKini) return c.sidik === sidikKini;
  // Catatan lama tanpa sidik jatuh kembali ke aturan waktu.
  return !batas || fs.statSync(c.berkas).mtime >= batas;
}

async function gabung(klip: string[], keluar: string) {
  const daftar = keluar.replace(/\.mp4$/, "-daftar.txt");
  fs.writeFileSync(daftar, klip.map((f) => `file '${f}'`).join("\n"));
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", daftar, "-c", "copy", keluar]);
  fs.unlinkSync(daftar);
}

const KATEGORI = getCreatorCategory("hijaber")!;
const PRODUK: ProductInput = {
  id: "katalog", name: "Mosseru Bright Shower Gel", price_idr: 189000,
  category: "beauty", sourceUrl: null,
};

/** Rencana shot untuk satu template. SATU definisi, dipakai untuk menghitung
 *  sidik prompt DAN untuk merender — kalau keduanya disalin terpisah, sidik
 *  yang dibandingkan bukan sidik yang benar-benar dikirim. */
function rencanakan(tpl: (typeof CAMPAIGN_TEMPLATES)[number]) {
  const [skrip] = generateScripts({
    product: PRODUK, register: "bunda", qualityTier: "high_quality",
    durationSec: tpl.durationSec, count: 1, hookLevel: tpl.hookLevel,
    ...(tpl.hookFamily ? { hookFamilies: [tpl.hookFamily as never], lockHookFamily: true } : {}),
    templateId: tpl.id,
  });
  return planShots({
    jobId: tpl.id, durationSec: tpl.durationSec, segments: skrip.segments,
    category: KATEGORI, productName: PRODUK.name, productCategory: "beauty",
    imageRefPath: FOTO, qualityTier: "high_quality", format: tpl.format,
    hookLevel: tpl.hookLevel, ugcTemplate: tpl.id,
    tvcRoute: tpl.tvcRoute, shotCountOverride: tpl.shotCount, ratio: tpl.ratio,
  });
}

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Ditolak: render katalog = uang sungguhan. Ulangi dengan RENDER_CONFIRM=YA.");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  const batas = batasKesegaran();
  const buku = bacaBuku();
  // RENDER_SKIP_FORMAT: jangan bayar untuk format yang cacatnya SUDAH
  // diketahui dan belum diperbaiki. hands_only 2026-08-13 menghasilkan telapak
  // ketiga di dua template berturut-turut, dan kunci tangan positif+negatif
  // tidak menahannya — merender enam sisanya berarti membeli enam video cacat.
  const lewati = (process.env.RENDER_SKIP_FORMAT ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  // Sidik prompt SEMUA template dihitung dulu. Merencanakan shot tidak
  // memanggil API mana pun dan tidak berbiaya — jadi memeriksa 33 template
  // untuk tahu mana yang promptnya berubah jauh lebih murah daripada salah
  // merender satu saja.
  const sidikPerTemplate = new Map<string, string>();
  for (const t of CAMPAIGN_TEMPLATES) {
    try {
      sidikPerTemplate.set(t.id, sidikPrompt(rencanakan(t)));
    } catch {
      // Template yang gagal direncanakan akan gagal juga saat dirender; biarkan
      // masuk antrean supaya kegagalannya terlihat, bukan disembunyikan.
    }
  }
  const antre = CAMPAIGN_TEMPLATES
    .filter((t) => !lewati.includes(t.format))
    .filter((t) => !sudahTerbukti(buku[t.id], batas, sidikPerTemplate.get(t.id)));
  if (lewati.length) console.log(`Format dilewati: ${lewati.join(", ")}`);
  const jatah = Number(process.env.RENDER_BATCH ?? 0);
  const kerjakan = jatah > 0 ? antre.slice(0, jatah) : antre;

  // Dihitung terpisah, bukan sebagai sisa pengurangan: "33 - antre" ikut
  // menghitung format yang DILEWATI sebagai "sudah terbukti", padahal justru
  // dilewati karena cacat. Papan yang melaporkan cacat sebagai bukti adalah
  // persis jenis kebohongan yang skrip ini dibuat untuk mencegah.
  const terbukti = CAMPAIGN_TEMPLATES.filter((t) => sudahTerbukti(buku[t.id], batas, sidikPerTemplate.get(t.id))).length;
  console.log(`Katalog ${CAMPAIGN_TEMPLATES.length} template · terbukti ${terbukti} · dilewati ${CAMPAIGN_TEMPLATES.length - terbukti - antre.length} · antre ${antre.length} · dikerjakan sekarang ${kerjakan.length}`);
  if (batas) console.log(`Batas kesegaran bukti: ${batas.toISOString()}`);

  let totalBiaya = 0;
  const hasil: { id: string; klip: number; biaya: number; visi: boolean | null; masalah: string[] }[] = [];

  for (const [n, tpl] of kerjakan.entries()) {
    console.log(`\n[${n + 1}/${kerjakan.length}] ${tpl.id} — ${tpl.format}, ${tpl.durationSec} dtk`);
    const dir = path.join(OUT, tpl.id);
    fs.mkdirSync(dir, { recursive: true });

    let klip: string[] = [];
    let biaya = 0;
    try {
      const spec = rencanakan(tpl);

      for (const shot of spec.shots) {
        const sub = path.join(dir, `s${shot.index}`);
        fs.mkdirSync(sub, { recursive: true });
        try {
          const aset = await byteplusVideo.generate({ ...spec, shots: [{ ...shot, index: 0 }] }, sub);
          for (const a of aset) { klip.push(a.filePath); biaya += a.costIdr; }
          process.stdout.write(`  shot ${shot.index} OK`);
        } catch (err) {
          // Shot gagal dilewati; sisanya tetap digabung. Video kurang satu shot
          // masih bisa dinilai, dan membatalkan semuanya membuang yang sudah
          // dibayar.
          process.stdout.write(`  shot ${shot.index} GAGAL(${err instanceof Error ? err.message.slice(0, 40) : "?"})`);
        }
      }
      console.log("");

      if (klip.length === 0) {
        hasil.push({ id: tpl.id, klip: 0, biaya, visi: null, masalah: ["tidak ada klip"] });
        totalBiaya += biaya;
        continue;
      }

      const berkas = path.join(OUT, `${tpl.id}.mp4`);
      await gabung(klip, berkas);

      const maks = spec.maxPeople ?? 1;
      const v = await qcVision({ videoPath: berkas, maksOrang: maks, tanpaWajah: maks === 0 });
      const lolos = v.temuan === null ? null : v.lolos;
      console.log(
        lolos === null ? `  QC visi: TIDAK DIPERIKSA (${v.masalah.join("; ")})`
          : lolos ? `  QC visi: BERSIH (maks ${maks} orang) · Rp${biaya.toLocaleString("id-ID")}`
            : `  QC visi: CACAT — ${v.masalah.join("; ")} · Rp${biaya.toLocaleString("id-ID")}`
      );

      // DITULIS SEKARANG, bukan di akhir. Kalau proses ini mati di template
      // berikutnya, yang sudah dibayar tetap tercatat.
      const bukuKini = bacaBuku();
      bukuKini[tpl.id] = {
        berkas, klip: klip.length, dirender: new Date().toISOString(),
        biaya, visiLolos: lolos, visiMasalah: v.masalah, sidik: sidikPrompt(spec),
      };
      fs.writeFileSync(BUKU, JSON.stringify(bukuKini, null, 2));

      totalBiaya += biaya;
      hasil.push({ id: tpl.id, klip: klip.length, biaya, visi: lolos, masalah: v.masalah });
    } catch (err) {
      console.error(`  GAGAL TOTAL: ${err instanceof Error ? err.message : String(err)}`);
      totalBiaya += biaya;
      hasil.push({ id: tpl.id, klip: klip.length, biaya, visi: null, masalah: [String(err)] });
    }
  }

  const bersih = hasil.filter((h) => h.visi === true);
  const cacat = hasil.filter((h) => h.visi === false);
  console.log(`\n=== RINGKASAN BATCH ===`);
  console.log(`  bersih : ${bersih.length}`);
  console.log(`  cacat  : ${cacat.length}${cacat.length ? " -> " + cacat.map((c) => `${c.id} (${c.masalah[0]})`).join("; ") : ""}`);
  console.log(`  gagal  : ${hasil.filter((h) => h.visi === null).length}`);
  console.log(`  biaya  : Rp${totalBiaya.toLocaleString("id-ID")}`);
  const sisa = CAMPAIGN_TEMPLATES.filter((t) => !sudahTerbukti(bacaBuku()[t.id], batas)).length;
  console.log(`  sisa antre setelah ini: ${sisa}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
