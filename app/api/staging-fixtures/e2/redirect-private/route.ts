import { controlledStagingFixtureEnabled } from "@/lib/url-safety";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  if (!controlledStagingFixtureEnabled()) return new Response("Not found", { status: 404 });
  return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest/meta-data" } });
}
