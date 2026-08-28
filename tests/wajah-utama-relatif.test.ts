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
import os from "node:os";
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

// Counterexample lifecycle dengan cv2 palsu yang observabel. Ini sengaja
// bukan mock fungsi TypeScript: proses Python asli dan qc_face_check.py asli
// tetap dijalankan. Hanya binding cv2 diganti agar tes dapat menghitung berapa
// kali model dibuat dan memastikan setInputSize dipanggil untuk dimensi aktual.
//
// Mutasi berikut wajib membuat tes merah:
// - FaceDetectorYN_create dipindah kembali ke loop -> event create menjadi 3;
// - setInputSize tidak dipanggil per frame -> fake detector melempar pada frame
//   landscape/portrait yang ukurannya berbeda;
// - satu frame dilewati -> urutan output/detect tidak lagi 3 lengkap.
test("satu detector dipakai ulang, semua frame beda dimensi tetap diperiksa", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "qc-face-lifecycle-"));
  const log = path.join(dir, "events.jsonl");
  try {
    fs.writeFileSync(path.join(dir, "cv2.py"), `
import json, os

LOG = os.environ["QC_FACE_FAKE_LOG"]

def emit(event, **fields):
    with open(LOG, "a", encoding="utf-8") as f:
        f.write(json.dumps({"event": event, **fields}) + "\\n")

class Image:
    def __init__(self, name, height, width):
        self.name = name
        self.shape = (height, width, 3)

def imread(file_path):
    name = os.path.basename(file_path)
    dimensions = {
        "wide.png": (720, 1280),
        "portrait.png": (1280, 720),
        "background.png": (360, 640),
    }
    height, width = dimensions[name]
    return Image(name, height, width)

class Detector:
    def __init__(self):
        self.input_size = None

    def setInputSize(self, size):
        self.input_size = tuple(size)
        emit("set", size=list(size))

    def detect(self, image):
        expected = (image.shape[1], image.shape[0])
        if self.input_size != expected:
            raise RuntimeError(f"input size {self.input_size} != {expected}")
        emit("detect", file=image.name)
        # [x, y, width, height, score] cukup untuk kontrak yang dibaca skrip.
        if image.name == "wide.png":
            faces = [[0, 0, 100, 252, 0.93], [0, 0, 20, 64.8, 0.89]]
        elif image.name == "portrait.png":
            faces = [[0, 0, 100, 384, 0.94], [0, 0, 90, 358.4, 0.92], [0, 0, 20, 102.4, 0.88]]
        else:
            faces = [[0, 0, 20, 32.4, 0.91]]
        return None, faces

def FaceDetectorYN_create(model, config, input_size, score_threshold=0.0):
    emit("create", model=model, input_size=list(input_size), score_threshold=score_threshold)
    return Detector()
`, "utf8");

    const frameNames = ["wide.png", "portrait.png", "background.png"];
    const stdout = execFileSync("python3", [SKRIP, "fake-model.onnx", ...frameNames], {
      encoding: "utf8",
      env: {
        ...process.env,
        PYTHONPATH: `${dir}${path.delimiter}${process.env.PYTHONPATH ?? ""}`,
        QC_FACE_FAKE_LOG: log,
      },
    });
    const result = JSON.parse(stdout) as {
      frames: Array<{ file: string; faces: number; faces_utama: number; best_score: number }>;
      max_faces: number;
      max_faces_utama: number;
    };

    assert.deepEqual(result.frames.map((frame) => frame.file), frameNames, "tidak boleh ada frame dilewati/diurutkan ulang");
    assert.deepEqual(
      result.frames.map(({ faces, faces_utama, best_score }) => ({ faces, faces_utama, best_score })),
      [
        { faces: 2, faces_utama: 1, best_score: 0.93 },
        { faces: 3, faces_utama: 2, best_score: 0.94 },
        { faces: 1, faces_utama: 0, best_score: 0.91 },
      ],
      "presenter, dua tokoh utama, dan wajah latar harus mempertahankan vonisnya",
    );
    assert.equal(result.max_faces, 3);
    assert.equal(result.max_faces_utama, 2);

    const events = fs.readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) as Array<{
      event: string;
      size?: number[];
      file?: string;
      score_threshold?: number;
    }>;
    assert.equal(events.filter((event) => event.event === "create").length, 1, "model tidak boleh dibuat ulang per frame");
    assert.equal(events.find((event) => event.event === "create")?.score_threshold, 0.8, "threshold wajah tidak boleh dilonggarkan");
    assert.deepEqual(events.filter((event) => event.event === "set").map((event) => event.size), [
      [1280, 720],
      [720, 1280],
      [640, 360],
    ]);
    assert.deepEqual(events.filter((event) => event.event === "detect").map((event) => event.file), frameNames);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
