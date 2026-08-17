// RENDER UTUH — urutan penuh, lalu digabung jadi video yang bisa ditonton.
//
// Permintaan Brian 2026-08-13 ("RENDER AJA SEMUA"). Sampai sekarang semua
// pembuktian memakai potongan 5 detik, dan itu bisa menjawab "apakah framing-nya
// benar" tapi TIDAK BISA menjawab "apakah ceritanya tersambung". Empat bug di
// jalur TVC baru saja diperbaiki; yang belum diketahui justru apakah shot 1
// sampai 6 terasa satu video atau enam video bagus yang berdiri sendiri.
//
// Karena itu di sini shot-nya dirender LENGKAP dan langsung DIGABUNG. Yang
// dinilai video jadinya, bukan lembar kontaknya.
//
// Jalankan:
//   RENDER_CONFIRM=YA npx tsx scripts/render-utuh.ts

import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { getTemplate } from "../lib/templates";
import { runFfmpeg } from "../lib/media/ffmpeg";
import { qcVision } from "../lib/media/qc-vision";
import { maksOrangPerFrame } from "../lib/media/shot-planner";

const FOTO = path.resolve(process.cwd(), "..", "test_output", "produk-polos.jpg");
const OUT = path.resolve(process.cwd(), "..", "test_output", "render_utuh");

type Tugas = { id: string; label: string; templateId: string; format: "talking_head" | "ads" | "tvc" };

const TUGAS: Tugas[] = [
  { id: "tvc-kain", label: "TVC · Kain yang Ikut Lari", templateId: "tvc-kain-lari", format: "tvc" },
  { id: "tvc-jamtiga", label: "TVC · Jam Tiga Pagi", templateId: "tvc-jam-tiga", format: "tvc" },
  { id: "ads-unboxing", label: "Ads · Unboxing dari Dalam Kardus", templateId: "ads-unboxing-pov", format: "talking_head" },
  { id: "ads-meja-kosong", label: "Ads · Meja Kosong", templateId: "ads-meja-kosong", format: "ads" },
  { id: "ads-panas", label: "Ads · Masalah Dilebih-lebihkan", templateId: "ads-panas-ekstrem", format: "talking_head" },
];

/** Gabung klip jadi satu berkas. Concat demuxer menuntut semua masukan sudah
 *  seragam dimensi/fps — di sini pasti seragam karena berasal dari satu spec,
 *  jadi cukup copy stream tanpa encode ulang (lebih cepat, tanpa rugi mutu). */
async function gabung(klip: string[], keluar: string) {
  const daftar = keluar.replace(/\.mp4$/, "-daftar.txt");
  fs.writeFileSync(daftar, klip.map((f) => `file '${f}'`).join("\n"));
  await runFfmpeg(["-y", "-f", "concat", "-safe", "0", "-i", daftar, "-c", "copy", keluar]);
  fs.unlinkSync(daftar);
}

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Ditolak: render urutan PENUH = uang sungguhan. Ulangi dengan RENDER_CONFIRM=YA.");
    process.exit(1);
  }
  fs.mkdirSync(OUT, { recursive: true });

  // Saring dengan RENDER_ONLY=id1,id2 — supaya membuktikan SATU perbaikan
  // tidak berarti membayar seluruh katalog lagi.
  const hanya = (process.env.RENDER_ONLY ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const daftarTugas = hanya.length ? TUGAS.filter((t) => hanya.includes(t.id) || hanya.includes(t.templateId)) : TUGAS;
  if (daftarTugas.length === 0) { console.error(`RENDER_ONLY tidak cocok dengan tugas mana pun: ${hanya.join(",")}`); process.exit(1); }

  const kategori = getCreatorCategory("hijaber")!;
  const produk: ProductInput = {
    id: "utuh", name: "Mosseru Bright Shower Gel", price_idr: 189000,
    category: "beauty", sourceUrl: null,
  };

  const ringkas: { label: string; templateId: string; klip: number; biaya: number; berkas: string; visiLolos: boolean | null; visiMasalah: string[] }[] = [];
  let total = 0;

  for (const t of daftarTugas) {
    const tpl = getTemplate(t.templateId)!;
    const durasi = tpl.durationSec;
    const [skrip] = await generateScripts({
      product: produk, register: "bunda", qualityTier: "high_quality",
      durationSec: durasi, count: 1, hookLevel: tpl.hookLevel,
      ...(tpl.hookFamily ? { hookFamilies: [tpl.hookFamily as never], lockHookFamily: true } : {}),
      templateId: tpl.id,
    });

    const spec = planShots({
      jobId: t.id, durationSec: durasi, segments: skrip.segments,
      category: kategori, productName: produk.name, productCategory: "beauty",
      imageRefPath: FOTO, qualityTier: "high_quality", format: t.format,
      hookLevel: tpl.hookLevel, ugcTemplate: tpl.id,
      tvcRoute: tpl.tvcRoute, shotCountOverride: tpl.shotCount, ratio: tpl.ratio,
    });

    console.log(`\n=== ${t.label} — ${spec.shots.length} shot, ${durasi} dtk ===`);
    const dir = path.join(OUT, t.id);
    fs.mkdirSync(dir, { recursive: true });
    const jadi: string[] = [];
    let biaya = 0;

    for (const shot of spec.shots) {
      const satu = { ...spec, shots: [{ ...shot, index: 0 }] };
      const sub = path.join(dir, `s${shot.index}`);
      fs.mkdirSync(sub, { recursive: true });
      console.log(`  shot ${shot.index}: ${shot.prompt.slice(110, 200).replace(/\s+/g, " ")}...`);
      try {
        const aset = await byteplusVideo.generate(satu, sub);
        for (const a of aset) { jadi.push(a.filePath); biaya += a.costIdr; }
        console.log(`    OK Rp${aset[0]?.costIdr.toLocaleString("id-ID")}`);
      } catch (err) {
        // Shot yang gagal dilewati, sisanya tetap digabung — video kurang satu
        // shot masih bisa dinilai; membatalkan semuanya membuang yang sudah
        // dibayar.
        console.error(`    GAGAL: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    let berkas = "(tidak ada klip)";
    let visi: { lolos: boolean | null; masalah: string[] } = { lolos: null, masalah: [] };
    if (jadi.length > 0) {
      berkas = path.join(OUT, `${t.id}-UTUH.mp4`);
      await gabung(jadi, berkas);
      console.log(`  -> ${berkas}`);

      // PERIKSA LANGSUNG, jangan tunggu ada yang sempat menonton.
      //
      // Lima bug struktural hari ini semuanya ditemukan dengan MENONTON, dan
      // satu cacat (dua perempuan di shot penutup) lolos sampai ke output
      // karena kebetulan tidak ada yang menonton bagian itu. Bukti render yang
      // tidak langsung diperiksa hanya memindahkan momen penemuannya ke
      // belakang — kadang sampai setelah brand yang menemukannya.
      const maks = maksOrangPerFrame({ format: t.format, tvcRoute: tpl.tvcRoute });
      const v = await qcVision({ videoPath: berkas, maksOrang: maks, tanpaWajah: maks === 0 });
      visi = { lolos: v.temuan === null ? null : v.lolos, masalah: v.masalah };
      console.log(
        v.temuan === null ? `  QC visi: TIDAK DIPERIKSA (${v.masalah.join("; ")})`
          : v.lolos ? `  QC visi: BERSIH (maks ${maks} orang${v.peringatan.length ? `, catatan: ${v.peringatan.length}` : ""})`
            : `  QC visi: CACAT — ${v.masalah.join("; ")}`
      );
    }
    total += biaya;
    ringkas.push({ label: t.label, templateId: t.templateId, klip: jadi.length, biaya, berkas, visiLolos: visi.lolos, visiMasalah: visi.masalah });
  }

  console.log("\n=== RINGKASAN ===");
  for (const r of ringkas) console.log(` ${r.label.padEnd(34)} ${r.klip} klip  Rp${String(r.biaya).padStart(6)}  ${r.visiLolos === null ? "visi:?" : r.visiLolos ? "visi:OK" : "visi:CACAT"}  ${r.berkas}`);
  console.log(` TOTAL: Rp${total.toLocaleString("id-ID")}`);
  fs.writeFileSync(path.join(OUT, "ringkasan.json"), JSON.stringify({ total, ringkas }, null, 2));

  // BUKU BUKTI. Papan nilai membacanya untuk tahu template mana yang benar-
  // benar pernah dirender utuh.
  //
  // Ditulis di SINI, oleh yang merender, dengan templateId eksplisit —
  // bukan ditebak dari nama berkas belakangan. Menebak identitas dari prosa
  // sudah sekali membuat pipeline salah membelanjakan uang; jangan diulang
  // untuk memutuskan apa yang sudah terbukti.
  const buku = path.resolve(process.cwd(), "..", "test_output", "bukti-render.json");
  const lama: Record<string, { berkas: string; klip: number; dirender: string; visiLolos?: boolean | null; visiMasalah?: string[] }> =
    fs.existsSync(buku) ? JSON.parse(fs.readFileSync(buku, "utf8")) : {};
  for (const r of ringkas) {
    if (r.klip === 0) continue; // gagal total bukan bukti
    lama[r.templateId] = { berkas: r.berkas, klip: r.klip, dirender: new Date().toISOString(), visiLolos: r.visiLolos, visiMasalah: r.visiMasalah };
  }
  fs.writeFileSync(buku, JSON.stringify(lama, null, 2));
  console.log(` buku bukti: ${buku}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
