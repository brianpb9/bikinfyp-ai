// Duplikat sengaja dari app/_components/flow.ts's rupiah() — file itu "use
// client" (state alur bikin-video di sessionStorage), jadi tidak bisa
// diimpor dari Server Component dashboard (layout.tsx/page.tsx keduanya
// server-side, butuh pg query langsung).
export function rupiah(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}

// Dashboard brand memakai satuan TOKEN, bukan rupiah (lihat lib/tokens.ts
// untuk alasan kurs 1:1 dan mengapa retail sengaja tidak ikut berubah).
// Diekspor ulang dari sini supaya Server Component dashboard tidak perlu tahu
// asal-usulnya, sama seperti rupiah() di atas.
export { tokens, formatTokens, idrToTokens } from "@/lib/tokens";
