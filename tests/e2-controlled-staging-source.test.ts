import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import http from "node:http";

process.env.RACUN_NO_DOTENV = "1";

const STAGING_SERVICE = "srv-d9n28tijnfac73a87lt0";
const PRODUCT = "https://racun-ai-staging-web.onrender.com/api/staging-fixtures/e2/product";
const IMAGE = "https://racun-ai-staging-web.onrender.com/staging-fixtures/e2-product.svg";
const REDIRECT_PRIVATE = "https://racun-ai-staging-web.onrender.com/api/staging-fixtures/e2/redirect-private";
const safety = await import("../lib/url-safety");
const safeRemote = await import("../lib/safe-remote-fetch");
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
    let dnsCalls=0;
    const publicThenPrivate=(async()=>{dnsCalls+=1;return dnsCalls===1?[{address:"8.8.8.8",family:4}]:[{address:"127.0.0.1",family:4}]}) as unknown as typeof import("node:dns").promises.lookup;
    const resolved=await safety.validateMarketplaceFetchUrl(PRODUCT,publicThenPrivate);
    assert.equal(resolved.ok,true);
    assert.equal(dnsCalls,1);
    if(!resolved.ok)throw new Error("public first lookup unexpectedly rejected");
    const pinned=safeRemote.createPinnedLookup(resolved.addresses);
    const connected=await new Promise<{address:string;family:number}>((resolve,reject)=>pinned("racun-ai-staging-web.onrender.com",{family:0},((error:Error|null,address:string,family:number)=>error?reject(error):resolve({address,family})) as never));
    assert.deepEqual(connected,{address:"8.8.8.8",family:4});
    assert.equal(dnsCalls,1,"transport lookup must not perform the private second DNS resolution");
    const second=await publicThenPrivate("racun-ai-staging-web.onrender.com",{all:true,verbatim:true});
    assert.equal(safety.isPrivateOrReservedIp((second as {address:string}[])[0].address),true,"regression prerequisite: second DNS answer is private");
    assert.equal(safety.validateMarketplaceUrl("https://shopee.co.id@127.0.0.1/x").ok, false);
    const transport=fs.readFileSync(new URL("../lib/safe-remote-fetch.ts",import.meta.url),"utf8"),images=fs.readFileSync(new URL("../lib/product-image-download.ts",import.meta.url),"utf8");
    assert.match(transport,/lookup:createPinnedLookup\(\[address\]\)/);
    assert.match(transport,/servername:url\.protocol==="https:"\?url\.hostname/);
    assert.match(images,/safeRemoteGet\(url,\{kind:"public"/);
    assert.match(images,/hopAllowed:controlled\?isControlledStagingImageUrl/);
  } finally {
    if (previous === undefined) delete process.env.RENDER_SERVICE_ID;
    else process.env.RENDER_SERVICE_ID = previous;
  }
});

test("complete non-global IPv4, IPv6, and mapped ranges are rejected",()=>{
  for(const ip of ["0.1.2.3","10.0.0.1","100.64.0.1","127.0.0.1","169.254.1.1","172.31.0.1","192.0.2.1","192.88.99.1","192.168.1.1","198.18.0.1","198.51.100.1","203.0.113.1","224.0.0.1","255.255.255.255","::","::1","fc00::1","fe80::1","ff02::1","2001:db8::1","2002:7f00:1::","3fff::1","3fff:0fff:ffff::1","::ffff:127.0.0.1","::ffff:7f00:1","::ffff:6440:1"])assert.equal(safety.isPrivateOrReservedIp(ip),true,ip);
  for(const ip of ["8.8.8.8","1.1.1.1","2606:4700:4700::1111","::ffff:8.8.8.8"])assert.equal(safety.isPrivateOrReservedIp(ip),false,ip);
});

async function withHttpServer(handler:http.RequestListener,run:(port:number)=>Promise<void>){
  const server=http.createServer(handler);await new Promise<void>((resolve,reject)=>server.listen(0,"127.0.0.1",resolve).once("error",reject));
  const address=server.address();if(!address||typeof address==="string")throw new Error("test server address unavailable");
  try{await run(address.port)}finally{await new Promise<void>(resolve=>server.close(()=>resolve()))}
}

test("pinned response rejects truncated and oversized bodies without hanging",async()=>{
  await withHttpServer((_req,res)=>{res.writeHead(200,{"content-length":"100"});res.write("short");setTimeout(()=>res.destroy(),10)},async port=>{
    await assert.rejects(safeRemote.requestPinnedForTests(new URL(`http://fixture.test:${port}/truncated`),[{address:"127.0.0.1",family:4}],{},Date.now()+500,1024),/aborted|complete|socket/i);
  });
  await withHttpServer((_req,res)=>{res.writeHead(200);res.end(Buffer.alloc(256,1))},async port=>{
    await assert.rejects(safeRemote.requestPinnedForTests(new URL(`http://fixture.test:${port}/oversized`),[{address:"127.0.0.1",family:4}],{},Date.now()+500,32),/batas byte/);
  });
});

test("one absolute deadline spans redirects, slow trickle, and address attempts",async()=>{
  await withHttpServer((req,res)=>{
    if(req.url==="/start"){setTimeout(()=>{res.writeHead(302,{location:"/slow"});res.end()},35);return}
    res.writeHead(200);const timer=setInterval(()=>res.write("x"),25);res.once("close",()=>clearInterval(timer));
  },async port=>{
    const resolver=async(raw:string)=>({ok:true as const,url:new URL(raw),addresses:[{address:"127.0.0.2",family:4},{address:"127.0.0.1",family:4}]});
    const started=Date.now(),result=await safeRemote.safeRemoteGetWithResolverForTests(`http://fixture.test:${port}/start`,{kind:"public",timeoutMs:90,maxBytes:1024},resolver);
    const elapsed=Date.now()-started;assert.equal(result.ok,false);if(result.ok)assert.fail("deadline unexpectedly succeeded");
    assert.match(result.error,/absolute deadline/);assert.ok(elapsed>=70&&elapsed<300,`deadline elapsed ${elapsed}ms`);
  });
});

test("committed fixture is harmless synthetic SVG", () => {
  const svg = fs.readFileSync(new URL("../public/staging-fixtures/e2-product.svg", import.meta.url), "utf8");
  assert.match(svg, /NOVA SERUM/);
  assert.doesNotMatch(svg, /<script|javascript:|data:/i);
});
