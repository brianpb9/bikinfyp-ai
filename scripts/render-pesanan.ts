// Render pesanan nyata: satu produk, beberapa template, keluar ke satu folder.
//
// Berbeda dari render-katalog.ts yang membuktikan KATALOG (produk tetap, buku
// bukti, sidik prompt), skrip ini melayani PESANAN: produk dan avatar dari
// Brian, hasilnya untuk ditonton, bukan untuk jadi bukti template.
//
// Sengaja TIDAK menulis test_output/bukti-render.json — kalau ikut menulis, video
// pesanan akan tercatat sebagai bukti template, dan papan mutu jadi berbohong.
//
// Jalankan:
//   RENDER_CONFIRM=YA npx tsx scripts/render-pesanan.ts
import fs from "node:fs";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const runFile = promisify(execFile);

const PESANAN = {
  nama: "JJ Glow Gluta Pink",
  kategori: "beauty",
  // Harga SENGAJA null: tidak terbaca dari halaman Tokopedia tanpa login, dan
  // mengarang angka di naskah jualan berarti berbohong ke pembeli. Semua
  // template di bawah sudah dipastikan tidak menyebut harga.
  hargaIdr: null as number | null,
  foto: path.resolve(process.cwd(), "..", "test_output", "jjglow-produk.png"),
  avatar: path.resolve(process.cwd(), "storage", "lab-avatar", "hijaber-a.png"),
  // Semuanya 15 detik: dari 33 video katalog, keenam yang Brian setujui
  // berdurasi 15 detik. Ini menempel ke zona yang sudah terbukti.
  // Dipilih setelah MEMBACA naskah yang dihasilkan, bukan dari nama template.
  // Tiga kandidat pertama dibuang karena tidak cocok produk: t04-hook-indrawi
  // menyuruh "baca label RASA" (itu template makanan) dan t05-before-after
  // menyuruh menaruh produknya "berdampingan" — dibandingkan dengan dirinya
  // sendiri.
  template: ["buat-kamu-yang", "t11-hook-misteri", "unboxing", "ads-panas-ekstrem", "ads-atap-jebol"],
};

const OUT = path.resolve(process.cwd(), "..", "test_output", "jjglow");

async function gabung(klip: string[], keluar: string) {
  const daftar = keluar.replace(/\.mp4$/, "-daftar.txt");
  fs.writeFileSync(daftar, klip.map((f) => `file '${f}'`).join("\n"));
  await runFile("ffmpeg", ["-y", "-f", "concat", "-safe", "0", "-i", daftar, "-c", "copy", keluar]);
  fs.unlinkSync(daftar);
}

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    console.error("Ditolak: render pesanan = uang sungguhan. Ulangi dengan RENDER_CONFIRM=YA.");
    process.exit(1);
  }
  for (const f of [PESANAN.foto, PESANAN.avatar]) {
    if (!fs.existsSync(f)) { console.error(`Berkas hilang: ${f}`); process.exit(1); }
  }
  fs.mkdirSync(OUT, { recursive: true });

  const { generateScripts } = await import("../lib/script-engine");
  const { planShots } = await import("../lib/media/shot-planner");
  const { byteplusVideo } = await import("../lib/providers/stubs/byteplus");
  const { qcVision } = await import("../lib/media/qc-vision");
  const { getCreatorCategory } = await import("../lib/personas");
  const { describeAvatarFromPhoto } = await import("../lib/promo/avatar");
  const { CAMPAIGN_TEMPLATES } = await import("../lib/templates");

  // Avatar kustom masuk sebagai DESKRIPSI, bukan foto: BytePlus menolak foto
  // wajah asli sebagai referensi. Hasilnya "terinspirasi foto", bukan wajah
  // persis — dan itu harus disebut apa adanya ke Brian.
  console.log("Membaca avatar...");
  // describeAvatarFromPhoto belum punya coba-ulang, tidak seperti qc-vision.
  // Gemini menjawab 503 "high demand" di percobaan pertama dan seluruh render
  // batal sebelum satu klip pun dibuat. Backoff-nya ditaruh di sini dulu supaya
  // tidak menyentuh modul yang mungkin sedang dipegang pekerjaan lain.
  const JEDA = [0, 5_000, 15_000, 40_000];
  let deskripsi = "";
  for (const [i, jeda] of JEDA.entries()) {
    if (jeda) await new Promise((r) => setTimeout(r, jeda));
    try {
      deskripsi = await describeAvatarFromPhoto(fs.readFileSync(PESANAN.avatar), "image/png");
      break;
    } catch (e) {
      const pesan = (e as Error).message;
      const sementara = /50\d|429|high demand|UNAVAILABLE/i.test(pesan);
      if (!sementara || i === JEDA.length - 1) throw e;
      console.log(`  percobaan ${i + 1} gagal (${pesan.slice(0, 60)}) — ulang`);
    }
  }
  console.log(`  -> ${deskripsi.slice(0, 140)}\n`);

  const preset = getCreatorCategory("hijaber")!;
  const kategori = { ...preset, promptSeed: deskripsi, handsPrompt: deskripsi };
  const produk = {
    id: "pesanan-jjglow", name: PESANAN.nama, price_idr: PESANAN.hargaIdr ?? 0,
    category: PESANAN.kategori, sourceUrl: null,
  } as Parameters<typeof generateScripts>[0]["product"];

  let totalBiaya = 0;
  const hasil: { id: string; berkas: string; biaya: number; lolos: boolean | null; masalah: string[] }[] = [];

  for (const [n, id] of PESANAN.template.entries()) {
    const tpl = CAMPAIGN_TEMPLATES.find((t) => t.id === id);
    if (!tpl) { console.error(`Template ${id} tidak ada — dilewati`); continue; }
    console.log(`\n[${n + 1}/${PESANAN.template.length}] ${id} — ${tpl.format}, ${tpl.durationSec} dtk`);

    const [skrip] = generateScripts({
      product: produk, register: "bunda", qualityTier: tpl.tier as never,
      durationSec: tpl.durationSec, count: 1, hookLevel: tpl.hookLevel, templateId: id,
      ...(tpl.hookFamily ? { hookFamilies: [tpl.hookFamily as never], lockHookFamily: true } : {}),
    });
    console.log(`  naskah: ${skrip.segments.map((s) => s.text).join(" / ")}`);

    const spec = planShots({
      jobId: `jjglow-${id}`, durationSec: tpl.durationSec, segments: skrip.segments,
      category: kategori, productName: PESANAN.nama, productCategory: PESANAN.kategori,
      imageRefPath: PESANAN.foto, qualityTier: tpl.tier as never, format: tpl.format,
      hookLevel: tpl.hookLevel, ugcTemplate: id, tvcRoute: tpl.tvcRoute,
      shotCountOverride: tpl.shotCount, ratio: tpl.ratio,
    });

    const dir = path.join(OUT, id);
    fs.mkdirSync(dir, { recursive: true });
    const klip: string[] = [];
    let biaya = 0;
    try {
      for (const shot of spec.shots) {
        const sub = path.join(dir, `s${shot.index}`);
        fs.mkdirSync(sub, { recursive: true });
        const aset = await byteplusVideo.generate({ ...spec, shots: [{ ...shot, index: 0 }] } as never, sub);
        for (const a of aset) { klip.push(a.filePath); biaya += a.costIdr; }
        console.log(`  shot ${shot.index} OK`);
      }
      const berkas = path.join(OUT, `${id}.mp4`);
      await gabung(klip, berkas);

      const maks = spec.maxPeople ?? 1;
      const v = await qcVision({ videoPath: berkas, maksOrang: maks, tanpaWajah: maks === 0 });
      console.log(`  QC: ${v.lolos ? "LOLOS" : `MASALAH — ${v.masalah.join("; ")}`}`);
      hasil.push({ id, berkas, biaya, lolos: v.lolos, masalah: v.masalah });
    } catch (e) {
      console.error(`  GAGAL: ${(e as Error).message.slice(0, 160)}`);
      hasil.push({ id, berkas: "", biaya, lolos: null, masalah: [(e as Error).message.slice(0, 160)] });
    }
    totalBiaya += biaya;
  }

  console.log(`\n=== SELESAI — ${hasil.filter((h) => h.berkas).length}/${PESANAN.template.length} video, Rp${totalBiaya.toLocaleString("id-ID")} ===`);
  for (const h of hasil) {
    console.log(`  ${h.id.padEnd(22)} ${h.berkas ? "jadi" : "GAGAL"}  QC:${h.lolos === null ? "?" : h.lolos ? "lolos" : "bermasalah"}`);
  }
  fs.writeFileSync(path.join(OUT, "ringkasan.json"), JSON.stringify({ produk: PESANAN.nama, avatar: deskripsi, hasil, totalBiaya }, null, 2));
  console.log(`\nFolder: ${OUT}`);
}

main().catch((e) => { console.error(e); process.exit(1); });
