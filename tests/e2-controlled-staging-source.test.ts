import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

process.env.RACUN_NO_DOTENV = "1";

const STAGING_SERVICE = "srv-d9n28tijnfac73a87lt0";
const PRODUCT = "https://racun-ai-staging-web.onrender.com/api/staging-fixtures/e2/product";
const IMAGE = "https://racun-ai-staging-web.onrender.com/staging-fixtures/e2-product.svg";
const REDIRECT_PRIVATE = "https://racun-ai-staging-web.onrender.com/api/staging-fixtures/e2/redirect-private";
const safety = await import("../lib/url-safety");
const fixture = await import("../app/api/staging-fixtures/e2/product/route");

test("E2 controlled source is exact and staging-service bound", async () => {
  const previous = process.env.RENDER_SERVICE_ID;
  try {
    process.env.RENDER_SERVICE_ID = STAGING_SERVICE;
    assert.equal(safety.validateMarketplaceUrl(PRODUCT).ok, true);
    assert.equal(safety.validateMarketplaceUrl(REDIRECT_PRIVATE).ok, true);
    assert.equal(safety.isControlledStagingImageUrl(IMAGE), true);
    for (const url of [
      "https://racun-ai-staging-web.onrender.com/api/staging-fixtures/e2/product/child",
      "https://racun-ai-staging-web.onrender.com/api/staging-fixtures/e2/product?q=1",
      "https://sibling-racun-ai-staging-web.onrender.com/api/staging-fixtures/e2/product",
      "https://example.com/api/staging-fixtures/e2/product",
      "http://169.254.169.254/api/staging-fixtures/e2/product",
    ]) assert.equal(safety.validateMarketplaceUrl(url).ok, false, url);
    assert.equal(safety.isControlledStagingImageUrl(`${IMAGE}?bypass=1`), false);

    const response = await fixture.GET();
    assert.equal(response.status, 200);
    const html = await response.text();
    assert.match(html, /NOVA Controlled Staging Serum 30ml/);
    assert.equal((html.match(/https:\/\/racun-ai-staging-web\.onrender\.com\/staging-fixtures\/e2-product\.svg/g) ?? []).length, 2);
  } finally {
    if (previous === undefined) delete process.env.RENDER_SERVICE_ID;
    else process.env.RENDER_SERVICE_ID = previous;
  }
});

test("E2 exception does not exist in production identity", async () => {
  const previous = process.env.RENDER_SERVICE_ID;
  try {
    process.env.RENDER_SERVICE_ID = "srv-d9nhccfqj5pc73et9hrg";
    assert.equal(safety.validateMarketplaceUrl(PRODUCT).ok, false);
    assert.equal(safety.isControlledStagingImageUrl(IMAGE), false);
    assert.equal((await fixture.GET()).status, 404);
  } finally {
    if (previous === undefined) delete process.env.RENDER_SERVICE_ID;
    else process.env.RENDER_SERVICE_ID = previous;
  }
});

test("E2 DNS/private and redirect boundaries stay fail-closed", async () => {
  const previous = process.env.RENDER_SERVICE_ID;
  try {
    process.env.RENDER_SERVICE_ID = STAGING_SERVICE;
    const privateLookup = (async () => [{ address: "169.254.169.254", family: 4 }]) as unknown as typeof import("node:dns").promises.lookup;
    const rebinding = await safety.validateMarketplaceFetchUrl(PRODUCT, privateLookup);
    assert.equal(rebinding.ok, false);
    assert.match(rebinding.reason ?? "", /privat|internal/);
    assert.equal(safety.validateMarketplaceUrl("https://shopee.co.id@127.0.0.1/x").ok, false);
    const source = fs.readFileSync(new URL("../lib/extract.ts", import.meta.url), "utf8");
    assert.match(source, /redirect: "manual"/);
    assert.ok(source.indexOf("validateMarketplaceFetchUrl(current)") < source.indexOf("fetch(current"));
    assert.match(source, /current = new URL\(location, current\)\.toString\(\)/);
  } finally {
    if (previous === undefined) delete process.env.RENDER_SERVICE_ID;
    else process.env.RENDER_SERVICE_ID = previous;
  }
});

test("committed fixture is harmless synthetic SVG", () => {
  const svg = fs.readFileSync(new URL("../public/staging-fixtures/e2-product.svg", import.meta.url), "utf8");
  assert.match(svg, /NOVA SERUM/);
  assert.doesNotMatch(svg, /<script|javascript:|data:/i);
});
