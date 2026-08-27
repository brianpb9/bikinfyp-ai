import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import Database from "better-sqlite3";

import {
  assertCategoryReviewClear,
  authorizeCategoryReviewRelease,
  deriveCategoryReview,
  deriveHeuristicCategoryReview,
  effectiveCategoryReviewRole,
} from "../lib/product-type-boundary";
import { CATEGORY_REVIEW_SQLITE_UPGRADE_GUARDS } from "../lib/db";

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
    actorId: "reviewer-1", actorRole: "catalog-reviewer", reviewedAt: "2026-08-27T17:00:00.000Z",
    reason: "Verified single existing category from source evidence", expectedVersion: 1,
  };
  assert.throws(() => authorizeCategoryReviewRelease(current, release, ""), /role is missing or does not match/i);
  assert.throws(() => authorizeCategoryReviewRelease(current, release, "different-role"), /role is missing or does not match/i);
  assert.deepEqual(authorizeCategoryReviewRelease(current, release, "catalog-reviewer"), {
    state: "CLEAR", reason: null, reviewedBy: "reviewer-1", reviewedRole: "catalog-reviewer",
    reviewedAt: "2026-08-27T17:00:00.000Z", version: 2,
  });
});

test("C5 release is optimistic-concurrency safe", () => {
  const current = deriveCategoryReview("beauty", "BUNDLE");
  assert.throws(() => authorizeCategoryReviewRelease(current, {
    actorId: "reviewer-1", actorRole: "catalog-reviewer", reviewedAt: "2026-08-27T17:00:00.000Z",
    reason: "reviewed", expectedVersion: 2,
  }, "catalog-reviewer"), /state changed or release evidence is incomplete/i);
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
    insert("released",{state:"CLEAR",reason:null,by:"reviewer-1",role:"catalog-reviewer",at:"2026-08-27T17:00:00.000Z",version:2});

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

test("C5 Founder/CEO authority binds only the server-trusted unique org owner", () => {
  const current=deriveCategoryReview("beauty","AMBIGUOUS");
  const release={actorId:"founder-1",actorRole:"Founder/CEO",reviewedAt:"2026-08-27T18:00:00.000Z",
    reason:"Founder reviewed source evidence",expectedVersion:1};
  const founder=effectiveCategoryReviewRole({configuredRole:"Founder/CEO",membershipRole:"owner",
    actorId:"founder-1",trustedOwnerIds:["founder-1"]});
  assert.deepEqual(founder,{effectiveRole:"Founder/CEO",membershipRole:"owner",ownerUserId:"founder-1"});
  assert.equal(authorizeCategoryReviewRelease(current,{...release,actorRole:founder.effectiveRole},"Founder/CEO").reviewedRole,"Founder/CEO");

  const member=effectiveCategoryReviewRole({configuredRole:"Founder/CEO",membershipRole:"member",
    actorId:"member-1",trustedOwnerIds:["founder-1"]});
  assert.throws(()=>authorizeCategoryReviewRelease(current,{...release,actorId:"member-1",actorRole:member.effectiveRole},"Founder/CEO"),/role is missing or does not match/i);
  const missing=effectiveCategoryReviewRole({configuredRole:"",membershipRole:"owner",
    actorId:"founder-1",trustedOwnerIds:["founder-1"]});
  assert.throws(()=>authorizeCategoryReviewRelease(current,{...release,actorRole:missing.effectiveRole},""),/role is missing or does not match/i);
  const duplicateOwners=effectiveCategoryReviewRole({configuredRole:"Founder/CEO",membershipRole:"owner",
    actorId:"founder-1",trustedOwnerIds:["founder-1","owner-2"]});
  assert.equal(duplicateOwners.effectiveRole,"owner");
  assert.equal(effectiveCategoryReviewRole({configuredRole:" Founder/CEO ",membershipRole:"owner",
    actorId:"founder-1",trustedOwnerIds:["founder-1"]}).effectiveRole,"owner");
});

test("C5 release route audits effective Founder role and underlying trusted owner membership", () => {
  const source=fs.readFileSync(new URL("../app/api/dashboard/campaign/product/category-review/release/route.ts",import.meta.url),"utf8");
  assert.match(source,/org_members WHERE org_id=\$1 AND role='owner'[\s\S]*FOR SHARE/);
  assert.match(source,/effective_authorized_role:roleBinding\.effectiveRole/);
  assert.match(source,/underlying_membership_role:roleBinding\.membershipRole/);
  assert.match(source,/underlying_owner_user_id:roleBinding\.ownerUserId/);
});
