// Duplikat sengaja dari app/_components/flow.ts's rupiah() — file itu "use
// client" (state alur bikin-video di sessionStorage), jadi tidak bisa
// diimpor dari Server Component dashboard (layout.tsx/page.tsx keduanya
// server-side, butuh pg query langsung).
export function rupiah(n: number): string {
  return "Rp" + n.toLocaleString("id-ID");
}
