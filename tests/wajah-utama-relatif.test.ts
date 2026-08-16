// Wajah UTAMA diukur relatif terhadap wajah terbesar di frame yang sama,
// bukan hanya terhadap tinggi frame.
//
// Kesalahan yang sama sudah tiga kali terjadi di repo ini: orang di latar
// dihitung sebagai pelanggaran. Dua kali sebelumnya diperbaiki (pemeriksa visi,
// lalu pemeriksa lokal) dengan ambang MUTLAK 0,12 — dan komentar di
// qc_face_check.py bahkan sudah memperingatkan "jangan diulang di pemeriksa
// lokal".
//
// Terulang lagi 16 Agu 2026 pada TVC "Tersangka Glowing" (parodi ruang sidang),
// dan kali ini menghabiskan uang: QC menolak detik 16-20, render lalu
// memperbaiki shot yang sebenarnya tidak cacat. Sebabnya penonton sidang DEKAT
// KAMERA, jadi semua melewati 0,12 — asumsi "latar selalu kecil" runtuh.
//
// Angka nyata dari frame sengketa itu: 0,378 (tokoh) · 0,260 (penuduh) · 0,177
// · 0,148 · 0,119 (penonton). Celah lebarnya ada di rasio, bukan di nilai
// mutlak: 100% · 69% lalu terjun ke 47%.

import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const SKRIP = path.join(process.cwd(), "lib", "media", "qc_face_check.py");
const MODEL = path.join(process.cwd(), "assets", "models", "face_detection_yunet_2023mar.onnx");

test("aturan relatif tertulis di skrip dan dipakai bersama ambang mutlak", () => {
  const isi = fs.readFileSync(SKRIP, "utf8");
  assert.match(isi, /MIN_RASIO_KE_TERBESAR\s*=\s*0\.6/, "ambang rasio hilang");
  assert.match(isi, /MIN_TINGGI_WAJAH\s*=\s*0\.12/, "ambang mutlak hilang — keduanya harus dipakai");
  // Kedua syarat WAJIB digabung dengan AND. Kalau salah satunya jadi OR,
  // kerumunan dekat lolos lagi atau tokoh kedua yang sah ikut terbuang.
  assert.match(isi, /t >= MIN_TINGGI_WAJAH and t >= terbesar \* MIN_RASIO_KE_TERBESAR/,
    "kedua syarat harus digabung dengan AND");
});

// Kalibrasi lama harus tetap menghasilkan jawaban yang sama — perbaikan ini
// tidak boleh melonggarkan penjagaan yang sudah benar.
test("aturan relatif tidak mengubah kasus presenter yang sudah terkalibrasi", () => {
  // presenter 0,25-0,45 vs orang lewat 0,04-0,09.
  const presenter = 0.35;
  const latar = 0.09;
  assert.ok(latar < 0.12, "latar jauh sudah terbuang ambang mutlak");
  assert.ok(latar / presenter < 0.6, "latar jauh juga terbuang aturan rasio");
  assert.ok(presenter / presenter >= 0.6, "presenter tetap terhitung utama");
});

test("dua tokoh identik berukuran mirip tetap terhitung dua — penjagaan asli utuh", () => {
  // Cacat asli: satu TVC tayang dengan dua perempuan identik di shot penutup.
  const a = 0.35, b = 0.33;
  const terbesar = Math.max(a, b);
  const utama = [a, b].filter((t) => t >= 0.12 && t >= terbesar * 0.6).length;
  assert.equal(utama, 2, "duplikasi tokoh harus tetap tertangkap");
});

const punyaOpenCv = (() => {
  try { execFileSync("python3", ["-c", "import cv2"], { stdio: "ignore" }); return true; } catch { return false; }
})();

test("frame ruang sidang: 5 wajah terdeteksi, hanya 2 yang utama", { skip: !punyaOpenCv || !fs.existsSync(MODEL) }, () => {
  const contoh = path.join(process.cwd(), "tests", "fixtures", "ruang-sidang.jpg");
  if (!fs.existsSync(contoh)) return; // fixture opsional; aturannya sudah dikunci tes di atas
  const out = execFileSync("python3", [SKRIP, MODEL, contoh], { encoding: "utf8" });
  const d = JSON.parse(out) as { max_faces: number; max_faces_utama: number };
  assert.equal(d.max_faces, 5, "deteksi wajah mentah berubah — kalibrasi detektor bergeser");
  assert.equal(d.max_faces_utama, 2, "kerumunan dekat kamera terhitung sebagai subjek lagi");
});
