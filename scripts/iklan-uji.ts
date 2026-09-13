/**
 * RENDER UJI IKLAN SINEMATIK — dijalankan di container worker.
 *
 *   tsx scripts/iklan-uji.ts --dir storage/iklan-uji/faza --produk produk.json --foto foto.webp \
 *       [--sampai naskah|keyframe|klip|susun] [--catatan "..."] [--ulang-naskah]
 *
 * Setiap tahap menyimpan hasilnya di --dir dan DILEWATI bila hasilnya sudah
 * ada. Jadi naskah dan gambar kunci (murah) bisa ditinjau dulu sebelum klip
 * (mahal) dirender, dan perakitan bisa diulang tanpa membayar render lagi.
 *
 * Biaya dicatat di biaya.json dari angka yang dilaporkan penyedia (kredit kie.ai)
 * atau tarif perkiraan yang terdokumentasi (Seedream, TTS, LLM).
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { tulisNaskahIklan, type NaskahIklan, type ProdukIklan } from "../lib/iklan/naskah";
import { buatKeyframes } from "../lib/iklan/keyframe";
import { buatKlip } from "../lib/iklan/klip";
import { buatVo } from "../lib/iklan/suara";
import { susunIklan } from "../lib/iklan/susun";
import { periksaIklan } from "../lib/iklan/gerbang";
import { catatanUlang, kurasiKeyframes } from "../lib/iklan/kurasi";

const argv = process.argv.slice(2);
const arg = (nama: string) => {
  const i = argv.indexOf(`--${nama}`);
  return i >= 0 ? argv[i + 1] : undefined;
};
const bendera = (nama: string) => argv.includes(`--${nama}`);

const TAHAP = ["naskah", "keyframe", "klip", "susun"] as const;

async function fotoAcuan(foto: string, nama: string, dir: string): Promise<Buffer> {
  const siap = path.join(dir, "foto-acuan.jpg");
  if (fs.existsSync(siap)) return fs.readFileSync(siap);
  let sumber = foto;
  try {
    const { periksaFotoProduk, AMBANG_KATA_BANNER } = await import("../lib/media/foto-produk");
    const periksa = await periksaFotoProduk(foto);
    if (periksa.kataTerbaca >= AMBANG_KATA_BANNER) {
      const { potongKeProduk } = await import("../lib/media/potong-produk");
      const hasil = await potongKeProduk(foto, nama, path.join(dir, "potong"));
      console.log(`[uji] foto poster (${periksa.kataTerbaca} kata) — ${hasil.alasan}`);
      sumber = hasil.path;
    }
  } catch (err) {
    console.warn("[uji] pemeriksaan/pemotongan foto gagal, dipakai apa adanya:", (err as Error).message);
  }
  const bytes = await sharp(sumber).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(siap, bytes);
  return bytes;
}

async function main() {
  const dir = path.resolve(arg("dir") ?? "");
  const berkasProduk = arg("produk");
  const foto = arg("foto");
  const sampai = (arg("sampai") ?? "susun") as (typeof TAHAP)[number];
  if (!dir || !berkasProduk || !foto || !TAHAP.includes(sampai)) {
    console.error("Pakai: --dir <folder> --produk <json> --foto <gambar> [--sampai naskah|keyframe|klip|susun]");
    process.exit(2);
  }
  fs.mkdirSync(dir, { recursive: true });
  const produk = JSON.parse(fs.readFileSync(berkasProduk, "utf8")) as ProdukIklan;
  const biayaPath = path.join(dir, "biaya.json");
  const biaya: Record<string, number> = fs.existsSync(biayaPath) ? JSON.parse(fs.readFileSync(biayaPath, "utf8")) : {};
  const simpanBiaya = () => fs.writeFileSync(biayaPath, JSON.stringify({ ...biaya, total_idr: Object.entries(biaya).filter(([k]) => k !== "total_idr").reduce((t, [, v]) => t + v, 0) }, null, 2));

  const acuan = await fotoAcuan(foto, produk.nama, dir);

  // 1. NASKAH
  const berkasNaskah = path.join(dir, "naskah.json");
  if (bendera("ulang-naskah") || !fs.existsSync(berkasNaskah)) {
    const t0 = Date.now();
    const { naskah, percobaan, usage } = await tulisNaskahIklan(produk, { gambarProduk: acuan, catatan: arg("catatan") });
    fs.writeFileSync(berkasNaskah, JSON.stringify(naskah, null, 2));
    // claude-opus-5: $5/1M input, $25/1M output; kurs perkiraan Rp16.500/USD.
    biaya.naskah_llm_idr = (biaya.naskah_llm_idr ?? 0) + Math.round(((usage.input * 5 + usage.output * 25) / 1e6) * 16500);
    simpanBiaya();
    console.log(`[uji] naskah: ${naskah.shots.length} shot, ${percobaan} percobaan, ${Math.round((Date.now() - t0) / 1000)}s`);
  }
  const naskah = JSON.parse(fs.readFileSync(berkasNaskah, "utf8")) as NaskahIklan;
  if (sampai === "naskah") return;

  // 2. KEYFRAME + KURASI
  //
  // Setiap gambar dinilai terhadap maksud shot-nya; yang ditolak digambar ulang
  // dengan alasan penolakannya, maksimal dua putaran. Kurasi yang sudah lulus
  // disimpan per berkas, jadi menjalankan ulang tidak menilai ulang gambar yang
  // sama.
  const dirKf = path.join(dir, "keyframe");
  let kf = await buatKeyframes(naskah, acuan, dirKf);
  biaya.keyframe_idr = (biaya.keyframe_idr ?? 0) + kf.biayaIdr;
  simpanBiaya();
  const berkasKurasi = path.join(dirKf, "kurasi.json");
  const lulusSebelumnya: Record<string, number> = fs.existsSync(berkasKurasi) ? JSON.parse(fs.readFileSync(berkasKurasi, "utf8")) : {};
  const sidikBerkas = (p: string) => fs.statSync(p).size;
  const sudahLulus = (p: string) => lulusSebelumnya[path.basename(p)] === sidikBerkas(p);
  for (let putaran = 1; putaran <= 3 && !bendera("tanpa-kurasi"); putaran++) {
    const utama = kf.paths.map((_, i) => i).filter((i) => !sudahLulus(kf.paths[i]));
    const sesudah = new Map([...kf.sesudah].filter(([, p]) => !sudahLulus(p)));
    if (!utama.length && !sesudah.size) break;
    const { nilai, biayaIdr } = await kurasiKeyframes(naskah, kf.paths, acuan, { utama, sesudah });
    biaya.kurasi_idr = (biaya.kurasi_idr ?? 0) + biayaIdr;
    simpanBiaya();
    fs.writeFileSync(path.join(dirKf, `kurasi-putaran-${putaran}.json`), JSON.stringify(nilai, null, 2));
    const catatan = new Map<number, string>();
    const catatanSesudah = new Map<number, string>();
    for (const v of nilai) {
      const i = v.shot - 1;
      if (i < 0 || i >= kf.paths.length) continue;
      const berkas = v.bagian === "sesudah" ? kf.sesudah.get(i) : kf.paths[i];
      if (!berkas || !fs.existsSync(berkas)) continue;
      if (v.lulus) {
        lulusSebelumnya[path.basename(berkas)] = sidikBerkas(berkas);
      } else {
        console.log(`[uji] kurasi putaran ${putaran}: shot ${v.shot} ${v.bagian} DITOLAK — ${v.masalah.join("; ")}`);
        (v.bagian === "sesudah" ? catatanSesudah : catatan).set(i, catatanUlang(v));
      }
    }
    fs.writeFileSync(berkasKurasi, JSON.stringify(lulusSebelumnya, null, 2));
    if (!catatan.size && !catatanSesudah.size) break;
    if (putaran === 3) {
      console.log(`[uji] ${catatan.size + catatanSesudah.size} gambar masih ditolak setelah 2 kali gambar ulang — dilanjutkan, dicatat untuk reviewer.`);
      break;
    }
    for (const i of catatan.keys()) {
      fs.renameSync(kf.paths[i], kf.paths[i].replace(/\.jpg$/, `.tolak${putaran}.jpg`));
      // Gambar SESUDAH diturunkan dari gambar sebelum; bila sebelumnya diganti, sesudahnya ikut.
      const s = kf.sesudah.get(i);
      if (s && fs.existsSync(s)) fs.renameSync(s, s.replace(/\.jpg$/, `.tolak${putaran}.jpg`));
    }
    for (const i of catatanSesudah.keys()) {
      const s = kf.sesudah.get(i)!;
      if (fs.existsSync(s)) fs.renameSync(s, s.replace(/\.jpg$/, `.tolak${putaran}.jpg`));
    }
    kf = await buatKeyframes(naskah, acuan, dirKf, { catatan, catatanSesudah });
    biaya.keyframe_idr = (biaya.keyframe_idr ?? 0) + kf.biayaIdr;
    simpanBiaya();
  }
  if (sampai === "keyframe") return;

  // 3. KLIP + VO
  const klip = await buatKlip(naskah, kf.paths, kf.sesudah, path.join(dir, "klip"), `iklan-uji-${path.basename(dir)}`);
  biaya.klip_idr = klip.biayaIdr;
  biaya.klip_kredit_kie = klip.kredit;
  const vo = await buatVo(naskah, path.join(dir, "vo"));
  biaya.vo_idr = (biaya.vo_idr ?? 0) + vo.biayaIdr;
  simpanBiaya();
  if (sampai === "klip") return;

  // 4. SUSUN + GERBANG
  const musik = path.join(process.cwd(), "assets", "music", arg("musik") ?? "bg-bed.m4a");
  const hasil = await susunIklan({
    naskah, klip: klip.paths, klipSesudah: klip.sesudah, keyframes: kf.paths, fotoProduk: [await sharp(foto).jpeg({ quality: 95 }).toBuffer(), fs.readFileSync(path.join(dir, "foto-acuan.jpg"))],
    kalimat: vo.kalimat, musik, dir: path.join(dir, "hasil"), kontak: produk.kontak,
  });
  const gerbang = await periksaIklan({ video: hasil.path, naskah, produk, slot: hasil.slot, total: hasil.total, dir: path.join(dir, "hasil") });
  fs.writeFileSync(path.join(dir, "hasil", "gerbang.json"), JSON.stringify(gerbang, null, 2));
  for (const x of gerbang) console.log(`${x.lulus ? "LULUS" : "GAGAL"}  ${x.id} — ${x.nilai}`);
  console.log(`[uji] selesai: ${hasil.path} (${hasil.total.toFixed(2)} dtk). Biaya: ${fs.readFileSync(biayaPath, "utf8")}`);
}

main().then(() => process.exit(0)).catch((err) => {
  console.error("[uji] GAGAL:", err instanceof Error ? err.stack ?? err.message : err);
  process.exit(1);
});
