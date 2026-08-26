import http from "node:http";
import https from "node:https";
import type { LookupAddress } from "node:dns";
import type { LookupFunction } from "node:net";
import { resolvePublicFetchUrl, validateMarketplaceFetchUrl, type ResolvedPublicUrl } from "./url-safety";

export type SafeRemoteResult = { ok: true; status: number; headers: http.IncomingHttpHeaders; body: Buffer; finalUrl: string } | { ok: false; status: number; error: string };
type SafeRemoteOptions={kind:"marketplace"|"public";headers?:Record<string,string>;timeoutMs?:number;maxBytes?:number;maxRedirects?:number;hopAllowed?:(url:string)=>boolean};
let testOverride:((raw:string,options:SafeRemoteOptions)=>Promise<SafeRemoteResult>)|undefined;
export function setSafeRemoteGetForTests(override:typeof testOverride):void{testOverride=override}

/** Transport lookup backed only by already-validated addresses. No second DNS
 * query is possible between validation and connect; HTTPS still receives the
 * original URL hostname for SNI/certificate checks and the Host header. */
export function createPinnedLookup(addresses: LookupAddress[]): LookupFunction {
  return ((_: string, options: unknown, callback: (...args: unknown[]) => void) => {
    const family = typeof options === "object" && options && "family" in options ? Number((options as {family?:number}).family ?? 0) : Number(options ?? 0);
    const eligible = family === 4 || family === 6 ? addresses.filter((entry) => entry.family === family) : addresses;
    if (!eligible.length) return callback(Object.assign(new Error("no validated address for requested family"), { code: "ENOTFOUND" }));
    if (typeof options === "object" && options && "all" in options && (options as {all?:boolean}).all) return callback(null, eligible);
    callback(null, eligible[0].address, eligible[0].family);
  }) as LookupFunction;
}

export async function requestPinnedForTests(url: URL, addresses: LookupAddress[], headers: Record<string,string>, deadlineAt: number, maxBytes: number): Promise<{status:number;headers:http.IncomingHttpHeaders;body:Buffer}> {
  let last: unknown;
  for (const address of addresses) {
    if(Date.now()>=deadlineAt)throw new Error("absolute deadline exceeded");
    try {
      return await new Promise((resolve,reject)=>{
        const client=url.protocol==="https:"?https:http;
        let settled=false;const finish=(error?:unknown,value?:{status:number;headers:http.IncomingHttpHeaders;body:Buffer})=>{if(settled)return;settled=true;clearTimeout(deadline);error?reject(error):resolve(value!)};
        const req=client.request(url,{method:"GET",headers,lookup:createPinnedLookup([address]),servername:url.protocol==="https:"?url.hostname:undefined},res=>{
          const chunks:Buffer[]=[];let size=0;
          const fail=(error:unknown)=>{finish(error);res.destroy();req.destroy()};
          res.on("data",chunk=>{const b=Buffer.from(chunk);size+=b.length;if(size>maxBytes){fail(new Error("response melewati batas byte"));return}chunks.push(b)});
          res.once("aborted",()=>fail(new Error("response aborted before complete")));
          res.once("error",fail);
          res.once("end",()=>finish(undefined,{status:res.statusCode??0,headers:res.headers,body:Buffer.concat(chunks)}));
        });
        const deadline=setTimeout(()=>req.destroy(new Error("absolute deadline exceeded")),Math.max(1,deadlineAt-Date.now()));
        req.once("error",finish);req.end();
      });
    } catch (error) { last=error; }
  }
  throw last instanceof Error?last:new Error("all validated addresses failed");
}

type Resolver=(raw:string,kind:"marketplace"|"public")=>Promise<ResolvedPublicUrl>;
const productionResolver:Resolver=(raw,kind)=>kind==="marketplace"?validateMarketplaceFetchUrl(raw):resolvePublicFetchUrl(raw);
async function resolveBeforeDeadline(resolver:Resolver,raw:string,kind:"marketplace"|"public",deadlineAt:number):Promise<ResolvedPublicUrl>{
  const remaining=deadlineAt-Date.now();if(remaining<=0)throw new Error("absolute deadline exceeded");
  let timer:ReturnType<typeof setTimeout>|undefined;
  try{return await Promise.race([resolver(raw,kind),new Promise<never>((_,reject)=>{timer=setTimeout(()=>reject(new Error("absolute deadline exceeded during DNS resolution")),remaining)})])}
  finally{if(timer)clearTimeout(timer)}
}
export async function safeRemoteGetWithResolverForTests(raw:string,options:SafeRemoteOptions,resolver:Resolver):Promise<SafeRemoteResult>{
  let current=raw;const timeoutMs=options.timeoutMs??8000,maxBytes=options.maxBytes??12*1024*1024,maxRedirects=options.maxRedirects??3;
  const deadlineAt=Date.now()+timeoutMs;
  try{
    for(let redirects=0;redirects<=maxRedirects;redirects+=1){
      if(Date.now()>=deadlineAt)throw new Error("absolute deadline exceeded");
      if(options.hopAllowed&&!options.hopAllowed(current))return{ok:false,status:0,error:"redirect/source provenance ditolak"};
      const resolved=await resolveBeforeDeadline(resolver,current,options.kind,deadlineAt);
      if(!resolved.ok)return{ok:false,status:0,error:`url ditolak: ${resolved.reason}`};
      const response=await requestPinnedForTests(resolved.url,resolved.addresses,options.headers??{},deadlineAt,maxBytes);
      if(response.status>=300&&response.status<400){const location=response.headers.location;if(!location)return{ok:false,status:response.status,error:"redirect tanpa location"};current=new URL(location,current).toString();continue}
      return{ok:true,...response,finalUrl:current};
    }
    return{ok:false,status:0,error:"terlalu banyak redirect"};
  }catch(error){return{ok:false,status:0,error:error instanceof Error?error.message:String(error)}}
}

export async function safeRemoteGet(raw:string,options:SafeRemoteOptions):Promise<SafeRemoteResult>{
  if(testOverride)return testOverride(raw,options);
  return safeRemoteGetWithResolverForTests(raw,options,productionResolver);
}
