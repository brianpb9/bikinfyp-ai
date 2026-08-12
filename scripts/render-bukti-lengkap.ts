// BUKTI LENGKAP — menutup semua yang ditawarkan ke brand tapi belum pernah
// dirender sekali pun (permintaan Brian 2026-08-13: "render selesaikan semua").
//
// Yang dibuktikan:
//   5 gaya rekam sisa (selfie, meja, unboxing, mobil, meja kerja)
//   2 rute TVC baru (fabric, intimate) — shot pembuka DAN penutup
//   3 template UGC Ads baru
//
// KENAPA TVC HANYA 2 SHOT, bukan 6: yang perlu dibuktikan adalah apakah RUTE
// itu menghasilkan framing yang benar, dan itu paling terlihat di shot pembuka
// dan penutup. Khusus rute "fabric", penutupnya justru satu-satunya aturan
// baru yang paling mudah salah (dilarang packshot diam). Merender 6 shot per
// TVC berarti Rp50rb per rute untuk menjawab pertanyaan yang sama.
//
// Tiap klip menagih BytePlus. Gerbang RENDER_CONFIRM=YA wajib.
//
// Jalankan:
//   RENDER_CONFIRM=YA npx tsx scripts/render-bukti-lengkap.ts

import fs from "node:fs";
import path from "node:path";
import { planShots } from "../lib/media/shot-planner";
import { byteplusVideo } from "../lib/providers/stubs/byteplus";
import { getCreatorCategory } from "../lib/personas";
import { generateScripts, type ProductInput } from "../lib/script-engine";
import { getTemplate } from "../lib/templates";

// FOTO PRODUK POLOS, tanpa tangan. Percobaan pertama memakai frame yang sudah
// berisi tangan memegang botol, dan setiap gaya "tangan" cuma meniru
// komposisi itu — "Di Atas Meja" tidak pernah tampak-atas, "Unboxing" tanpa
// kardus sama sekali. Pengujiannya yang cacat, bukan gayanya.
const FOTO = path.resolve(process.cwd(), "..", "test_output",
  process.env.FOTO_PRODUK ?? "produk-polos.jpg");
const OUT = path.resolve(process.cwd(), "..", "test_output", process.env.OUT_DIR ?? "bukti_lengkap");

type Tugas = {
  id: string;
  label: string;
  format: "talking_head" | "hands_only" | "ads" | "tvc";
  recordStyle?: string;
  templateId?: string;
  /** Indeks shot yang dirender. Default [0]. */
  shots?: number[];
};

const TUGAS_LENGKAP: Tugas[] = [
  // --- 5 gaya rekam sisa ---
  { id: "gaya-selfie", label: "Gaya: Selfie", format: "talking_head", recordStyle: "selfie" },
  { id: "gaya-mobil", label: "Gaya: Di Mobil", format: "talking_head", recordStyle: "mobil" },
  { id: "gaya-meja-kerja", label: "Gaya: Meja Kerja", format: "talking_head", recordStyle: "meja_kerja" },
  { id: "gaya-meja", label: "Gaya: Di Atas Meja", format: "hands_only", recordStyle: "meja" },
  { id: "gaya-unboxing", label: "Gaya: Unboxing", format: "hands_only", recordStyle: "unboxing" },
  // --- 2 rute TVC baru: pembuka + penutup ---
  { id: "tvc-kain", label: "TVC: Kain yang Ikut Lari", format: "tvc", templateId: "tvc-kain-lari", shots: [0, 4] },
  { id: "tvc-jamtiga", label: "TVC: Jam Tiga Pagi", format: "tvc", templateId: "tvc-jam-tiga", shots: [0, 5] },
  // --- 3 UGC Ads baru ---
  { id: "ads-unboxing", label: "Ads: Unboxing dari Dalam Kardus", format: "talking_head", templateId: "ads-unboxing-pov" },
  { id: "ads-meja-kosong", label: "Ads: Meja Kosong", format: "ads", templateId: "ads-meja-kosong" },
  { id: "ads-panas", label: "Ads: Masalah Dilebih-lebihkan", format: "talking_head", templateId: "ads-panas-ekstrem" },
];

// Putaran kedua (2026-08-13): hanya yang gagal di putaran pertama. Tiga gaya
// yang sudah terbukti (standar, cermin, jalan) dan tiga yang berhasil (mobil,
// meja kerja, penutup TVC kain) TIDAK dirender ulang — membayar dua kali untuk
// jawaban yang sudah kita punya.
const HANYA = process.env.HANYA?.split(",").map((x) => x.trim()).filter(Boolean);
const TUGAS: Tugas[] = HANYA ? TUGAS_LENGKAP.filter((t) => HANYA.includes(t.id)) : TUGAS_LENGKAP;

async function main() {
  if (process.env.RENDER_CONFIRM !== "YA") {
    const klip = TUGAS.reduce((n, t) => n + (t.shots?.length ?? 1), 0);
    console.error(`Ditolak: ${klip} klip = uang sungguhan. Ulangi dengan RENDER_CONFIRM=YA.`);
    process.exit(1);
  }
  if (!fs.existsSync(FOTO)) throw new Error(`Foto produk tidak ada: ${FOTO}. Ingat: TIDAK BOLEH foto wajah asli.`);
  fs.mkdirSync(OUT, { recursive: true });

  const kategori = getCreatorCategory("hijaber")!;
  const produk: ProductInput = {
    id: "bukti", name: "Mosseru Bright Shower Gel", price_idr: 189000,
    category: "beauty", sourceUrl: null,
  };
  const [skrip] = generateScripts({
    product: produk, register: "bunda", qualityTier: "high_quality",
    durationSec: 15, count: 1, hookLevel: "berani",
  });

  const hasil: { label: string; berkas: string; detik: number; biaya: number }[] = [];
  let total = 0;

  for (const t of TUGAS) {
    const tpl = t.templateId ? getTemplate(t.templateId) : null;
    console.log(`\n--- ${t.label} ---`);
    const spec = planShots({
      jobId: t.id, durationSec: tpl?.durationSec ?? 15, segments: skrip.segments,
      category: kategori, productName: produk.name, productCategory: "beauty",
      imageRefPath: FOTO, qualityTier: "high_quality",
      format: t.format, hookLevel: tpl?.hookLevel ?? "berani",
      recordStyle: t.recordStyle, ugcTemplate: tpl?.id ?? null,
      tvcRoute: tpl?.tvcRoute, shotCountOverride: tpl?.shotCount, ratio: tpl?.ratio,
    });

    const pilih = (t.shots ?? [0]).filter((i) => i < spec.shots.length);
    for (const i of pilih) {
      const satu = { ...spec, shots: [{ ...spec.shots[i], index: 0 }] };
      const dir = path.join(OUT, `${t.id}-shot${i}`);
      fs.mkdirSync(dir, { recursive: true });
      console.log(`  shot ${i}: ${spec.shots[i].prompt.slice(0, 110)}...`);
      const mulai = Date.now();
      try {
        const aset = await byteplusVideo.generate(satu, dir);
        const detik = Math.round((Date.now() - mulai) / 1000);
        for (const a of aset) {
          total += a.costIdr;
          console.log(`  OK ${a.filePath} (${detik} dtk, Rp${a.costIdr.toLocaleString("id-ID")})`);
          hasil.push({ label: `${t.label} · shot ${i}`, berkas: a.filePath, detik, biaya: a.costIdr });
        }
      } catch (err) {
        // Satu gagal tidak boleh menghentikan sisanya — biaya yang sudah keluar
        // untuk tugas sebelumnya jadi sia-sia kalau begitu.
        console.error(`  GAGAL: ${err instanceof Error ? err.message : String(err)}`);
        hasil.push({ label: `${t.label} · shot ${i}`, berkas: "(gagal)", detik: 0, biaya: 0 });
      }
    }
  }

  console.log("\n=== RINGKASAN ===");
  for (const r of hasil) console.log(` ${r.label.padEnd(38)} Rp${String(r.biaya).padStart(6)}  ${r.berkas}`);
  console.log(` TOTAL: Rp${total.toLocaleString("id-ID")} untuk ${hasil.filter((r) => r.berkas !== "(gagal)").length} klip`);
  fs.writeFileSync(path.join(OUT, "ringkasan.json"), JSON.stringify({ total, hasil }, null, 2));
}

main().catch((e) => { console.error(e); process.exit(1); });
