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
//   RENDER_CONFIRM=YA RENDER_ONLY=t04-hook-indrawi npx tsx scripts/render-katalog.ts
// Tanpa RENDER_BATCH/RENDER_ONLY, seluruh sisa katalog dikerjakan sekaligus —
// dan setelah perubahan yang menyentuh semua prompt, "sisa" berarti 33.

import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { planShots } from "../lib/media/shot-planner";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { CAMPAIGN_TEMPLATES } from "../lib/templates";
import { runFfmpeg } from "../lib/media/ffmpeg";
import { qcVision, shotUntukDetik } from "../lib/media/qc-vision";
import { buildPackshotAsli, packshotAsliUntukShot, dimensiDariKlip } from "../lib/media/packshot-asli";
import { qcSubjekLokal } from "../lib/media/qc";
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
  // RENDER_ONLY: kerjakan template tertentu saja.
  //
  // Ditambahkan setelah nyaris membakar ~Rp400.000. Perbaikan pada
  // IDENTITY_INSTRUCTION menyentuh SETIAP template, jadi sidik prompt ke-33
  // template berubah sekaligus dan skrip ini — benar secara aturan — mengantre
  // seluruh katalog. Membuktikan SATU perbaikan tidak boleh berarti membayar
  // seluruh katalog lagi.
  const hanya = (process.env.RENDER_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
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
    .filter((t) => hanya.length === 0 || hanya.includes(t.id))
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
  // Berhenti kalau QC tidak bisa dijalankan.
  //
  // 2026-08-14: Gemini menjawab 503 (sedang kelebihan beban) dan dua template
  // hands_only tetap dirender penuh, dibayar, lalu dicatat "tidak diperiksa".
  // Membeli video yang tidak bisa diperiksa adalah bentuk paling murni dari
  // membakar uang: hasilnya tidak menambah bukti apa pun, dan tetap ditagih.
  //
  // Dua kali berturut-turut sudah cukup untuk menyimpulkan layanannya sedang
  // mati, bukan satu frame yang apes. Antreannya bisa dilanjutkan kapan saja —
  // skrip ini melewati yang sudah terbukti.
  let takTerperiksaBeruntun = 0;
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

        // PACKSHOT PENUTUP DARI FOTO ASLI — tidak digenerate sama sekali.
        // Model tidak bisa merender teks kecil label dengan benar (dua putaran
        // perbaikan prompt gagal, diukur), dan penutup adalah tempat produk
        // dilihat paling lama. Bonusnya: satu klip lebih murah, bukan lebih
        // mahal.
        if (packshotAsliUntukShot({ index: shot.index, jumlahShot: spec.shots.length, tanpaOrang: shot.tanpaOrang === true })) {
          try {
            // Dimensi dari klip yang SUDAH dirender, bukan dari spec:
            // spec.width/height di-hardcode 720x1280 sementara TVC dirender
            // 16:9. Memakai spec menghasilkan penutup 9:16 di antara lima shot
            // 16:9 — satu berkas berdimensi campuran, yang tidak sah.
            const dim = klip.length > 0 ? await dimensiDariKlip(klip[0]) : { width: spec.width, height: spec.height };
            const out = await buildPackshotAsli({
              fotoPath: FOTO, durationSec: shot.durationSec,
              width: dim.width, height: dim.height,
              outPath: path.join(sub, "packshot.mp4"),
            });
            klip.push(out);
            process.stdout.write(`  shot ${shot.index} PACKSHOT-ASLI (Rp0)`);
            continue;
          } catch (err) {
            // Gagal membangun packshot bukan alasan menggagalkan video: jatuh
            // kembali ke generate seperti biasa.
            process.stdout.write(`  shot ${shot.index} packshot gagal (${err instanceof Error ? err.message.slice(0, 30) : "?"}), generate biasa`);
          }
        }

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

      // VIDEO YANG KEHILANGAN SHOT BUKAN BUKTI.
      //
      // Terjadi 2026-08-14: satu shot racun-checkout gagal di provider, video
      // digabung dari SATU klip (7,5 dtk dari 15), lalu QC-11 melaporkan
      // "BERSIH" — karena tiga frame yang disampelnya memang bersih. Buku bukti
      // hampir mencatatnya sebagai template yang terbukti.
      //
      // QC visual memeriksa APA YANG ADA di frame; ia tidak pernah tahu apa
      // yang HILANG. Kelengkapan harus diperiksa di sini, di tempat yang tahu
      // berapa shot yang seharusnya ada.
      if (klip.length < spec.shots.length) {
        const kurang = spec.shots.length - klip.length;
        console.log(`  TIDAK LENGKAP: ${klip.length}/${spec.shots.length} shot — ${kurang} gagal, tidak dicatat sebagai bukti`);
        totalBiaya += biaya;
        hasil.push({ id: tpl.id, klip: klip.length, biaya, visi: null, masalah: [`hanya ${klip.length} dari ${spec.shots.length} shot berhasil`] });
        continue;
      }

      const berkas = path.join(OUT, `${tpl.id}.mp4`);
      await gabung(klip, berkas);

      const maks = spec.maxPeople ?? 1;
      let v = await qcVision({ videoPath: berkas, maksOrang: maks, tanpaWajah: maks === 0 });

      // PERBAIKAN TERARAH — mekanisme yang sama dengan yang dipasang di worker
      // produksi, dijalankan di sini supaya terbukti dengan uang sungguhan.
      //
      // QC-11 tahu DETIK mana yang cacat, jadi shot penyebabnya digenerate
      // ulang sendirian. Satu klip, bukan seluruh video. Maksimal dua shot dan
      // satu putaran: kalau lebih dari itu, yang salah arahannya, bukan
      // lemparan dadu yang sial.
      if (v.temuan !== null && !v.lolos && v.detikGagal.length) {
        const durasiShot = spec.shots.map((sh) => sh.durationSec);
        const idxCacat = [...new Set(v.detikGagal.map((d) => shotUntukDetik(durasiShot, d)))]
          .filter((i) => i >= 0).slice(0, 2);
        if (idxCacat.length) {
          console.log(`  QC visi menolak detik ${v.detikGagal.join(", ")} -> perbaiki shot ${idxCacat.map((i) => i + 1).join(", ")}`);
          for (const idx of idxCacat) {
            const sub = path.join(dir, `qcfix-s${idx}`);
            fs.mkdirSync(sub, { recursive: true });
            try {
              const ulang = await byteplusVideo.generate({ ...spec, shots: [{ ...spec.shots[idx], index: 0 }] }, sub);
              fs.copyFileSync(ulang[0].filePath, klip[idx]);
              biaya += ulang[0].costIdr;
              console.log(`    shot ${idx + 1} diganti (Rp${ulang[0].costIdr.toLocaleString("id-ID")})`);
            } catch (err) {
              console.warn(`    shot ${idx + 1} gagal diperbaiki: ${err instanceof Error ? err.message : String(err)}`);
            }
          }
          await gabung(klip, berkas);
          v = await qcVision({ videoPath: berkas, maksOrang: maks, tanpaWajah: maks === 0 });
          console.log(`  setelah perbaikan: ${v.lolos ? "BERSIH" : "masih cacat"}`);
        }
      }

      // PEMERIKSA KEDUA, RAPAT — sebelum apa pun dicatat sebagai bukti.
      //
      // qcVision memeriksa 3 frame; itu hemat kuota tapi meninggalkan lubang.
      // 2026-08-14 tvc-seharian tercatat "terbukti" padahal mengandung dua
      // perempuan berwajah identik — cacatnya duduk di antara titik sampel.
      // Pemeriksa lokal (2 frame/detik) gratis, jadi tidak ada alasan mencatat
      // bukti tanpa melewatinya lebih dulu.
      let lolos = v.temuan === null ? null : v.lolos;
      let masalahLokal: string[] = [];
      if (lolos === true) {
        try {
          let lokal = await qcSubjekLokal(berkas, maks, dir);
          // PERBAIKI DULU, baru putuskan — sama seperti penolakan pemeriksa visi.
          // Tanpa ini, penolakan lokal langsung jadi kegagalan permanen dan
          // seluruh video (yang sudah dibayar) terbuang untuk satu shot cacat.
          if (lokal.status === "fail" && lokal.detikGagal?.length) {
            const durasiShot = spec.shots.map((sh) => sh.durationSec);
            const idx = [...new Set(lokal.detikGagal.map((d) => shotUntukDetik(durasiShot, d)))].filter((i) => i >= 0).slice(0, 2);
            if (idx.length) {
              console.log(`  QC lokal menolak detik ${lokal.detikGagal.join(", ")} -> perbaiki shot ${idx.map((i) => i + 1).join(", ")}`);
              for (const i2 of idx) {
                const sub2 = path.join(dir, `lokalfix-s${i2}`);
                fs.mkdirSync(sub2, { recursive: true });
                try {
                  const ulang = await byteplusVideo.generate({ ...spec, shots: [{ ...spec.shots[i2], index: 0 }] }, sub2);
                  fs.copyFileSync(ulang[0].filePath, klip[i2]);
                  biaya += ulang[0].costIdr;
                  console.log(`    shot ${i2 + 1} diganti (Rp${ulang[0].costIdr.toLocaleString("id-ID")})`);
                } catch (err) {
                  console.warn(`    shot ${i2 + 1} gagal diperbaiki: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
              await gabung(klip, berkas);
              lokal = await qcSubjekLokal(berkas, maks, dir);
              console.log(`  setelah perbaikan lokal: ${lokal.status === "fail" ? "masih cacat" : "BERSIH"}`);
            }
          }
          if (lokal.status === "fail") {
            lolos = false;
            masalahLokal = [lokal.detail ?? "ditolak pemeriksa lokal rapat"];
            console.log(`  QC lokal rapat MENOLAK: ${lokal.detail}`);
          } else {
            console.log(`  QC lokal rapat: ${lokal.status} — ${lokal.detail}`);
          }
        } catch (err) {
          console.warn(`  QC lokal rapat gagal jalan: ${err instanceof Error ? err.message : String(err)}`);
        }
      }
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
        biaya, visiLolos: lolos, visiMasalah: [...v.masalah, ...masalahLokal], sidik: sidikPrompt(spec),
      };
      fs.writeFileSync(BUKU, JSON.stringify(bukuKini, null, 2));

      totalBiaya += biaya;
      hasil.push({ id: tpl.id, klip: klip.length, biaya, visi: lolos, masalah: [...v.masalah, ...masalahLokal] });

      takTerperiksaBeruntun = lolos === null ? takTerperiksaBeruntun + 1 : 0;
      if (takTerperiksaBeruntun >= 2) {
        console.error(`\nBERHENTI: dua template berturut-turut tidak bisa diperiksa QC (${v.masalah.join("; ")}).`);
        console.error("Video yang tidak bisa diperiksa tidak menambah bukti apa pun, tapi tetap dibayar.");
        console.error("Jalankan lagi nanti — yang sudah terbukti otomatis dilewati.");
        break;
      }
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
