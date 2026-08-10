// Avatar library v2 (2026-08-10) — UI display data (nama, foto, gender)
// untuk kategori kreator di lib/personas.ts. id di sini WAJIB match
// CreatorCategory.id (lib/personas.ts) — itu yang divalidasi backend saat
// job dibuat, ini cuma lapisan tampilan.
//
// Duplikat SENGAJA dari app/bikin/gaya/page.tsx & app/promo/page.tsx (yang
// masing-masing punya salinannya sendiri) — belum direfactor ke sini untuk
// menghindari resiko regresi di alur retail yang sudah live/teruji. Modul
// ini dipakai HANYA oleh dashboard enterprise (F-ENT-01, M6). Kalau nanti
// ada waktu buat cleanup, ketiga tempat ini pantas disatukan.
export type AvatarGender = "female" | "male";
export interface AvatarPreset {
  id: string;
  name: string;
  note: string;
  img: string;
  gender: AvatarGender;
}

export const AVATAR_PRESETS: AvatarPreset[] = [
  { id: "hijaber", name: "Salma", note: "paling laris di TikTok Shop", img: "/avatars/salma.png", gender: "female" },
  { id: "genz", name: "Zea", note: "gadget, fashion, F&B", img: "/avatars/zea.png", gender: "female" },
  { id: "ibu", name: "Bunda Ratih", note: "rumah tangga, dapur, anak", img: "/avatars/ratih.png", gender: "female" },
  { id: "chindo", name: "Keisha", note: "skincare premium", img: "/avatars/keisha.png", gender: "female" },
  { id: "lokal", name: "Dina", note: "cocok semua produk", img: "/avatars/dina.png", gender: "female" },
  { id: "pria", name: "Raka", note: "gadget, F&B, produk pria", img: "/avatars/raka.png", gender: "male" },
  { id: "genzpria", name: "Fajar", note: "gadget, fashion, F&B", img: "/avatars/genzpria.png", gender: "male" },
  { id: "bapak", name: "Pak Danu", note: "rumah tangga, gadget", img: "/avatars/bapak.png", gender: "male" },
  { id: "senior", name: "Pak Herman", note: "kesehatan, gadget", img: "/avatars/senior.png", gender: "male" },
  { id: "profesional", name: "Bimo", note: "gadget, formal", img: "/avatars/profesional.png", gender: "male" },
  { id: "lokalpria", name: "Yoga", note: "cocok semua produk", img: "/avatars/lokalpria.png", gender: "male" },
];
