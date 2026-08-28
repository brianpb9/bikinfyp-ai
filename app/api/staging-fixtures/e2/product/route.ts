import { controlledStagingFixtureEnabled } from "@/lib/url-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!controlledStagingFixtureEnabled()) return new Response("Not found", { status: 404 });
  const image = "https://racun-ai-staging-web.onrender.com/staging-fixtures/e2-product.svg";
  const html = `<!doctype html><html><head><meta property="og:title" content="NOVA Controlled Staging Serum 30ml"><meta property="og:image" content="${image}"><meta property="og:description" content="Botol serum krem NOVA 30ml dengan tutup abu-abu."><script type="application/ld+json">{"@context":"https://schema.org","@type":"Product","name":"NOVA Controlled Staging Serum 30ml","image":"${image}","offers":{"@type":"Offer","price":"13000","priceCurrency":"IDR"}}</script></head><body>Controlled staging fixture</body></html>`;
  return new Response(html, { status: 200, headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
