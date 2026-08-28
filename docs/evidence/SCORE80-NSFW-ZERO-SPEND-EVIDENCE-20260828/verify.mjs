#!/usr/bin/env node
import fs from "node:fs";
const root=new URL("../../../",import.meta.url);
const read=(name)=>fs.readFileSync(new URL(name,root),"utf8");
const module=read("lib/nsfw-kpi.mjs"),script=read("scripts/laporan-nsfw.mjs"),fixture=read("tests/nsfw-zero-spend-evidence.test.ts");
if(!module.includes("CONTENT_REJECTION_PATTERN_SOURCE")||!module.includes("summarizeNsfwAggregates"))throw new Error("NSFW KPI module missing");
if(!script.includes('from "../lib/nsfw-kpi.mjs"'))throw new Error("production report not wired to shared KPI module");
for(const token of ["cost_actual_idr,0","provider_video,null","releases.n,1","isProviderContentRejection(failed.reason),true"])
  if(!fixture.includes(token))throw new Error(`zero-spend fixture guard missing: ${token}`);
console.log(JSON.stringify({result:"PASS",scope:"DETERMINISTIC_ZERO_SPEND_NO_SCORE",provider_calls:0,production_mutations:0}));
