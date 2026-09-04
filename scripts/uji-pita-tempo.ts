/**
 * UJI A/B/C: apakah pita tempo LAYER2 §5.1 benar-benar menyembuhkan mulut beku?
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * DUA DUGAAN YANG DIUJI TERPISAH
 * ─────────────────────────────────────────────────────────────────────────────
 * LAYER2 §5.1 mengukur: Grok 3,53 kata/dtk -> mulut beku 0 dtk; 3,13 -> beku 3
 * dtk. Batas produksi kita 16-22 kata per 15 detik = 1,07-1,47 kata/detik,
 * JAUH di bawah keduanya.
 *
 * LAYER2 §7.2 mendaftar kata pembeku mulut untuk Grok, dan "pauses" ada di
 * dalamnya. Prompt produksi kita (shot-planner) menyuruh presenter bicara
 * "at a relaxed, unhurried pace with natural pauses between sentences".
 *
 * Jadi ada DUA dugaan, dan menggabungkannya dalam satu perbandingan hanya
 * menghasilkan "lebih baik" tanpa tahu sebabnya — yang berarti kita tidak tahu
 * mana yang harus diubah di kode. Tiga varian memisahkannya:
 *
 *   A  22 kata + "unhurried pace with natural pauses"   <- PRODUKSI SEKARANG
 *   B  50 kata + "unhurried pace with natural pauses"   <- jumlah kata saja
 *   C  50 kata + arahan aktif tanpa kata pembeku        <- keduanya
 *
 * A vs B mengukur sumbangan jumlah kata. B vs C mengukur sumbangan kata
 * pembeku. Biaya tiga klip Standard 15 dtk = Rp20.250, untuk keputusan yang
 * menyentuh seluruh konten yang kita produksi.
 *
 * DIUKUR dengan qcLipSync (QC-01) — pelacak wajah YuNet, sama dengan yang
 * dipakai produksi. Bukan selisih piksel kotak mulut, yang bohong saat kepala
 * bergerak (LAYER3 §11).
 *
 *   RENDER_CONFIRM=YA npx tsx scripts/uji-pita-tempo.ts <kunci-gambar>
 */
import fs from "node:fs";
import path from "node:path";
import { generateVideoWithFailover } from "../lib/providers/registry";
import { qcLipSync } from "../lib/media/qc";
import { mediaStorage } from "../lib/storage";
import { MANDATORY_NEGATIVE_PROMPT } from "../lib/config/compliance";

if (process.env.RENDER_CONFIRM !== "YA") {
  console.error("Ditolak: ini render berbayar. Ulangi dengan RENDER_CONFIRM=YA.");
  process.exit(1);
}
const kunci = process.argv[2];
if (!kunci) throw new Error("Sebutkan kunci gambar produk.");

// Adegan IDENTIK untuk ketiganya — hanya dialog dan arahan bicara yang berbeda.
const ADEGAN =
  "A young Indonesian woman sits at a clean home table facing the camera, the product in her hands, " +
  "phone camera look, natural daylight from a window, plain unbranded surfaces";

// 22 kata — batas atas jendelaKata kita untuk 15 detik (1,47 kata/detik).
const DIALOG_PENDEK =
  "Meja kerja aku dulu berantakan banget sih. Sekarang rapi, kabelnya masuk semua. " +
  "Cek keranjang kuning ya kak";

// 50 kata — pita Haul/twist LAYER2 §5.1 untuk 8-20 detik (3,3 kata/detik).
const DIALOG_PITA =
  "Jadi meja kerja aku dulu tuh berantakan banget, kabel di mana-mana, mau kerja aja males duluan. " +
  "Terus aku coba yang ini, dan ternyata kabelnya bisa masuk semua ke dalam. " +
  "Sekarang tiap buka laptop rasanya beda banget, lebih niat. " +
  "Buat kamu yang mejanya juga berantakan, cek keranjang kuning ya kak";

// Arahan bicara PERSIS seperti produksi (shot-planner talking_head presenter).
const ARAHAN_SEKARANG =
  "The presenter speaks casually to camera in Indonesian at a relaxed, unhurried pace with natural " +
  "pauses between sentences, enunciating every word completely with clear separation between words — " +
  "like a real person chatting with a friend, easy and unsalesy, saying: ";

// Arahan AKTIF — LAYER2 §7.2: bicara sepanjang klip, tanpa kata pembeku mulut.
const ARAHAN_AKTIF =
  "The presenter launches straight into the line and talks briskly to camera in Indonesian, " +
  "eyebrows already up, speaking continuously for the entire clip with her lips moving on every " +
  "syllable and never falling silent while her voice is heard, saying: ";

// 33 kata — titik TENGAH antara 17 dan 49. Ditambahkan 4 Sep 2026 karena
// batas BAWAH jendela akan diambil dari sini, dan menebaknya berarti menukar
// satu asumsi dengan asumsi lain. Arahan aktif dipakai, sebab itu yang akan
// berjalan di produksi.
const DIALOG_TENGAH =
  "Meja kerja aku dulu berantakan banget, kabel di mana-mana, mau kerja aja males. " +
  "Terus coba yang ini, kabelnya masuk semua ke dalam. " +
  "Sekarang tiap buka laptop rasanya lebih niat. Cek keranjang kuning ya kak";

const VARIAN = [
  { nama: "A-produksi", kata: 22, dialog: DIALOG_PENDEK, arahan: ARAHAN_SEKARANG },
  { nama: "B-pita", kata: 50, dialog: DIALOG_PITA, arahan: ARAHAN_SEKARANG },
  { nama: "C-pita-aktif", kata: 50, dialog: DIALOG_PITA, arahan: ARAHAN_AKTIF },
  { nama: "D-tengah-aktif", kata: 33, dialog: DIALOG_TENGAH, arahan: ARAHAN_AKTIF },
];
// Hanya varian yang disebut di UJI_VARIAN yang dirender — supaya ulangan tidak
// membayar lagi untuk titik yang sudah diukur.
const pilih = (process.env.UJI_VARIAN ?? "").split(",").map((x) => x.trim()).filter(Boolean);

const OUT = "/tmp/uji-pita";
fs.mkdirSync(OUT, { recursive: true });
const gambar = await mediaStorage().materialize(kunci);
if (!gambar) throw new Error(`gambar tidak ada: ${kunci}`);

const hasil: Record<string, unknown>[] = [];
for (const v of VARIAN.filter((v) => !pilih.length || pilih.includes(v.nama))) {
  const dir = path.join(OUT, v.nama);
  fs.mkdirSync(dir, { recursive: true });
  const prompt = `${ADEGAN}. ${v.arahan}"${v.dialog}".`;
  const kataAsli = v.dialog.split(/\s+/).filter(Boolean).length;
  try {
    const r = await generateVideoWithFailover({
      jobId: `pita-${v.nama}`, width: 720, height: 1280,
      shots: [{ index: 0, durationSec: 15, prompt, imageRefPath: gambar }],
      negativePrompt: MANDATORY_NEGATIVE_PROMPT, qualityTier: "standard", generateAudio: true,
    } as never, dir);
    const f = r.assets[0].filePath;
    fs.mkdirSync(`${dir}/qc`, { recursive: true });
    const lip = await qcLipSync(f, `${dir}/qc`);
    console.log(
      `${v.nama.padEnd(13)} ${kataAsli} kata (${(kataAsli / 15).toFixed(2)} k/dtk)  ` +
        `Rp${r.costIdr.toLocaleString("id-ID")}  QC-01=${lip.status}  ${lip.detail ?? ""}`,
    );
    hasil.push({ varian: v.nama, kata: kataAsli, kata_per_detik: +(kataAsli / 15).toFixed(2), biaya: r.costIdr, qc01: lip.status, detail: lip.detail, video: f });
  } catch (e) {
    console.log(`${v.nama.padEnd(13)} ERROR ${(e as Error).message}`);
    hasil.push({ varian: v.nama, error: (e as Error).message });
  }
}
console.log(`\n${JSON.stringify(hasil, null, 2)}`);
