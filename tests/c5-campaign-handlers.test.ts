import assert from "node:assert/strict";
import test from "node:test";

import {
  PATCH as patchCampaignProduct,
  POST as createCampaignProduct,
} from "../app/api/dashboard/campaign/product/route";
import { setCampaignProductDependenciesForTests } from "../lib/campaign-product-dependencies";

const now="2026-08-27T20:00:00.000Z";
const context={user:{id:"member-1"},membership:{org_id:"org-1",role:"member"}};
const request=(method:string,body:unknown)=>new Request("http://local/api/dashboard/campaign/product",{
  method,headers:{"content-type":"application/json"},body:JSON.stringify(body),
});

function product(overrides:Record<string,unknown>={}):Record<string,any> {
  return {id:"product-1",user_id:"member-1",org_id:"org-1",name:"Serum",price_idr:60_000,
    category:"beauty",product_type_token:"serum wajah",product_type_confirmed_token:"serum wajah",
    product_type_confirmed_by:"member-1",product_type_confirmed_at:now,product_type_version:1,
    product_type_state:"CONFIRMED",category_review_state:"CLEAR",category_review_reason:null,
    category_reviewed_by:null,category_reviewed_role:null,category_reviewed_at:null,
    category_review_version:1,product_visual_desc:null,brand_brief:null,claims:null,
    promo_price_before_idr:null,promo_ends_at:null,promo_stock_left:null,images:"[]",source_url:null,...overrides};
}

test("C5 E6 actual handler durably quarantines UNKNOWN/AMBIGUOUS/BUNDLE with no downstream setup",async(t)=>{
  t.after(()=>setCampaignProductDependenciesForTests());
  const created:Record<string,unknown>[]=[];
  const audits:string[]=[];
  let poolCalls=0,downloads=0;
  setCampaignProductDependenciesForTests({
    postgresRuntimeEnabled:()=>true,requireOrgContextApi:async()=>context as never,
    smokeCreateProduct:async(_actor,input,id)=>{created.push(input as never);return product({id,
      category:(input as {category:string}).category,category_review_state:(input as {categoryReviewState:string}).categoryReviewState,
      category_review_reason:(input as {categoryReviewReason:string}).categoryReviewReason,
      category_review_version:(input as {categoryReviewVersion:number}).categoryReviewVersion}) as never;},
    pgAudit:async(_actor,action)=>{audits.push(action);},
    getPool:(()=>{poolCalls++;throw new Error("E6 quarantine reached database setup pool");}) as never,
    downloadProductImages:async()=>{downloads++;throw new Error("E6 quarantine downloaded images");},
    now:()=>now,uuid:()=>"00000000-0000-4000-8000-000000000001",
  });
  for (const [outcome,reason] of [["UNKNOWN","CATEGORY_UNKNOWN"],["AMBIGUOUS","CATEGORY_AMBIGUOUS"],["BUNDLE","CATEGORY_BUNDLE"]] as const) {
    const response=await createCampaignProduct(request("POST",{name:`Produk ${outcome}`,price_idr:60_000,
      category:"beauty",category_outcome:outcome,product_type:"serum wajah",confirmed_product_type:"serum wajah"}));
    assert.equal(response.status,202,await response.clone().text());
    const body=await response.json() as {category_review:{state:string;reason:string};images:unknown[]};
    assert.deepEqual(body.category_review,{state:"QUARANTINED",reason,reviewed_by:null,reviewed_role:null,reviewed_at:null,version:1});
    assert.deepEqual(body.images,[]);
  }
  assert.equal(created.length,3); assert.equal(audits.length,3);
  assert.equal(poolCalls,0); assert.equal(downloads,0);
});

test("C5 E7 actual handler re-quarantines changed released category and preserves same-category release",async(t)=>{
  t.after(()=>setCampaignProductDependenciesForTests());
  let row=product({category_review_state:"CLEAR",category_review_reason:null,
    category_reviewed_by:"founder-1",category_reviewed_role:"Founder/CEO",
    category_reviewed_at:now,category_review_version:2});
  let quarantineAudits=0;
  const client={
    async query(sql:string,values:unknown[]=[]){
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {rows:[],rowCount:null};
      if (sql.includes("UPDATE products SET")) {
        row={...row,name:String(values[0]),price_idr:Number(values[1]),category:String(values[2]),
          category_review_state:String(values[11]),category_review_reason:values[12],
          category_reviewed_by:values[13],category_reviewed_role:values[14],category_reviewed_at:values[15],
          category_review_version:Number(values[16])};
        return {rows:[],rowCount:1};
      }
      if (sql.includes("INSERT INTO audit_log")) {quarantineAudits++;return {rows:[],rowCount:1};}
      throw new Error(`Unexpected SQL: ${sql}`);
    },release(){},
  };
  setCampaignProductDependenciesForTests({postgresRuntimeEnabled:()=>true,
    requireOrgContextApi:async()=>context as never,withProductEvidenceMutationLock:async(_id,operation)=>operation(),
    smokeGetOrgProduct:async()=>row as never,getPool:(()=>({connect:async()=>client})) as never,
    databaseUrl:()=>"test",pgAudit:async()=>undefined,now:()=>now,
    uuid:()=>"00000000-0000-4000-8000-000000000002"});

  const changed=await patchCampaignProduct(request("PATCH",{product_id:"product-1",category:"health",category_outcome:"KNOWN"}));
  assert.equal(changed.status,202,await changed.clone().text());
  assert.equal(row.category_review_state,"QUARANTINED");
  assert.equal(row.category_review_reason,"CATEGORY_UNKNOWN");
  assert.equal(row.category_reviewed_by,null); assert.equal(row.category_review_version,3);
  assert.equal(quarantineAudits,1);

  row=product({category_review_state:"CLEAR",category_review_reason:null,
    category_reviewed_by:"founder-1",category_reviewed_role:"Founder/CEO",
    category_reviewed_at:now,category_review_version:2});
  const unchanged=await patchCampaignProduct(request("PATCH",{product_id:"product-1",category:"beauty",category_outcome:"KNOWN"}));
  assert.equal(unchanged.status,200,await unchanged.clone().text());
  assert.equal(row.category_review_state,"CLEAR"); assert.equal(row.category_review_version,2);
  assert.equal(row.category_reviewed_by,"founder-1");
  assert.equal(quarantineAudits,1);
});
