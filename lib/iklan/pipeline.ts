/**
 * PIPELINE IKLAN SINEMATIK — satu jalur, dipakai CLI uji DAN worker job.
 *
 * Dipisah dari scripts/iklan-uji.ts supaya jalur yang dijalankan pengguna lewat
 * antrean job PERSIS jalur yang diuji berhari-hari: naskah (dengan audit klaim
 * dan audit realitas) -> gambar kunci + kurasi -> klip + kurasi klip ->
 * VO -> perakitan -> gerbang. Setiap tahap menyimpan hasilnya di `dir`, dan
 * tahap yang sudah punya hasil DILEWATI — worker yang mengulang job tidak
 * membayar ulang apa yang sudah jadi.
 *
 * Status beta (keputusan Brian 15 Sep 2026, opsi 1B): format ini hanya boleh
 * dipakai admin lewat /admin/iklan; mutunya belum lulus gerbang studio (review
 * independen terakhir: Reject, 4/10 terhadap Blueprint).
 */

import fs from "node:fs";
import path from "node:path";
import sharp from "sharp";
import { kategoriNaskah, tulisNaskahIklan, type NaskahIklan, type ProdukIklan } from "./naskah";
import { buatKeyframes } from "./keyframe";
import { buatKlip, type MesinVideo } from "./klip";
import { buatVo } from "./suara";
import { susunIklan, type SlotShot } from "./susun";
import { periksaIklan, type HasilGerbang } from "./gerbang";
import { catatanUlang, kurasiKeyframes } from "./kurasi";
import { idKlip, kurasiKlip, type KlipDinilai } from "./kurasi-klip";

export interface MasukanPipeline {
  produk: ProdukIklan;
  /** Foto produk asli penjual (berkas lokal). */
  foto: string;
  /** Folder kerja; semua hasil antara disimpan di sini dan bisa dilanjutkan. */
  dir: string;
  /** Penanda unik untuk URL gambar yang diterbitkan ke penyedia video. */
  id: string;
  mesin?: MesinVideo;
  musik?: string;
  catatan?: string;
  /** Dipanggil tiap pergantian tahap — worker memakainya untuk memindah state job. */
  onTahap?: (tahap: "naskah" | "gambar" | "klip" | "suara" | "rakit" | "gerbang") => Promise<void> | void;
}

export interface HasilPipeline {
  path: string;
  total: number;
  slot: SlotShot[];
  naskah: NaskahIklan;
  gerbang: HasilGerbang[];
  biaya: Record<string, number>;
}

/** Foto acuan: poster dipotong ke produknya, lalu disimpan sebagai JPEG. */
export async function siapkanFotoAcuan(foto: string, namaProduk: string, dir: string): Promise<Buffer> {
  const siap = path.join(dir, "foto-acuan.jpg");
  if (fs.existsSync(siap)) return fs.readFileSync(siap);
  fs.mkdirSync(dir, { recursive: true });
  let sumber = foto;
  try {
    const { periksaFotoProduk, AMBANG_KATA_BANNER } = await import("../media/foto-produk");
    const periksa = await periksaFotoProduk(foto);
    if (periksa.kataTerbaca >= AMBANG_KATA_BANNER) {
      const { potongKeProduk } = await import("../media/potong-produk");
      const hasil = await potongKeProduk(foto, namaProduk, path.join(dir, "potong"));
      console.log(`[iklan] foto poster (${periksa.kataTerbaca} kata) — ${hasil.alasan}`);
      sumber = hasil.path;
    }
  } catch (err) {
    console.warn("[iklan] pemeriksaan/pemotongan foto gagal, dipakai apa adanya:", (err as Error).message);
  }
  const bytes = await sharp(sumber).jpeg({ quality: 92 }).toBuffer();
  fs.writeFileSync(siap, bytes);
  return bytes;
}

export async function jalankanIklan(m: MasukanPipeline): Promise<HasilPipeline> {
  const mesin = m.mesin ?? "standard";
  const dir = m.dir;
  fs.mkdirSync(dir, { recursive: true });
  const biayaPath = path.join(dir, "biaya.json");
  const biaya: Record<string, number> = fs.existsSync(biayaPath) ? JSON.parse(fs.readFileSync(biayaPath, "utf8")) : {};
  const simpan = () => fs.writeFileSync(biayaPath, JSON.stringify({
    ...biaya,
    total_idr: Object.entries(biaya).filter(([k]) => k.endsWith("_idr") && k !== "total_idr").reduce((t, [, v]) => t + v, 0),
  }, null, 2));
  const rupiahLlm = (u: { input: number; output: number }) => Math.round(((u.input * 5 + u.output * 25) / 1e6) * 16500);

  const acuan = await siapkanFotoAcuan(m.foto, m.produk.nama, dir);

  /* 1. NASKAH */
  await m.onTahap?.("naskah");
  const berkasNaskah = path.join(dir, "naskah.json");
  if (!fs.existsSync(berkasNaskah)) {
    try {
      const { naskah, percobaan, usage } = await tulisNaskahIklan(m.produk, { gambarProduk: acuan, catatan: m.catatan });
      fs.writeFileSync(berkasNaskah, JSON.stringify(naskah, null, 2));
      biaya.naskah_llm_idr = (biaya.naskah_llm_idr ?? 0) + rupiahLlm(usage);
      simpan();
      console.log(`[iklan] naskah: ${naskah.shots.length} shot, ${percobaan} percobaan`);
    } catch (err) {
      const u = (err as { usage?: { input: number; output: number } }).usage;
      if (u) { biaya.naskah_llm_idr = (biaya.naskah_llm_idr ?? 0) + rupiahLlm(u); simpan(); }
      throw err;
    }
  }
  const naskah = JSON.parse(fs.readFileSync(berkasNaskah, "utf8")) as NaskahIklan;
  const kategori = kategoriNaskah(naskah, m.produk);

  /* 2. GAMBAR KUNCI + KURASI */
  await m.onTahap?.("gambar");
  const tanpaWajah = mesin === "ultra"; // Seedance menolak gambar berwajah
  const dirKf = path.join(dir, tanpaWajah ? "keyframe-ultra" : "keyframe");
  let kf = await buatKeyframes(naskah, acuan, dirKf, { kategori, tanpaWajah });
  biaya.keyframe_idr = (biaya.keyframe_idr ?? 0) + kf.biayaIdr;
  simpan();
  const berkasKurasi = path.join(dirKf, "kurasi.json");
  const lulus: Record<string, number> = fs.existsSync(berkasKurasi) ? JSON.parse(fs.readFileSync(berkasKurasi, "utf8")) : {};
  const sidik = (p: string) => fs.statSync(p).size;
  const sudahLulus = (p: string) => lulus[path.basename(p)] === sidik(p);
  for (let putaran = 1; putaran <= 3; putaran++) {
    const utama = kf.paths.map((_, i) => i).filter((i) => !sudahLulus(kf.paths[i]));
    const sesudah = new Map([...kf.sesudah].filter(([, p]) => !sudahLulus(p)));
    if (!utama.length && !sesudah.size) break;
    const { nilai, biayaIdr } = await kurasiKeyframes(naskah, kf.paths, acuan, { utama, sesudah }, kategori, tanpaWajah);
    biaya.kurasi_idr = (biaya.kurasi_idr ?? 0) + biayaIdr;
    simpan();
    const catatan = new Map<number, string>();
    const catatanSesudah = new Map<number, string>();
    for (const v of nilai) {
      const i = v.shot - 1;
      const berkas = v.bagian === "sesudah" ? kf.sesudah.get(i) : kf.paths[i];
      if (!berkas || !fs.existsSync(berkas)) continue;
      if (v.lulus) lulus[path.basename(berkas)] = sidik(berkas);
      else {
        console.log(`[iklan] kurasi ${putaran}: shot ${v.shot} ${v.bagian} ditolak — ${v.masalah.join("; ")}`);
        (v.bagian === "sesudah" ? catatanSesudah : catatan).set(i, catatanUlang(v));
      }
    }
    fs.writeFileSync(berkasKurasi, JSON.stringify(lulus, null, 2));
    if ((!catatan.size && !catatanSesudah.size) || putaran === 3) break;
    for (const i of catatan.keys()) {
      fs.renameSync(kf.paths[i], kf.paths[i].replace(/\.jpg$/, `.tolak${putaran}.jpg`));
      const s = kf.sesudah.get(i);
      if (s && fs.existsSync(s)) fs.renameSync(s, s.replace(/\.jpg$/, `.tolak${putaran}.jpg`));
    }
    for (const i of catatanSesudah.keys()) {
      const s = kf.sesudah.get(i)!;
      if (fs.existsSync(s)) fs.renameSync(s, s.replace(/\.jpg$/, `.tolak${putaran}.jpg`));
    }
    kf = await buatKeyframes(naskah, acuan, dirKf, { catatan, catatanSesudah, kategori, tanpaWajah });
    biaya.keyframe_idr = (biaya.keyframe_idr ?? 0) + kf.biayaIdr;
    simpan();
  }

  /* 3. KLIP + KURASI KLIP */
  await m.onTahap?.("klip");
  const dirKlip = path.join(dir, mesin === "ultra" ? "klip-ultra" : "klip");
  let klip = await buatKlip(naskah, kf.paths, kf.sesudah, dirKlip, `${m.id}-${mesin}`, kategori, mesin);
  biaya[`klip_${mesin}_idr`] = klip.biayaIdr;
  simpan();
  const berkasKurasiKlip = path.join(dirKlip, "kurasi-klip.json");
  const batasAman: Record<string, number | null> = fs.existsSync(berkasKurasiKlip) ? JSON.parse(fs.readFileSync(berkasKurasiKlip, "utf8")) : {};
  const daftarKlip = (): KlipDinilai[] => [
    ...klip.paths.map((p, i) => ({ id: p ? idKlip(p) : "", path: p, shot: i, sesudah: false })).filter((k) => k.path),
    ...[...klip.sesudah].map(([i, p]) => ({ id: idKlip(p), path: p, shot: i, sesudah: true })),
  ];
  for (let putaran = 1; putaran <= 2; putaran++) {
    const belum = daftarKlip().filter((k) => !(k.id in batasAman));
    if (!belum.length) break;
    const { nilai, biayaIdr } = await kurasiKlip(naskah, belum, kategori);
    biaya.kurasi_klip_idr = (biaya.kurasi_klip_idr ?? 0) + biayaIdr;
    simpan();
    const ulang: KlipDinilai[] = [];
    for (const v of nilai) {
      const k = belum.find((x) => x.id === v.klip);
      if (!k) continue;
      if (!v.lulus) console.log(`[iklan] kurasi klip ${putaran}: ${v.klip} aman sampai ${v.aman_sampai_detik ?? "—"}s — ${v.masalah.join("; ")}`);
      const terlaluPendek = v.aman_sampai_detik === null || v.aman_sampai_detik < 1.6;
      if (!v.lulus && terlaluPendek && putaran === 1) ulang.push(k);
      else batasAman[k.id] = v.lulus ? 99 : v.aman_sampai_detik;
    }
    fs.writeFileSync(berkasKurasiKlip, JSON.stringify(batasAman, null, 2));
    if (!ulang.length) break;
    for (const k of ulang) {
      fs.renameSync(k.path, k.path.replace(/\.mp4$/, ".tolak.mp4"));
      fs.rmSync(k.path.replace(/\.mp4$/, ".task"), { force: true });
    }
    klip = await buatKlip(naskah, kf.paths, kf.sesudah, dirKlip, `${m.id}-${mesin}`, kategori, mesin);
    biaya[`klip_${mesin}_idr`] = klip.biayaIdr;
    simpan();
  }

  /* 4. SUARA */
  await m.onTahap?.("suara");
  const vo = await buatVo(naskah, path.join(dir, "vo"));
  biaya.vo_idr = (biaya.vo_idr ?? 0) + vo.biayaIdr;
  simpan();

  /* 5. PERAKITAN */
  await m.onTahap?.("rakit");
  const musik = m.musik ?? path.join(process.cwd(), "assets", "music", "bg-bed.m4a");
  const dirHasil = path.join(dir, mesin === "ultra" ? "hasil-ultra" : "hasil");
  const hasil = await susunIklan({
    naskah, klip: klip.paths, klipSesudah: klip.sesudah, keyframes: kf.paths,
    fotoProduk: [await sharp(m.foto).jpeg({ quality: 95 }).toBuffer(), acuan],
    kalimat: vo.kalimat, musik, dir: dirHasil, kontak: m.produk.kontak, batasAman,
  });

  /* 6. GERBANG */
  await m.onTahap?.("gerbang");
  const gerbang = await periksaIklan({ video: hasil.path, naskah, produk: m.produk, slot: hasil.slot, total: hasil.total, dir: dirHasil });
  fs.writeFileSync(path.join(dirHasil, "gerbang.json"), JSON.stringify(gerbang, null, 2));
  for (const g of gerbang) console.log(`${g.lulus ? "LULUS" : "GAGAL"}  ${g.id} — ${g.nilai}`);

  // total_idr dihitung dari kunci *_idr saja — uji Ultra pertama menjumlahkan
  // token dan kredit kie.ai sebagai rupiah (948.402 untuk biaya ±119 rb).
  const total_idr = Object.entries(biaya)
    .filter(([k]) => k.endsWith("_idr") && k !== "total_idr")
    .reduce((t, [, v]) => t + v, 0);
  return { path: hasil.path, total: hasil.total, slot: hasil.slot, naskah, gerbang, biaya: { ...biaya, total_idr } };
}
