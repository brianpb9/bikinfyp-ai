// SUMBU MODE — kontrak kamera + talent, 14 mode.
//
// Sampai 19 Agu `mode` cuma string metadata: penulis LLM mengisinya, planner
// tidak pernah membacanya, dan tabel 14 mode beserta kontraknya hidup di luar
// app (skill Claude) sehingga kalimat gerbang di dokumennya sendiri — "Any
// segment whose camera contradicts its governing mode fails the gate" — tidak
// pernah bisa berlaku. Audit A4.
//
// Sumbernya DIBACA dari knowledge/rules/modes.md, bukan disalin ke sini.
// Menyalin tabel ke kode adalah cara dokumen dan mesin berpisah diam-diam —
// pola yang sudah terjadi pada docs-sumber/ dan knowledge/rules.md.

import fs from "node:fs";
import path from "node:path";

export interface ModeKamera {
  /** Id huruf besar seperti di dokumen: GENERAL, SELFIE, ASMR, ... */
  id: string;
  /** Kontrak kamera — masuk ke prompt shot apa adanya. */
  kamera: string;
  /** Kontrak talent — apa yang dilakukan orangnya. */
  talent: string;
  /** Paling cocok untuk apa (kolom "Best for"). */
  cocok: string;
  /** Larangan keras (kolom "Never"). */
  jangan: string;
}

function muat(): ModeKamera[] {
  try {
    const file = path.join(process.cwd(), "knowledge", "rules", "modes.md");
    const teks = fs.readFileSync(file, "utf8");
    const hasil: ModeKamera[] = [];
    for (const baris of teks.split("\n")) {
      // Baris tabel: | MODE | kamera | talent | best for | never |
      if (!baris.startsWith("|")) continue;
      const kolom = baris.split("|").map((k) => k.trim());
      // kolom[0] kosong (sebelum pipe pertama), kolom[6] kosong (sesudah terakhir)
      if (kolom.length < 7) continue;
      const id = kolom[1];
      if (!/^[A-Z][A-Z_]{2,}$/.test(id)) continue; // lewati header & garis pemisah
      hasil.push({ id, kamera: kolom[2], talent: kolom[3], cocok: kolom[4], jangan: kolom[5] });
    }
    return hasil;
  } catch {
    // Gagal-diam DILARANG di sini: mode yang hilang berarti prompt kehilangan
    // kontrak kameranya tanpa ada yang tahu. Tapi melempar saat impor akan
    // mematikan seluruh proses web hanya karena satu berkas catatan — jadi
    // daftarnya kosong dan pemanggil memperlakukannya sebagai "mode tak
    // dikenal" (lihat kontrakMode), yang sudah punya perilaku aman.
    console.warn("[mode-kamera] knowledge/rules/modes.md tidak terbaca — sumbu mode mati, prompt jalan tanpa kontrak kamera.");
    return [];
  }
}

export const MODE_KAMERA: ModeKamera[] = muat();

const PETA = new Map(MODE_KAMERA.map((m) => [m.id.toUpperCase(), m]));

/** Kontrak satu mode, atau null bila tidak dikenal. Case-insensitive. */
export function kontrakMode(id: string | null | undefined): ModeKamera | null {
  if (!id) return null;
  return PETA.get(String(id).trim().toUpperCase()) ?? null;
}

export function modeDikenal(id: string | null | undefined): boolean {
  return kontrakMode(id) !== null;
}

/**
 * Kalimat kamera siap-tempel untuk prompt shot.
 *
 * Mengembalikan null untuk mode tak dikenal — pemanggil memakai framing
 * bawaan formatnya. Mode karangan TIDAK diteruskan ke prompt: model akan
 * memperlakukan kata asing itu sebagai gaya visual dan hasilnya tak bisa
 * ditebak.
 */
export function framingUntukMode(id: string | null | undefined): string | null {
  const m = kontrakMode(id);
  return m ? m.kamera : null;
}

/**
 * Blok kontrak lengkap untuk prompt: kamera + talent + larangan.
 *
 * Larangan ditulis sebagai kalimat POSITIF-nya kalau memungkinkan? Tidak —
 * kolom "Never" di dokumen memang bentuk larangan, dan larangan tentang
 * KAMERA (bukan tentang orang) tidak memicu penyaring penyedia; yang dilarang
 * detektor kita adalah negasi tentang ORANG. Karena itu ia aman dikirim,
 * dan gerbang prompt akhir tetap memeriksanya seperti teks lain.
 */
export function blokKontrakMode(id: string | null | undefined): string {
  const m = kontrakMode(id);
  if (!m) return "";
  return `Camera mode ${m.id}: ${m.kamera}. The person on screen is ${m.talent}.`;
}
