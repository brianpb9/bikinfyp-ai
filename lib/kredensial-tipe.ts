/**
 * Tipe kredensial, DIPISAH supaya bisa dipakai komponen klien.
 *
 * lib/kredensial.ts mengimpor pool Postgres, dan `pg` menarik `fs`. Sekali
 * berkas "use client" menyentuh modul itu — bahkan hanya untuk tipenya —
 * webpack ikut menyeret seluruh rantainya ke bundle browser dan build gagal
 * dengan "Can't resolve 'fs'". Ketahuan saat build, bukan saat typecheck.
 *
 * Modul ini WAJIB tetap bebas impor. Pola yang sama dengan lib/tokens.ts.
 */

export type KelompokKredensial = "Video & AI" | "Pembayaran" | "Email & Login" | "Penyimpanan";

export type BarisTampilan = {
  nama: string;
  label: string;
  kelompok: KelompokKredensial;
  rahasia: boolean;
  terisi: boolean;
  /** Nilai yang aman ditampilkan — sudah disamarkan bila rahasia. */
  contoh: string;
  sumber: "database" | "env" | "kosong";
  updated_at?: string;
  updated_by?: string;
};
