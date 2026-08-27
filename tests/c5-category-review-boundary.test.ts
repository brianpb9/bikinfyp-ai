import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  assertCategoryReviewClear,
  authorizeCategoryReviewRelease,
  categoryReviewForMutation,
  deriveCategoryReview,
  deriveHeuristicCategoryReview,
  effectiveCategoryReviewRole,
  requireCanonicalC5Category,
} from "../lib/product-type-boundary";
import { CATEGORY_REVIEW_SQLITE_UPGRADE_GUARDS } from "../lib/db";
import { POST as releaseCategoryReview, setCategoryReviewReleaseDependenciesForTests } from
  "../app/api/dashboard/campaign/product/category-review/release/route";

test("C5 structured outcomes quarantine all three reasons without heuristic mapping", () => {
  assert.equal(deriveCategoryReview("default").reason, "CATEGORY_UNKNOWN");
  assert.equal(deriveCategoryReview("not-an-existing-id").reason, "CATEGORY_UNKNOWN");
  assert.equal(deriveCategoryReview("beauty", "UNKNOWN").reason, "CATEGORY_UNKNOWN");
  assert.equal(deriveCategoryReview("beauty", "AMBIGUOUS").reason, "CATEGORY_AMBIGUOUS");
  assert.equal(deriveCategoryReview("beauty", "BUNDLE").reason, "CATEGORY_BUNDLE");
  assert.deepEqual(deriveCategoryReview("beauty"), {
    state: "CLEAR", reason: null, reviewedBy: null, reviewedRole: null, reviewedAt: null, version: 1,
  });
});

test("C5 quarantine fails closed and product-type self confirmation has no release capability", () => {
  assert.throws(() => assertCategoryReviewClear(deriveCategoryReview("default")), /Authorized human category review/);
  assert.doesNotThrow(() => assertCategoryReviewClear(deriveCategoryReview("beauty")));
});

test("C5 release fails closed for missing/wrong role and records complete provenance", () => {
  const current = deriveCategoryReview("beauty", "AMBIGUOUS");
  const release = {
    actorId: "reviewer-1", actorRole: "Founder/CEO", reviewedAt: "2026-08-27T17:00:00.000Z",
    reason: "Verified single existing category from source evidence", expectedVersion: 1,
  };
  assert.throws(() => authorizeCategoryReviewRelease(current, release, ""), /role is missing or does not match/i);
  assert.throws(() => authorizeCategoryReviewRelease(current, release, "owner"), /role is missing or does not match/i);
  assert.throws(() => authorizeCategoryReviewRelease(current, {...release,actorRole:"owner"}, "owner"), /role is missing or does not match/i);
  assert.throws(() => authorizeCategoryReviewRelease(current, {...release,actorRole:"member"}, "member"), /role is missing or does not match/i);
  assert.deepEqual(authorizeCategoryReviewRelease(current, release, "Founder/CEO"), {
    state: "CLEAR", reason: null, reviewedBy: "reviewer-1", reviewedRole: "Founder/CEO",
    reviewedAt: "2026-08-27T17:00:00.000Z", version: 2,
  });
});

test("C5 release is optimistic-concurrency safe", () => {
  const current = deriveCategoryReview("beauty", "BUNDLE");
  assert.throws(() => authorizeCategoryReviewRelease(current, {
    actorId: "reviewer-1", actorRole: "Founder/CEO", reviewedAt: "2026-08-27T17:00:00.000Z",
    reason: "reviewed", expectedVersion: 2,
  }, "Founder/CEO"), /state changed or release evidence is incomplete/i);
});

test("C5 SQLite fresh schema distinguishes automatic KNOWN from authorized release and survives re-init", () => {
  const db = new Database(":memory:");
  try {
    db.exec(fs.readFileSync(new URL("../lib/schema.sql", import.meta.url), "utf8"));
    db.prepare("INSERT INTO users (id,phone,tier,locale,created_at) VALUES ('u','081','free','id-ID',?)")
      .run("2026-08-27T17:00:00.000Z");
    const insert = (id:string, review:{state:string;reason:string|null;by:string|null;role:string|null;at:string|null;version:number}) =>
      db.prepare(`INSERT INTO products (id,user_id,name,price_idr,category,product_type_token,
        product_type_confirmed_token,product_type_confirmed_by,product_type_confirmed_at,
        product_type_version,product_type_state,category_review_state,category_review_reason,
        category_reviewed_by,category_reviewed_role,category_reviewed_at,category_review_version,
        images,created_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`).run(
          id,"u","Serum",50_000,"beauty","serum wajah","serum wajah","u",
          "2026-08-27T17:00:00.000Z",1,"CONFIRMED",review.state,review.reason,
          review.by,review.role,review.at,review.version,"[]","2026-08-27T17:00:00.000Z",
        );

    insert("auto",{state:"CLEAR",reason:null,by:null,role:null,at:null,version:1});
    assert.throws(() => insert("forged-release",{state:"CLEAR",reason:null,by:null,role:null,at:null,version:2}), /CHECK constraint|invalid category review state/);
    insert("released",{state:"CLEAR",reason:null,by:"reviewer-1",role:"Founder/CEO",at:"2026-08-27T17:00:00.000Z",version:2});

    db.exec(CATEGORY_REVIEW_SQLITE_UPGRADE_GUARDS);
    db.exec(CATEGORY_REVIEW_SQLITE_UPGRADE_GUARDS);
    assert.deepEqual(db.prepare("SELECT category_review_state AS state,category_reviewed_by AS by,category_review_version AS version FROM products WHERE id='released'").get(),
      {state:"CLEAR",by:"reviewer-1",version:2});
  } finally { db.close(); }
});

test("C5 PostgreSQL migration has default quarantine reason and explicit NULL-safe shapes", () => {
  const migration=fs.readFileSync(new URL("../migrations/postgres/0037_category_review_quarantine.sql",import.meta.url),"utf8");
  assert.match(migration,/category_review_reason TEXT DEFAULT 'CATEGORY_UNKNOWN'/);
  assert.match(migration,/category_review_state = 'QUARANTINED'[\s\S]*category_review_reason IS NOT NULL/);
  assert.match(migration,/category_review_version = 1[\s\S]*category_reviewed_by IS NULL/);
  assert.match(migration,/category_review_version >= 2[\s\S]*category_reviewed_by IS NOT NULL/);
});

test("C5 URL extractor heuristic and client KNOWN cannot produce CLEAR in retail or campaign", () => {
  assert.deepEqual(deriveHeuristicCategoryReview("beauty"), {
    state:"QUARANTINED",reason:"CATEGORY_UNKNOWN",reviewedBy:null,reviewedRole:null,reviewedAt:null,version:1,
  });
  for (const rel of ["../app/api/products/extract/route.ts","../app/api/dashboard/campaign/product/route.ts"]) {
    const source=fs.readFileSync(new URL(rel,import.meta.url),"utf8");
    const heuristicAt=source.indexOf("deriveHeuristicCategoryReview(category)");
    const downloadAt=source.indexOf("downloadProductImages(productId",heuristicAt);
    assert.ok(heuristicAt > 0 && downloadAt > heuristicAt,`${rel}: heuristic quarantine must precede download`);
    const urlBlock=source.slice(Math.max(0,heuristicAt-180),downloadAt);
    assert.doesNotMatch(urlBlock,/category_outcome|parseStructuredCategoryOutcome/,
      `${rel}: URL classification must not trust client KNOWN`);
  }
});

test("C5 Founder/CEO authority binds only the explicit server-trusted principal", () => {
  const current=deriveCategoryReview("beauty","AMBIGUOUS");
  const release={actorId:"founder-1",actorRole:"Founder/CEO",reviewedAt:"2026-08-27T18:00:00.000Z",
    reason:"Founder reviewed source evidence",expectedVersion:1};
  const founder=effectiveCategoryReviewRole({configuredRole:"Founder/CEO",membershipRole:"owner",
    configuredPrincipalId:"founder-1",actorId:"founder-1"});
  assert.deepEqual(founder,{effectiveRole:"Founder/CEO",membershipRole:"owner",founderPrincipalId:"founder-1"});
  assert.equal(authorizeCategoryReviewRelease(current,{...release,actorRole:founder.effectiveRole},"Founder/CEO").reviewedRole,"Founder/CEO");

  const member=effectiveCategoryReviewRole({configuredRole:"Founder/CEO",membershipRole:"member",
    configuredPrincipalId:"founder-1",actorId:"member-1"});
  assert.throws(()=>authorizeCategoryReviewRelease(current,{...release,actorId:"member-1",actorRole:member.effectiveRole},"Founder/CEO"),/role is missing or does not match/i);
  const missing=effectiveCategoryReviewRole({configuredRole:"",membershipRole:"owner",
    configuredPrincipalId:"",actorId:"founder-1"});
  assert.throws(()=>authorizeCategoryReviewRelease(current,{...release,actorRole:missing.effectiveRole},""),/role is missing or does not match/i);
  const missingPrincipal=effectiveCategoryReviewRole({configuredRole:"Founder/CEO",membershipRole:"owner",
    configuredPrincipalId:"",actorId:"founder-1"});
  assert.equal(missingPrincipal.effectiveRole,"owner");
  const anotherOwner=effectiveCategoryReviewRole({configuredRole:"Founder/CEO",membershipRole:"owner",
    configuredPrincipalId:"founder-1",actorId:"owner-2"});
  assert.equal(anotherOwner.effectiveRole,"owner");
  assert.equal(effectiveCategoryReviewRole({configuredRole:" Founder/CEO ",membershipRole:"owner",
    configuredPrincipalId:"founder-1",actorId:"founder-1"}).effectiveRole,"owner");
});

test("C5 release route audits effective Founder role and explicit principal binding", () => {
  const source=fs.readFileSync(new URL("../app/api/dashboard/campaign/product/category-review/release/route.ts",import.meta.url),"utf8");
  assert.match(source,/effective_authorized_role:roleBinding\.effectiveRole/);
  assert.match(source,/underlying_membership_role:roleBinding\.membershipRole/);
  assert.match(source,/founder_principal_id:roleBinding\.founderPrincipalId/);
  assert.match(source,/C5_AUTHORIZED_HUMAN_REVIEW_PRINCIPAL_ID/);
  assert.match(source,/resolvedCategory=requireCanonicalC5Category\(body\.resolved_category\)/);
  assert.match(source,/SET category=\$1,category_review_state='CLEAR'/);
  assert.match(source,/retailScope \? "org_id IS NULL"/);
});

test("C5 release requires one canonical resolved category and CLEAR cannot bind default",()=>{
  assert.equal(requireCanonicalC5Category(" Beauty "),"beauty");
  for (const invalid of ["default","not-found","",["beauty","food"]])
    assert.throws(()=>requireCanonicalC5Category(invalid),/exactly one canonical resolved category/i);
  const db=new Database(":memory:");
  try {
    db.exec(fs.readFileSync(new URL("../lib/schema.sql",import.meta.url),"utf8"));
    db.prepare("INSERT INTO users (id,phone,tier,locale,created_at) VALUES ('u2','082','free','id-ID',?)").run("2026-08-27T18:00:00.000Z");
    assert.throws(()=>db.prepare(`INSERT INTO products (id,user_id,name,price_idr,category,category_review_state,
      category_review_reason,category_review_version,images,created_at) VALUES ('bad','u2','Bad',1,'default','CLEAR',NULL,1,'[]',?)`)
      .run("2026-08-27T18:00:00.000Z"),/CHECK constraint/);
  } finally { db.close(); }
});

test("C5 W1 guard precedes PostgreSQL first execution transition",()=>{
  const source=fs.readFileSync(new URL("../lib/postgres/worker.ts",import.meta.url),"utf8");
  const entry=source.slice(source.indexOf("export async function processPostgresJob"),source.indexOf("export function workerExecutionMode"));
  assert.ok(entry.indexOf("requireCurrentJobEvidence({") < entry.indexOf('jobs.transition(jobId, "GENERATING_VISUAL"'));
});

test("C5 ordinary category mutation cannot carry a prior Founder release to another category",()=>{
  const released={state:"CLEAR" as const,reason:null,reviewedBy:"founder-1",reviewedRole:"Founder/CEO",
    reviewedAt:"2026-08-27T19:00:00.000Z",version:2};
  assert.deepEqual(categoryReviewForMutation(released,"food","KNOWN","beauty"),{
    state:"QUARANTINED",reason:"CATEGORY_UNKNOWN",reviewedBy:null,reviewedRole:null,reviewedAt:null,version:3,
  });
  assert.deepEqual(categoryReviewForMutation(released,"beauty","KNOWN","beauty"),released);
});

test("C5 actual release handler is Founder-only, durable, restart-safe, and reauthorizes idempotency",async(t)=>{
  t.after(()=>setCategoryReviewReleaseDependenciesForTests());
  const row={user_id:"customer-9",category:"default",category_review_state:"QUARANTINED" as const,
    category_review_reason:"CATEGORY_UNKNOWN" as const,category_reviewed_by:null as string|null,
    category_reviewed_role:null as string|null,category_reviewed_at:null as string|null,category_review_version:1};
  const audits:Array<{actor:string;meta:Record<string,unknown>}>=[];
  let configuredRole="";
  let configuredPrincipalId="";
  let updates=0;
  const client={
    async query(sql:string,values:unknown[]=[]){
      if (sql === "BEGIN" || sql === "COMMIT" || sql === "ROLLBACK") return {rows:[],rowCount:null};
      if (sql.includes("FROM products")) return {rows:[{...row}],rowCount:1};
      if (sql.includes("FROM audit_log")) {
        const prior=[...audits].reverse().find((item)=>item.actor === values[1]);
        return {rows:prior ? [{meta:prior.meta}] : [],rowCount:prior ? 1 : 0};
      }
      if (sql.includes("UPDATE products SET category=")) {
        if (row.category_review_state !== "QUARANTINED" || row.category_review_version !== values[6]) return {rows:[],rowCount:0};
        row.category=String(values[0]); row.category_review_state="CLEAR" as never;
        row.category_review_reason=null as never; row.category_reviewed_by=String(values[1]);
        row.category_reviewed_role=String(values[2]); row.category_reviewed_at=String(values[3]);
        row.category_review_version=Number(values[4]); updates++;
        return {rows:[],rowCount:1};
      }
      if (sql.includes("INSERT INTO audit_log")) {
        audits.push({actor:String(values[1]),meta:JSON.parse(String(values[3]))});
        return {rows:[],rowCount:1};
      }
      throw new Error(`Unexpected SQL: ${sql}`);
    },
    release(){},
  };
  setCategoryReviewReleaseDependenciesForTests({
    requireOrgContextApi:async()=>({user:{id:"founder-1"},membership:{org_id:"org-1",role:"owner"}}) as never,
    withProductEvidenceMutationLock:async(_id,operation)=>operation(),
    getPool:(()=>({connect:async()=>client})) as never,databaseUrl:()=>"test",
    configuredRole:()=>configuredRole,now:()=>"2026-08-27T19:00:00.000Z",uuid:()=>"00000000-0000-4000-8000-000000000001",
    configuredPrincipalId:()=>configuredPrincipalId,
  });
  const request=()=>new Request("http://local/api/category-review/release",{method:"POST",headers:{"content-type":"application/json"},
    body:JSON.stringify({product_id:"retail-1",scope:"retail",resolved_category:"beauty",reason:"Founder verified exact category",expected_version:1})});

  const forbidden=await releaseCategoryReview(request());
  assert.equal(forbidden.status,403);
  assert.equal(updates,0); assert.equal(audits.length,0);

  configuredRole="Founder/CEO";
  const missingPrincipal=await releaseCategoryReview(request());
  assert.equal(missingPrincipal.status,403);
  assert.equal(updates,0); assert.equal(audits.length,0);
  configuredPrincipalId="founder-1";
  const released=await releaseCategoryReview(request());
  assert.equal(released.status,200);
  assert.equal(updates,1); assert.equal(audits.length,1);
  assert.equal(row.category,"beauty"); assert.equal(row.category_review_version,2);

  // A fresh handler invocation observes durable state, but idempotency cannot
  // bypass changed/missing current Founder configuration.
  configuredRole="";
  const revokedReplay=await releaseCategoryReview(request());
  assert.equal(revokedReplay.status,403);
  configuredRole="Founder/CEO";
  const replay=await releaseCategoryReview(request());
  assert.equal(replay.status,200);
  assert.equal((await replay.json()).idempotent,true);
  assert.equal(updates,1); assert.equal(audits.length,1);
});
